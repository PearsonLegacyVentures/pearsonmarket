import { env } from "cloudflare:workers";
import { botTicketCents, companies, eventTemplates, FEE_RATE, reserveCents, STARTING_CASH_CENTS, TICK_MS } from "./market-data";
import { quote, type Side } from "./amm-math";
import { UPSERT_MINUTE_CANDLE } from "./chart-sql";
import { getPositions, markPosition, type PositionRow } from "./perps";

export type MarketRow = {
  symbol: string; name: string; sector: string; description: string; tier: "large" | "mid" | "small";
  opening_price_cents: number; cash_cents: number; shares_micros: number;
  version: number; last_price_cents: number;
};

type PlayerRow = { user_id: string; name: string; cash_cents: number; is_bot: number };
type HoldingRow = { user_id: string; symbol: string; shares_micros: number };

export function database(): D1Database {
  if (!env.DB) throw new Error("Game database is not available.");
  return env.DB;
}

export function spotCents(market: MarketRow) {
  return Math.round(market.cash_cents * 1_000_000 / market.shares_micros);
}

function liquidationValue(market: MarketRow, sharesMicros: number) {
  const gross = Math.floor(market.cash_cents * sharesMicros / (market.shares_micros + sharesMicros));
  return Math.floor(gross * (1 - FEE_RATE));
}

const guardSql = "INSERT INTO trade_guard (id, ok) VALUES (1, changes()) ON CONFLICT(id) DO UPDATE SET ok = excluded.ok";

export async function ensureGame(userId: string, displayName: string) {
  const db = database();
  const exists = await db.prepare("SELECT symbol FROM markets LIMIT 1").first();
  if (!exists) {
    const now = Date.now();
    const statements = companies.map((c) => {
      const cash = reserveCents[c.tier];
      const shares = Math.round(cash / c.price * 1_000_000);
      return db.prepare("INSERT OR IGNORE INTO markets (symbol,name,sector,description,tier,opening_price_cents,cash_cents,shares_micros,version,last_price_cents) VALUES (?,?,?,?,?,?,?,?,0,?)")
        .bind(c.symbol, c.name, c.sector, c.description, c.tier, c.price, cash, shares, c.price);
    });
    statements.push(db.prepare("INSERT OR IGNORE INTO game_clock (id,last_tick,started_at) VALUES (1,?,?)").bind(now,now));
    statements.push(db.prepare("INSERT OR IGNORE INTO trade_guard (id,ok) VALUES (1,1)"));
    statements.push(db.prepare("INSERT OR IGNORE INTO players (user_id,name,cash_cents,is_bot) VALUES ('BOT_M','Momentum Bot',50000000,1)"));
    statements.push(db.prepare("INSERT OR IGNORE INTO players (user_id,name,cash_cents,is_bot) VALUES ('BOT_C','Contrarian Bot',50000000,1)"));
    for (const bot of ["BOT_M", "BOT_C"]) {
      for (const c of companies) {
        statements.push(db.prepare("INSERT OR IGNORE INTO holdings (user_id,symbol,shares_micros) VALUES (?,?,?)")
          .bind(bot, c.symbol, 3_000_000_000));
      }
    }
    statements.push(db.prepare("INSERT OR IGNORE INTO news (id,symbol,headline,direction,created_at) VALUES (1,'PML','Opening bell: Island Exchange simulation begins','neutral',?)").bind(now));
    await db.batch(statements);
  }
  await db.prepare("INSERT OR IGNORE INTO players (user_id,name,cash_cents,is_bot) VALUES (?,?,?,0)")
    .bind(userId, displayName.slice(0, 60), STARTING_CASH_CENTS).run();
  const clock = await db.prepare("SELECT started_at FROM game_clock WHERE id=1").first<{started_at:number}>();
  if (clock?.started_at === 0) await db.prepare("UPDATE game_clock SET started_at=? WHERE id=1 AND started_at=0").bind(Date.now()).run();
}

