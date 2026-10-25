import { sql } from "drizzle-orm";
import { check, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const markets = sqliteTable("markets", {
  symbol: text("symbol").primaryKey(),
  name: text("name").notNull(),
  sector: text("sector").notNull(),
  description: text("description").notNull(),
  tier: text("tier").notNull(),
  openingPriceCents: integer("opening_price_cents").notNull(),
  cashCents: integer("cash_cents").notNull(),
  sharesMicros: integer("shares_micros").notNull(),
  version: integer("version").notNull().default(0),
  lastPriceCents: integer("last_price_cents").notNull(),
});

export const players = sqliteTable("players", {
  userId: text("user_id").primaryKey(),
  name: text("name").notNull(),
  cashCents: integer("cash_cents").notNull(),
  isBot: integer("is_bot").notNull().default(0),
});

// Standalone Cloudflare Workers issue opaque, browser-bound game sessions.
export const guestSessions = sqliteTable("guest_sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: text("user_id").notNull(),
  displayName: text("display_name").notNull(),
  expiresAt: integer("expires_at").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const holdings = sqliteTable("holdings", {
  userId: text("user_id").notNull(),
  symbol: text("symbol").notNull(),
  sharesMicros: integer("shares_micros").notNull().default(0),
}, (t) => [primaryKey({ columns: [t.userId, t.symbol] })]);

export const trades = sqliteTable("trades", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id").notNull(),
  symbol: text("symbol").notNull(),
  side: text("side").notNull(),
  sharesMicros: integer("shares_micros").notNull(),
  cashCents: integer("cash_cents").notNull(),
  priceAfterCents: integer("price_after_cents").notNull(),
  createdAt: integer("created_at").notNull(),
});

// Executed trades are folded into one-minute candles in the same transaction.
// Higher timeframes derive from these canonical minute candles.
export const marketCandles1m = sqliteTable("market_candles_1m", {
  symbol: text("symbol").notNull(),
  minute: integer("minute").notNull(),
  openCents: integer("open_cents").notNull(),
  highCents: integer("high_cents").notNull(),
  lowCents: integer("low_cents").notNull(),
  closeCents: integer("close_cents").notNull(),
  volumeMicros: integer("volume_micros").notNull(),
}, (t) => [primaryKey({ columns: [t.symbol,t.minute] })]);

export const news = sqliteTable("news", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  symbol: text("symbol").notNull(),
  headline: text("headline").notNull(),
  direction: text("direction").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const gameClock = sqliteTable("game_clock", {
  id: integer("id").primaryKey(),
  lastTick: integer("last_tick").notNull().default(0),
  startedAt: integer("started_at").notNull().default(0),
});

export const positions = sqliteTable("positions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id").notNull(),
  symbol: text("symbol").notNull(),
  side: text("side").notNull(),
  leverage: integer("leverage").notNull(),
  marginCents: integer("margin_cents").notNull(),
  entryFeeCents: integer("entry_fee_cents").notNull(),
  entryPriceCents: integer("entry_price_cents").notNull(),
  quantityMicros: integer("quantity_micros").notNull(),
  takeProfitCents: integer("take_profit_cents"),
  stopLossCents: integer("stop_loss_cents"),
  status: text("status").notNull().default("OPEN"),
  openedAt: integer("opened_at").notNull(),
  closedAt: integer("closed_at"),
  exitPriceCents: integer("exit_price_cents"),
  realizedPnlCents: integer("realized_pnl_cents"),
  closeReason: text("close_reason"),
});

// A failed guard check rolls back the entire D1 batch.
export const tradeGuard = sqliteTable("trade_guard", {
  id: integer("id").primaryKey(),
  ok: integer("ok").notNull(),
}, (t) => [check("trade_guard_ok", sql`${t.ok} = 1`)]);
