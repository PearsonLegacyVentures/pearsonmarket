import { env } from "cloudflare:workers";
import type { MarketRow } from "./market-engine";
import { exitReason, FUTURES_FEE_RATE, markPosition, validateExitLevels,
  type ExitReason, type PositionRow } from "./perp-math";
export { markPosition } from "./perp-math";
export type { PositionRow } from "./perp-math";

function db(): D1Database {
  if (!env.DB) throw new Error("Game database is unavailable.");
  return env.DB;
}

const guard = "INSERT INTO trade_guard (id,ok) VALUES (1,changes()) ON CONFLICT(id) DO UPDATE SET ok=excluded.ok";

export async function openPosition(userId: string, market: MarketRow, side: "LONG" | "SHORT",
  marginCents: number, leverage: number, takeProfitCents: number | null, stopLossCents: number | null) {
  if (!Number.isSafeInteger(marginCents) || marginCents < 10_000) throw new Error("Minimum margin is US$100.");
  if (!Number.isSafeInteger(leverage) || leverage < 1 || leverage > 10) throw new Error("Leverage must be 1–10×.");
  const notionalCents = marginCents * leverage;
  if (!Number.isSafeInteger(notionalCents)) throw new Error("Position is too large.");
  const feeCents = Math.ceil(notionalCents * FUTURES_FEE_RATE);
  const walletCost = marginCents + feeCents;
  const quantityMicros = Math.floor(notionalCents * 1_000_000 / market.last_price_cents);
  if (quantityMicros < 1_000) throw new Error("Position is too small.");
  const liquidation = markPosition({side,margin_cents:marginCents,entry_price_cents:market.last_price_cents,
    quantity_micros:quantityMicros},market.last_price_cents).approximateLiqPriceCents;
  validateExitLevels(side,market.last_price_cents,liquidation,takeProfitCents,stopLossCents);
  const database = db();
  const player = await database.prepare("SELECT cash_cents FROM players WHERE user_id=?").bind(userId).first<{cash_cents:number}>();
  if (!player || player.cash_cents < walletCost) throw new Error(`You need US$${(walletCost / 100).toFixed(2)} available for margin and fee.`);
  try {
    const results = await database.batch([
      database.prepare("UPDATE players SET cash_cents=cash_cents-? WHERE user_id=? AND cash_cents>=?").bind(walletCost,userId,walletCost),
      database.prepare(guard),
      database.prepare("INSERT INTO positions (user_id,symbol,side,leverage,margin_cents,entry_fee_cents,entry_price_cents,quantity_micros,take_profit_cents,stop_loss_cents,status,opened_at) SELECT ?,?,?,?,?,?,?,?,?,?,'OPEN',? WHERE EXISTS (SELECT 1 FROM markets WHERE symbol=? AND version=?)")
        .bind(userId,market.symbol,side,leverage,marginCents,feeCents,market.last_price_cents,quantityMicros,takeProfitCents,stopLossCents,Date.now(),market.symbol,market.version),
      database.prepare(guard),
    ]);
    return { id: results[2].meta.last_row_id, side, symbol: market.symbol, leverage,
      marginCents, feeCents, notionalCents, entryPriceCents: market.last_price_cents, quantityMicros,
      takeProfitCents, stopLossCents };
  } catch (error) {
    if (String(error).includes("trade_guard_ok")) throw new Error("Your available cash changed. Refresh and try again.");
    throw error;
  }
}

async function settlePosition(database: D1Database, position: PositionRow,
  markPriceCents: number, marketVersion: number, reason: ExitReason | "MANUAL") {
  const liquidation = reason === "LIQUIDATION";
  const returnCents = liquidation ? 0 : markPosition(position,markPriceCents).closeReturnCents;
  const realizedPnlCents = returnCents - position.margin_cents - position.entry_fee_cents;
  const statements = [
    database.prepare("UPDATE positions SET status=?,close_reason=?,closed_at=?,exit_price_cents=?,realized_pnl_cents=? WHERE id=? AND user_id=? AND status='OPEN' AND EXISTS (SELECT 1 FROM markets WHERE symbol=? AND version=?)")
      .bind(liquidation?"LIQUIDATED":"CLOSED",reason,Date.now(),markPriceCents,realizedPnlCents,
        position.id,position.user_id,position.symbol,marketVersion),
    database.prepare(guard),
  ];
  if (!liquidation) statements.push(
    database.prepare("UPDATE players SET cash_cents=cash_cents+? WHERE user_id=?").bind(returnCents,position.user_id),
    database.prepare(guard),
  );
  await database.batch(statements);
  return { status: liquidation ? "LIQUIDATED" : "CLOSED", reason, returnCents, realizedPnlCents };
}

