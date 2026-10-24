import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { quote } from "../lib/amm-math.ts";
import { STARTING_CASH_CENTS } from "../lib/market-data.ts";

test("US$1,000 buys fractional shares; selling the entire balance returns USD without dust", () => {
  assert.equal(STARTING_CASH_CENTS, 100_000);
  const pool = { cash_cents: 50_000_000, shares_micros: Math.round(50_000_000 / 880 * 1_000_000) };
  const buy = quote(pool, "buy", 25_000);
  const wallet = { usdCents: STARTING_CASH_CENTS - buy.cashCents, sharesMicros: buy.sharesMicros };
  assert.equal(wallet.usdCents, 75_000);
  assert.ok(wallet.sharesMicros > 0);
  const sell = quote({ cash_cents: buy.poolCashCents, shares_micros: buy.poolSharesMicros }, "sell", wallet.sharesMicros);
  wallet.usdCents += sell.cashCents;
  wallet.sharesMicros -= sell.sharesMicros;
  assert.equal(wallet.sharesMicros, 0);
  assert.ok(wallet.usdCents > 75_000 && wallet.usdCents < STARTING_CASH_CENTS);
  assert.equal(sell.poolSharesMicros, pool.shares_micros);
});

test("the bankroll migration adjusts only old, untouched human accounts", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE players (user_id TEXT, cash_cents INTEGER, is_bot INTEGER); CREATE TABLE trades (user_id TEXT); CREATE TABLE holdings (user_id TEXT, shares_micros INTEGER); CREATE TABLE positions (user_id TEXT);");
  db.exec("INSERT INTO players VALUES ('fresh',10000000,0),('traded',10000000,0),('holding',10000000,0),('futures',10000000,0),('bot',50000000,1); INSERT INTO trades VALUES ('traded'); INSERT INTO holdings VALUES ('holding',500000); INSERT INTO positions VALUES ('futures');");
  const migration = readFileSync(new URL("../drizzle/0002_starting-usd-wallet.sql", import.meta.url), "utf8");
  db.exec(migration);
  db.exec(migration);
  const balances = Object.fromEntries(db.prepare("SELECT user_id,cash_cents FROM players").all().map(({ user_id, cash_cents }) => [user_id, cash_cents]));
  assert.deepEqual(balances, { fresh:100_000, traded:10_000_000, holding:10_000_000, futures:10_000_000, bot:50_000_000 });
  db.close();
});
