import { env } from "cloudflare:workers";

type Bar = { time: number; open: number; high: number; low: number; close: number; volume: number };

function hash(input: string) {
  let value = 2166136261;
  for (let i=0;i<input.length;i++) value = Math.imul(value ^ input.charCodeAt(i),16777619);
  return value >>> 0;
}

function random(seed: number) {
  let value = seed;
  return () => {
    value += 0x6D2B79F5;
    let t = value;
    t = Math.imul(t ^ t >>> 15,t | 1);
    t ^= t + Math.imul(t ^ t >>> 7,t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function history(symbol: string, openingCents: number, startedAt: number): Bar[] {
  const rand = random(hash(symbol));
  const count = 864; // three fictional days of 5-minute backstory
  const ending = Math.floor(startedAt / 300_000) * 300 - 300;
  let price = openingCents / 100 * (0.9 + rand() * 0.2);
  const data: Bar[] = [];
  for (let i=0;i<count;i++) {
    const open = price;
    const volatility = (rand() - .49) * .009;
    price = Math.max(.2,open * (1 + volatility));
    const excursion = open * (.0003 + rand() * .003);
    data.push({time:ending-(count-i-1)*300,open,high:Math.max(open,price)+excursion*rand(),
      low:Math.max(.01,Math.min(open,price)-excursion*rand()),close:price,volume:500+rand()*6000});
  }
  const factor = openingCents / 100 / price;
  return data.map((bar) => ({...bar,open:bar.open*factor,high:bar.high*factor,low:bar.low*factor,close:bar.close*factor}));
}

const seconds: Record<string,number> = {"1m":60,"5m":300,"15m":900,"1h":3600,"4h":14400,"1d":86400};

function aggregate(data: Bar[], interval: string): Bar[] {
  const period = seconds[interval] ?? 300;
  const grouped = new Map<number,Bar>();
  for (const candle of data) {
    const time = Math.floor(candle.time / period) * period;
    const existing = grouped.get(time);
    if (existing) {
      existing.high = Math.max(existing.high,candle.high);
      existing.low = Math.min(existing.low,candle.low);
      existing.close = candle.close;
      existing.volume += candle.volume;
    } else grouped.set(time,{...candle,time});
  }
  return [...grouped.values()].sort((a,b) => a.time-b.time).map((bar) => ({
    ...bar, open:+bar.open.toFixed(4),high:+bar.high.toFixed(4),
    low:+bar.low.toFixed(4),close:+bar.close.toFixed(4),volume:+bar.volume.toFixed(3),
  }));
}

export async function chartData(symbol: string, interval: string) {
  if (!env.DB) throw new Error("Database unavailable");
  const db = env.DB;
  const [market,clock,trades] = await Promise.all([
    db.prepare("SELECT symbol,opening_price_cents,last_price_cents FROM markets WHERE symbol=?").bind(symbol)
      .first<{symbol:string;opening_price_cents:number;last_price_cents:number}>(),
    db.prepare("SELECT started_at FROM game_clock WHERE id=1").first<{started_at:number}>(),
    db.prepare("SELECT created_at,price_after_cents,shares_micros FROM trades WHERE symbol=? ORDER BY id DESC LIMIT 2000")
      .bind(symbol).all<{created_at:number;price_after_cents:number;shares_micros:number}>(),
  ]);
  if (!market || !clock) throw new Error("Market unavailable");
  const candles = history(symbol,market.opening_price_cents,clock.started_at);
  const live = trades.results.reverse();
  let last = market.opening_price_cents / 100;
  for (const trade of live) {
    const time = Math.floor(trade.created_at / 60_000) * 60;
    const price = trade.price_after_cents / 100;
    const previous = candles[candles.length-1];
    if (previous.time === time) {
      previous.high = Math.max(previous.high,price);
      previous.low = Math.min(previous.low,price);
      previous.close = price;
      previous.volume += trade.shares_micros / 1_000_000;
    } else candles.push({time,open:last,high:Math.max(last,price),low:Math.min(last,price),
      close:price,volume:trade.shares_micros / 1_000_000});
    last = price;
  }
  const nowBucket = Math.floor(Date.now() / 60_000) * 60;
  if (candles[candles.length-1].time < nowBucket) {
    const current = market.last_price_cents / 100;
    candles.push({time:nowBucket,open:last,high:Math.max(last,current),low:Math.min(last,current),close:current,volume:0});
  }
  return {bars:aggregate(candles,interval),source:"Fictional preseason candles plus actual in-game trades"};
}