export async function executeTrade(userId: string, market: MarketRow, side: Side, units: number,
  options?: { clockLastTick?: number; headline?: string; direction?: string }) {
  const db = database();
  const trade = quote(market, side, units);
  const tradeAt = Date.now();
  const minute = Math.floor(tradeAt / 60_000) * 60;
  const player = await db.prepare("SELECT cash_cents FROM players WHERE user_id=?").bind(userId).first<{ cash_cents: number }>();
  if (!player) throw new Error("Player account not found.");
  if (side === "buy" && player.cash_cents < trade.cashCents) throw new Error("Not enough cash for that order.");
  if (side === "sell") {
    const holding = await db.prepare("SELECT shares_micros FROM holdings WHERE user_id=? AND symbol=?")
      .bind(userId, market.symbol).first<{ shares_micros: number }>();
    if (!holding || holding.shares_micros < trade.sharesMicros) throw new Error("Not enough shares for that order.");
  }

  const statements: D1PreparedStatement[] = [];
  if (options?.clockLastTick !== undefined) {
    statements.push(db.prepare("UPDATE game_clock SET last_tick=? WHERE id=1 AND last_tick=?")
      .bind(tradeAt, options.clockLastTick));
    statements.push(db.prepare(guardSql));
  }
  statements.push(db.prepare("UPDATE markets SET cash_cents=?, shares_micros=?, last_price_cents=?, version=version+1 WHERE symbol=? AND version=?")
    .bind(trade.poolCashCents, trade.poolSharesMicros, trade.afterCents, market.symbol, market.version));
  statements.push(db.prepare(guardSql));
  if (side === "buy") {
    statements.push(db.prepare("UPDATE players SET cash_cents=cash_cents-? WHERE user_id=? AND cash_cents>=?")
      .bind(trade.cashCents, userId, trade.cashCents));
  } else {
    statements.push(db.prepare("UPDATE players SET cash_cents=cash_cents+? WHERE user_id=?")
      .bind(trade.cashCents, userId));
  }
  statements.push(db.prepare(guardSql));
  if (side === "buy") {
    statements.push(db.prepare("INSERT INTO holdings (user_id,symbol,shares_micros) VALUES (?,?,?) ON CONFLICT(user_id,symbol) DO UPDATE SET shares_micros=holdings.shares_micros+excluded.shares_micros")
      .bind(userId, market.symbol, trade.sharesMicros));
  } else {
    statements.push(db.prepare("UPDATE holdings SET shares_micros=shares_micros-? WHERE user_id=? AND symbol=? AND shares_micros>=?")
      .bind(trade.sharesMicros, userId, market.symbol, trade.sharesMicros));
  }
  statements.push(db.prepare(guardSql));
  statements.push(db.prepare("INSERT INTO trades (user_id,symbol,side,shares_micros,cash_cents,price_after_cents,created_at) VALUES (?,?,?,?,?,?,?)")
    .bind(userId, market.symbol, side, trade.sharesMicros, trade.cashCents, trade.afterCents, tradeAt));
  statements.push(db.prepare(UPSERT_MINUTE_CANDLE)
    .bind(market.symbol,minute,market.last_price_cents,
      Math.max(market.last_price_cents,trade.afterCents),Math.min(market.last_price_cents,trade.afterCents),
      trade.afterCents,trade.sharesMicros));
  if (options?.headline) {
    statements.push(db.prepare("INSERT INTO news (symbol,headline,direction,created_at) VALUES (?,?,?,?)")
      .bind(market.symbol, options.headline, options.direction ?? "neutral", tradeAt));
  }
  try {
    await db.batch(statements);
  } catch (error) {
    if (String(error).includes("trade_guard_ok")) throw new Error("The market changed. Refresh the quote and try again.");
    throw error;
  }
  return trade;
}

