import { env } from "cloudflare:workers";
import { aggregate, BAR_LIMIT, bucketTime, joinAndFill, minuteBackstory,
  PERIOD_SECONDS, preseasonFiveMinute, type Bar, type Interval } from "./chart-series";
import { liveBucketsSql } from "./chart-sql";

const historicalCache=new Map<string,Bar[]>();

function preseason(symbol:string,openingCents:number,startedAt:number) {
  const key=`${symbol}:${openingCents}:${startedAt}`;
  let bars=historicalCache.get(key);
  if(!bars){
    bars=preseasonFiveMinute(symbol,openingCents,startedAt);
    if(historicalCache.size>=2)historicalCache.delete(historicalCache.keys().next().value!);
    historicalCache.set(key,bars);
  }
  return bars;
}

type LiveRow = {time:number;open_cents:number;high_cents:number;low_cents:number;
  close_cents:number;volume_micros:number};

export async function chartData(symbol:string,interval:Interval) {
  if(!env.DB)throw new Error("Database unavailable");
  const db=env.DB;
  const [market,clock]=await Promise.all([
    db.prepare("SELECT opening_price_cents,last_price_cents FROM markets WHERE symbol=?").bind(symbol)
      .first<{opening_price_cents:number;last_price_cents:number}>(),
    db.prepare("SELECT started_at FROM game_clock WHERE id=1").first<{started_at:number}>(),
  ]);
  if(!market||!clock)throw new Error("Market unavailable");

  const nowSeconds=Math.floor(Date.now()/1000);
  const requestedStart=bucketTime(nowSeconds,interval)-(BAR_LIMIT[interval]-1)*PERIOD_SECONDS[interval];
  // SQL returns only the requested window, already folded into the selected UTC buckets.
  const query=liveBucketsSql(PERIOD_SECONDS[interval],interval==="1w");
  const [rows,prior]=await Promise.all([
    db.prepare(query).bind(symbol,requestedStart,nowSeconds).all<LiveRow>(),
    db.prepare("SELECT close_cents FROM market_candles_1m WHERE symbol=? AND minute<? ORDER BY minute DESC LIMIT 1")
      .bind(symbol,requestedStart).first<{close_cents:number}>(),
  ]);
  const live=rows.results.map((row)=>({time:row.time,open:row.open_cents/100,
    high:row.high_cents/100,low:row.low_cents/100,close:row.close_cents/100,
    volume:row.volume_micros/1_000_000}));
  const base=preseason(symbol,market.opening_price_cents,clock.started_at);
  const historical=interval==="1m"
    ? minuteBackstory(symbol,base,requestedStart)
    : base.filter((bar)=>bar.time>=requestedStart-PERIOD_SECONDS[interval]);
  const bars=joinAndFill(aggregate(historical,interval),live,interval,nowSeconds,
    market.last_price_cents/100,prior?.close_cents===undefined?undefined:prior.close_cents/100);
  return {bars,source:"Fictional pregame candles · executed trades · UTC, Monday weekly open"};
}
