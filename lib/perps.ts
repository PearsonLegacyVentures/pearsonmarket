import { env } from "cloudflare:workers";
import type { MarketRow } from "./market-engine";
import { FUTURES_FEE_RATE, markPosition, type PositionRow } from "./perp-math";
export { markPosition } from "./perp-math";
export type { PositionRow } from "./perp-math";

function db(): D1Database {
  if (!env.DB) throw new Error("Game database is unavailable.");
  return env.DB;
}

const guard = "INSERT INTO trade_guard (id,ok) VALUES (1,changes()) ON CONFLICT(id) DO UPDATE SET ok=excluded.ok";

export async function openPosition(userId: string, market: MarketRow, side: "LONG" | "SHORT",
  marginCents: number, leverage: number) {
  if (!Number.isSafeInteger(marginCents) || marginCents < 10_000) throw new Error("Minimum margin is B$100.");
  if (!Number.isSafeInteger(leverage) || leverage < 1 || leverage > 10) throw new Error("Leverage must be 1–10×.");
  const notionalCents = marginCents * leverage;
  if (!Number.isSafeInteger(notionalCents)) throw new Error("Position is too large.");
  const feeCents = Math.ceil(notionalCents * FUTURES_FEE_RATE);
  const walletCost = marginCents + feeCents;
  const quantityMicros = Math.floor(notionalCents * 1_000_000 / market.last_price_cents);
  if (quantityMicros < 1_000) throw new Error("Position is too small.");
  const database = db();
  const player = await database.prepare("SELECT cash_cents FROM players WHERE user_id=?").bind(userId).first<{cash_cents:number}>();
  if (!player || player.cash_cents < walletCost) throw new Error(`You need B$${(walletCost / 100).toFixed(2)} available for margin and fee.`);
  try {
    const results = await database.batch([
      database.prepare("UPDATE players SET cash_cents=cash_cents-? WHERE user_id=? AND cash_cents>=?").bind(walletCost,userId,walletCost),
      database.prepare(guard),
      database.prepare("INSERT INTO positions (user_id,symbol,side,leverage,margin_cents,entry_fee_cents,entry_price_cents,quantity_micros,status,opened_at) SELECT ?,?,?,?,?,?,?,?,'OPEN',? WHERE EXISTS (SELECT 1 FROM markets WHERE symbol=? AND version=?)")
        .bind(userId,market.symbol,side,leverage,marginCents,feeCents,market.last_price_cents,quantityMicros,Date.now(),market.symbol,market.version),
      database.prepare(guard),
    ]);
    return { id: results[2].meta.last_row_id, side, symbol: market.symbol, leverage,
      marginCents, feeCents, notionalCents, entryPriceCents: market.last_price_cents, quantityMicros };
  } catch (error) {
    if (String(error).includes("trade_guard_ok")) throw new Error("Your available cash changed. Refresh and try again.");
    throw error;
  }
}

export async function closePosition(userId: string, id: number) {
  const database = db();
  const position = await database.prepare("SELECT * FROM positions WHERE id=? AND user_id=?").bind(id,userId).first<PositionRow>();
  if (!position || position.status !== "OPEN") throw new Error("This position is no longer open.");
  const market = await database.prepare("SELECT last_price_cents,version FROM markets WHERE symbol=?")
    .bind(position.symbol).first<{last_price_cents:number;version:number}>();
  if (!market) throw new Error("Market unavailable.");
  const valuation = markPosition(position,market.last_price_cents);
  if (valuation.liquidatable) {
    const result = await database.prepare("UPDATE positions SET status='LIQUIDATED',closed_at=?,exit_price_cents=?,realized_pnl_cents=? WHERE id=? AND status='OPEN' AND EXISTS (SELECT 1 FROM markets WHERE symbol=? AND version=?)")
      .bind(Date.now(),market.last_price_cents,-position.margin_cents-position.entry_fee_cents,id,position.symbol,market.version).run();
    if (!result.meta.changes) throw new Error("Price changed. Refresh and try again.");
    return { status: "LIQUIDATED", returnCents: 0 };
  }
  const returnCents = valuation.closeReturnCents;
  try {
    await database.batch([
      database.prepare("UPDATE positions SET status='CLOSED',closed_at=?,exit_price_cents=?,realized_pnl_cents=? WHERE id=? AND user_id=? AND status='OPEN' AND EXISTS (SELECT 1 FROM markets WHERE symbol=? AND version=?)")
        .bind(Date.now(),market.last_price_cents,returnCents-position.margin_cents-position.entry_fee_cents,id,userId,position.symbol,market.version),
      database.prepare(guard),
      database.prepare("UPDATE players SET cash_cents=cash_cents+? WHERE user_id=?").bind(returnCents,userId),
      database.prepare(guard),
    ]);
    return { status: "CLOSED", returnCents, realizedPnlCents: returnCents-position.margin_cents-position.entry_fee_cents };
  } catch (error) {
    if (String(error).includes("trade_guard_ok")) throw new Error("Position already changed. Refresh and try again.");
    throw error;
  }
}

export async function addMargin(userId: string, id: number, amountCents: number) {
  if (!Number.isSafeInteger(amountCents) || amountCents < 1_000) throw new Error("Minimum addition is B$10.");
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

export async function settleLiquidations(symbol?: string) {
  const database = db();
  const query = symbol
    ? database.prepare("SELECT p.*,m.last_price_cents,m.version AS market_version FROM positions p JOIN markets m ON p.symbol=m.symbol WHERE p.status='OPEN' AND p.symbol=?").bind(symbol)
    : database.prepare("SELECT p.*,m.last_price_cents,m.version AS market_version FROM positions p JOIN markets m ON p.symbol=m.symbol WHERE p.status='OPEN'");
  const rows = await query.all<PositionRow & {last_price_cents:number;market_version:number}>();
  for (const position of rows.results) {
    if (!markPosition(position,position.last_price_cents).liquidatable) continue;
    await database.prepare("UPDATE positions SET status='LIQUIDATED',closed_at=?,exit_price_cents=?,realized_pnl_cents=? WHERE id=? AND status='OPEN' AND EXISTS (SELECT 1 FROM markets WHERE symbol=? AND version=?)")
      .bind(Date.now(),position.last_price_cents,-position.margin_cents-position.entry_fee_cents,position.id,position.symbol,position.market_version).run();
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
