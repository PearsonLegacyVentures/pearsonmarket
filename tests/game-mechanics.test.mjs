import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { exitReason, markPosition, validateExitLevels } from "../lib/perp-math.ts";

const tenX = { id:1,user_id:"test",symbol:"PML",side:"LONG",leverage:10,
  margin_cents:1_000,entry_fee_cents:5,entry_price_cents:1_000,
  quantity_micros:10_000_000,take_profit_cents:null,stop_loss_cents:null,
  status:"OPEN",close_reason:null,opened_at:0,closed_at:null,
  exit_price_cents:null,realized_pnl_cents:null };

test("a 10× long gains from a rising mark and liquidates near a 9% fall",() => {
  const winner=markPosition(tenX,1_100);
  assert.equal(winner.unrealizedPnlCents,1_000);
  assert.equal(winner.liquidatable,false);
  assert.equal(winner.closeReturnCents,1_994);
  assert.equal(markPosition(tenX,900).liquidatable,true);
  assert.ok(markPosition(tenX,910).approximateLiqPriceCents>=900);
});

test("a short profits from a falling mark and loses margin when price rises",() => {
  const short={...tenX,side:"SHORT"};
  assert.equal(markPosition(short,900).unrealizedPnlCents,1_000);
  assert.equal(markPosition(short,1_100).liquidatable,true);
  assert.ok(markPosition(short,1_000).approximateLiqPriceCents>1_000);
});

test("adding isolated margin moves the liquidation threshold without changing position size",() => {
  const protectedPosition={...tenX,margin_cents:1_500};
  assert.equal(markPosition(tenX,900).liquidatable,true);
  assert.equal(markPosition(protectedPosition,900).liquidatable,false);
  assert.equal(protectedPosition.quantity_micros,tenX.quantity_micros);
});

test("long and short exit levels trigger at or beyond the mark, with liquidation first",() => {
  const long={...tenX,take_profit_cents:1_050,stop_loss_cents:950};
  assert.equal(exitReason(long,1_049),null);
  assert.equal(exitReason(long,1_050),"TAKE_PROFIT");
  assert.equal(exitReason(long,950),"STOP_LOSS");
  assert.equal(exitReason(long,890),"LIQUIDATION");
  const short={...long,side:"SHORT",take_profit_cents:950,stop_loss_cents:1_050};
  assert.equal(exitReason(short,951),null);
  assert.equal(exitReason(short,950),"TAKE_PROFIT");
  assert.equal(exitReason(short,1_050),"STOP_LOSS");
  assert.equal(exitReason(short,1_110),"LIQUIDATION");
});

test("exit levels must be on the useful side of both mark and liquidation",() => {
  validateExitLevels("LONG",1_000,910,1_100,950);
  validateExitLevels("SHORT",1_000,1_090,900,1_050);
  validateExitLevels("LONG",1_000,910,null,null);
  assert.throws(()=>validateExitLevels("LONG",1_000,910,990,null),/above/);
  assert.throws(()=>validateExitLevels("SHORT",1_000,1_090,1_010,null),/below/);
  assert.throws(()=>validateExitLevels("LONG",1_000,910,null,905),/liquidation/);
  assert.throws(()=>validateExitLevels("SHORT",1_000,1_090,null,1_100),/liquidation/);
});

test("a stale market version fails the conditional-update guard",() => {
  const db=new DatabaseSync(":memory:");
  db.exec("CREATE TABLE market(version INT, cash INT); CREATE TABLE guard(id INT PRIMARY KEY, ok INT CHECK(ok=1)); INSERT INTO market VALUES (0,50000000); INSERT INTO guard VALUES (1,1);");
  db.exec("BEGIN");
  db.prepare("UPDATE market SET version=version+1,cash=? WHERE version=?").run(51000000,0);
  db.prepare("INSERT INTO guard (id,ok) VALUES (1,changes()) ON CONFLICT(id) DO UPDATE SET ok=excluded.ok").run();
  db.exec("COMMIT");
  db.exec("BEGIN");
  db.prepare("UPDATE market SET version=version+1,cash=? WHERE version=?").run(52000000,0);
  assert.throws(()=>db.prepare("INSERT INTO guard (id,ok) VALUES (1,changes()) ON CONFLICT(id) DO UPDATE SET ok=excluded.ok").run(),/CHECK/);
  db.exec("ROLLBACK");
  const row=db.prepare("SELECT version,cash FROM market").get();
  assert.equal(row.version,1);
  assert.equal(row.cash,51000000);
  db.close();
});