export async function maybeTick() {
  const db = database();
  const clock = await db.prepare("SELECT last_tick FROM game_clock WHERE id=1").first<{ last_tick: number }>();
  if (!clock || Date.now() - clock.last_tick < TICK_MS) return;
  const market = await db.prepare("SELECT * FROM markets ORDER BY RANDOM() LIMIT 1").first<MarketRow>();
  if (!market) return;
  const up = Math.random() > 0.5;
  const event = Math.random() < .05;
  // Routine bot orders are small. A rarer, labeled event sends more volume
  // through the same AMM. Neither path changes the price without a swap.
  const userId = Math.random() > 0.5 ? "BOT_M" : "BOT_C";
  let side: Side = up ? "buy" : "sell";
  const targetCents = botTicketCents(market.cash_cents,event,Math.random());
  const player = await db.prepare("SELECT cash_cents FROM players WHERE user_id=?").bind(userId).first<{ cash_cents: number }>();
  const holding = await db.prepare("SELECT shares_micros FROM holdings WHERE user_id=? AND symbol=?")
    .bind(userId, market.symbol).first<{ shares_micros: number }>();
  if (side === "buy" && (!player || player.cash_cents < targetCents)) side = "sell";
  if (side === "sell" && (!holding || holding.shares_micros < 1_000_000)) side = "buy";
  if (side === "buy" && (!player || player.cash_cents < 100_000)) return;
  const units = side === "buy"
    ? Math.min(targetCents, player!.cash_cents)
    : Math.min(holding!.shares_micros, Math.floor(targetCents / spotCents(market) * 1_000_000));
  const templates = eventTemplates[market.sector];
  const choices = side === "buy" ? templates.up : templates.down;
  const headline = event ? choices[Math.floor(Math.random() * choices.length)] : undefined;
  try {
    await executeTrade(userId, market, side, units, { clockLastTick: clock.last_tick, headline,
      direction: side === "buy" ? "up" : "down" });
  } catch {
    // Another viewer may have advanced the same tick; their transaction wins.
  }
}

export async function getState(userId: string) {
  const db = database();
  const [marketRows, player, positions, headlines] = await Promise.all([
    db.prepare("SELECT * FROM markets ORDER BY symbol").all<MarketRow>(),
    db.prepare("SELECT * FROM players WHERE user_id=?").bind(userId).first<PlayerRow>(),
    db.prepare("SELECT symbol,shares_micros FROM holdings WHERE user_id=? AND shares_micros>0").bind(userId).all<HoldingRow>(),
    db.prepare("SELECT * FROM news ORDER BY id DESC LIMIT 12").all(),
  ]);
  const [activity, humans, allHoldings, allOpenPositions] = await Promise.all([
    db.prepare("SELECT t.id,t.symbol,t.side,t.shares_micros,t.cash_cents,t.price_after_cents,t.created_at,p.name,p.is_bot FROM trades t JOIN players p ON p.user_id=t.user_id ORDER BY t.id DESC LIMIT 32").all(),
    db.prepare("SELECT * FROM players WHERE is_bot=0").all<PlayerRow>(),
    db.prepare("SELECT user_id,symbol,shares_micros FROM holdings WHERE shares_micros>0").all<HoldingRow>(),
    db.prepare("SELECT * FROM positions WHERE status='OPEN'").all<PositionRow>(),
  ]);
  const [futures, clock] = await Promise.all([
    getPositions(userId),
    db.prepare("SELECT started_at FROM game_clock WHERE id=1").first<{started_at:number}>(),
  ]);
  const market = marketRows.results;
  const bySymbol = new Map(market.map((m) => [m.symbol, m]));
  const leaderboard = humans.results.map((human) => {
    const spotValue = allHoldings.results.filter((h) => h.user_id === human.user_id).reduce((sum, holding) => {
      const m = bySymbol.get(holding.symbol);
      return m ? sum + liquidationValue(m, holding.shares_micros) : sum;
    }, human.cash_cents);
    const liquidation = allOpenPositions.results.filter((p) => p.user_id === human.user_id).reduce((sum, position) => {
      const m = bySymbol.get(position.symbol);
      return m ? sum + markPosition(position,m.last_price_cents).closeReturnCents : sum;
    }, spotValue);
    return { name: human.name, liquidationCents: liquidation, isYou: human.user_id === userId };
  }).sort((a, b) => b.liquidationCents - a.liquidationCents);
  return {
    market,
    player: { name: player?.name ?? "Player", cashCents: player?.cash_cents ?? STARTING_CASH_CENTS },
    positions: positions.results,
    futures,
    startedAt: clock?.started_at ?? Date.now(),
    news: headlines.results,
    activity: activity.results,
    leaderboard,
    feeRate: FEE_RATE,
    tickMs: TICK_MS,
  };
}

export async function findMarket(symbol: string) {
  return database().prepare("SELECT * FROM markets WHERE symbol=?").bind(symbol).first<MarketRow>();
}