export async function closePosition(userId: string, id: number) {
  const database = db();
  const position = await database.prepare("SELECT * FROM positions WHERE id=? AND user_id=?").bind(id,userId).first<PositionRow>();
  if (!position || position.status !== "OPEN") throw new Error("This position is no longer open.");
  const market = await database.prepare("SELECT last_price_cents,version FROM markets WHERE symbol=?")
    .bind(position.symbol).first<{last_price_cents:number;version:number}>();
  if (!market) throw new Error("Market unavailable.");
  const valuation = markPosition(position,market.last_price_cents);
  try {
    return await settlePosition(database,position,market.last_price_cents,market.version,
      valuation.liquidatable ? "LIQUIDATION" : "MANUAL");
  } catch (error) {
    if (String(error).includes("trade_guard_ok")) throw new Error("Position already changed. Refresh and try again.");
    throw error;
  }
}

export async function updateExitLevels(userId: string, id: number,
  takeProfitCents: number | null, stopLossCents: number | null) {
  const database = db();
  const row = await database.prepare("SELECT p.*,m.last_price_cents,m.version AS market_version FROM positions p JOIN markets m ON p.symbol=m.symbol WHERE p.id=? AND p.user_id=?")
    .bind(id,userId).first<PositionRow & {last_price_cents:number;market_version:number}>();
  if (!row || row.status !== "OPEN") throw new Error("This position is no longer open.");
  const liquidation = markPosition(row,row.last_price_cents).approximateLiqPriceCents;
  validateExitLevels(row.side,row.last_price_cents,liquidation,takeProfitCents,stopLossCents);
  try {
    await database.batch([
      database.prepare("UPDATE positions SET take_profit_cents=?,stop_loss_cents=? WHERE id=? AND user_id=? AND status='OPEN' AND EXISTS (SELECT 1 FROM markets WHERE symbol=? AND version=?)")
        .bind(takeProfitCents,stopLossCents,id,userId,row.symbol,row.market_version),
      database.prepare(guard),
    ]);
  } catch (error) {
    if (String(error).includes("trade_guard_ok")) throw new Error("Price or position changed. Refresh and try again.");
    throw error;
  }
  return { takeProfitCents, stopLossCents };
}

export async function addMargin(userId: string, id: number, amountCents: number) {
  if (!Number.isSafeInteger(amountCents) || amountCents < 1_000) throw new Error("Minimum addition is US$10.");
  const database = db();
  try {
    await database.batch([
      database.prepare("UPDATE players SET cash_cents=cash_cents-? WHERE user_id=? AND cash_cents>=?").bind(amountCents,userId,amountCents),
      database.prepare(guard),
      database.prepare("UPDATE positions SET margin_cents=margin_cents+? WHERE id=? AND user_id=? AND status='OPEN'").bind(amountCents,id,userId),
      database.prepare(guard),
    ]);
    return { addedCents: amountCents };
  } catch (error) {
    if (String(error).includes("trade_guard_ok")) throw new Error("Not enough cash or position already closed.");
    throw error;
  }
}

export async function settlePositionExits(symbol?: string) {
  const database = db();
  const query = symbol
    ? database.prepare("SELECT p.*,m.last_price_cents,m.version AS market_version FROM positions p JOIN markets m ON p.symbol=m.symbol WHERE p.status='OPEN' AND p.symbol=?").bind(symbol)
    : database.prepare("SELECT p.*,m.last_price_cents,m.version AS market_version FROM positions p JOIN markets m ON p.symbol=m.symbol WHERE p.status='OPEN'");
  const rows = await query.all<PositionRow & {last_price_cents:number;market_version:number}>();
  for (const position of rows.results) {
    const reason = exitReason(position,position.last_price_cents);
    if (!reason) continue;
    try {
      await settlePosition(database,position,position.last_price_cents,position.market_version,reason);
    } catch (error) {
      // The next request evaluates the position at the new mark if another trade won.
      if (!String(error).includes("trade_guard_ok")) throw error;
    }
  }
}

export async function getPositions(userId: string) {
  const database = db();
  const [open, history] = await Promise.all([
    database.prepare("SELECT * FROM positions WHERE user_id=? AND status='OPEN' ORDER BY id DESC").bind(userId).all<PositionRow>(),
    database.prepare("SELECT * FROM positions WHERE user_id=? AND status!='OPEN' ORDER BY id DESC LIMIT 25").bind(userId).all<PositionRow>(),
  ]);
  return { open: open.results, history: history.results };
}
