import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { aggregate, bucketTime, joinAndFill, minuteBackstory, preseasonFiveMinute,
  PERIOD_SECONDS } from "../lib/chart-series.ts";
import { liveBucketsSql, UPSERT_MINUTE_CANDLE } from "../lib/chart-sql.ts";

const start=Date.parse("2026-10-24T17:21:17Z");
const base=preseasonFiveMinute("PML",1790,start);
const recent=base.slice(-576); // two days of the same canonical backstory
const minutes=minuteBackstory("PML",recent,recent[0].time);

test("five 1-minute candles reproduce their exact 5-minute parent, including fractional volume",()=>{
  assert.equal(minutes.length,recent.length*5);
  const rebuilt=aggregate(minutes,"5m");
  const originals=aggregate(recent,"5m");
  assert.deepEqual(rebuilt,originals);
  for(let i=1;i<minutes.length;i++){
    assert.equal(minutes[i].time-minutes[i-1].time,60);
    assert.equal(minutes[i].open,minutes[i-1].close);
  }
});

test("5m through 1w have matching OHLCV whether folded from 1m or 5m",()=>{
  for(const interval of ["5m","15m","30m","1h","4h","1d","1w"]){
    assert.deepEqual(aggregate(minutes,interval),aggregate(recent,interval),interval);
    const bars=aggregate(minutes,interval);
    assert.ok(bars.every((bar)=>bar.time===bucketTime(bar.time,interval)),interval);
  }
  assert.equal(bucketTime(Date.parse("2026-10-24T12:34:56Z")/1000,"1w"),
    Date.parse("2026-10-19T00:00:00Z")/1000);
  assert.equal(bucketTime(Date.parse("2026-10-25T23:59:59Z")/1000,"1w"),
    Date.parse("2026-10-19T00:00:00Z")/1000);
  assert.equal(bucketTime(Date.parse("2026-10-26T00:00:00Z")/1000,"1w"),
    Date.parse("2026-10-26T00:00:00Z")/1000);
  assert.equal(bucketTime(Date.parse("2026-10-24T12:34:56Z")/1000,"1d"),
    Date.parse("2026-10-24T00:00:00Z")/1000);
  assert.equal(PERIOD_SECONDS["30m"],1800);
});

test("no-trade intervals stay flat with zero volume, and live candles merge into their period",()=>{
  const last=aggregate(recent.slice(-2),"5m");
  const now=last.at(-1).time+15*60;
  const out=joinAndFill(last,[],"5m",now,last.at(-1).close);
  assert.equal(out.at(-1).time,now);
  assert.deepEqual(out.slice(-2).map(({open,close,volume})=>({open,close,volume})),
    Array(2).fill({open:last.at(-1).close,close:last.at(-1).close,volume:0}));
  const minute=last.at(-1).time+60;
  const live=aggregate([{time:minute,open:last.at(-1).close,high:last.at(-1).close+1,
    low:last.at(-1).close,close:last.at(-1).close+1,volume:3.125}],"5m");
  const joined=joinAndFill(last,live,"5m",now,last.at(-1).close);
  assert.equal(joined.at(-4).open,last.at(-1).open);
  assert.equal(joined.at(-4).close,live[0].close);
  assert.equal(joined.at(-4).volume,+(last.at(-1).volume+3.125).toFixed(3));
});

test("existing trades backfill minute candles with the first open and last close",()=>{
  const db=new DatabaseSync(":memory:");
  db.exec("CREATE TABLE markets(symbol TEXT,opening_price_cents INTEGER); CREATE TABLE trades(id INTEGER,symbol TEXT,created_at INTEGER,price_after_cents INTEGER,shares_micros INTEGER); INSERT INTO markets VALUES ('PML',1000);");
  const minute=Date.parse("2026-10-24T12:00:00Z");
  const insert=db.prepare("INSERT INTO trades VALUES (?,?,?,?,?)");
  insert.run(1,"PML",minute+5000,1200,1_500_000);
  insert.run(2,"PML",minute+35000,900,1_250_000);
  insert.run(3,"PML",minute+62000,1100,2_000_000);
  db.exec(readFileSync(new URL("../drizzle/0003_canonical-minute-candles.sql",import.meta.url),"utf8"));
  const rows=db.prepare("SELECT minute,open_cents,high_cents,low_cents,close_cents,volume_micros FROM market_candles_1m ORDER BY minute").all().map((row)=>({...row}));
  assert.deepEqual(rows,[
    {minute:minute/1000,open_cents:1000,high_cents:1200,low_cents:900,close_cents:900,volume_micros:2_750_000},
    {minute:minute/1000+60,open_cents:900,high_cents:1100,low_cents:900,close_cents:1100,volume_micros:2_000_000},
  ]);
  db.prepare(UPSERT_MINUTE_CANDLE).run("PML",minute/1000+60,1100,1100,850,850,500_000);
  const updated=db.prepare("SELECT open_cents,high_cents,low_cents,close_cents,volume_micros FROM market_candles_1m WHERE symbol='PML' AND minute=?").get(minute/1000+60);
  assert.deepEqual({...updated},{open_cents:900,high_cents:1100,low_cents:850,close_cents:850,volume_micros:2_500_000});
  const minuteBars=db.prepare(liveBucketsSql(60,false)).all("PML",minute/1000,minute/1000+120);
  const fiveBars=db.prepare(liveBucketsSql(300,false)).all("PML",minute/1000,minute/1000+120);
  const weekly=db.prepare(liveBucketsSql(604800,true)).all("PML",minute/1000,minute/1000+120);
  assert.equal(minuteBars.length,2);
  assert.equal(fiveBars.length,1);
  assert.equal(weekly.length,1);
  for(const merged of [fiveBars[0],weekly[0]]){
    assert.equal(merged.open_cents,1000);
    assert.equal(merged.high_cents,1200);
    assert.equal(merged.low_cents,850);
    assert.equal(merged.close_cents,850);
    assert.equal(merged.volume_micros,5_250_000);
  }
  assert.equal(weekly[0].time,Date.parse("2026-10-19T00:00:00Z")/1000);
  db.close();
});
