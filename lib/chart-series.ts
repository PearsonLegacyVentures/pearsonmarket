export type Bar = { time:number; open:number; high:number; low:number; close:number; volume:number };
export const PERIOD_SECONDS = { "1m":60, "5m":300, "15m":900, "30m":1800,
  "1h":3600, "4h":14400, "1d":86400, "1w":604800 } as const;
export type Interval = keyof typeof PERIOD_SECONDS;
export const BAR_LIMIT: Record<Interval,number> = {
  "1m":2880, "5m":2016, "15m":1344, "30m":1344,
  "1h":1344, "4h":588, "1d":98, "1w":14,
};

const FIVE_MINUTES = 300;
const HISTORY_DAYS = 98;
const MONDAY_OFFSET = 3 * 86400; // Unix epoch was Thursday; weeks start Monday UTC.

export function bucketTime(time:number, interval:Interval) {
  const period = PERIOD_SECONDS[interval];
  return interval === "1w"
    ? Math.floor((time + MONDAY_OFFSET) / period) * period - MONDAY_OFFSET
    : Math.floor(time / period) * period;
}

function hash(input:string) {
  let value=2166136261;
  for (let i=0;i<input.length;i++) value=Math.imul(value ^ input.charCodeAt(i),16777619);
  return value>>>0;
}

function random(seed:number) {
  let value=seed;
  return () => {
    value+=0x6D2B79F5;
    let t=value;
    t=Math.imul(t ^ t>>>15,t|1);
    t^=t+Math.imul(t ^ t>>>7,t|61);
    return ((t ^ t>>>14)>>>0)/4294967296;
  };
}

// The fictional backstory is one deterministic 5-minute series for all views.
// One-minute backstory subdivides its most recent bars, preserving each parent's OHLCV.
export function preseasonFiveMinute(symbol:string, openingCents:number, startedAtMs:number):Bar[] {
  const rand=random(hash(symbol));
  const count=HISTORY_DAYS*24*12;
  const ending=Math.floor(startedAtMs/300_000)*FIVE_MINUTES-FIVE_MINUTES;
  let price=openingCents/100*(0.9+rand()*0.2);
  const result:Bar[]=[];
  for(let i=0;i<count;i++){
    const open=price;
    price=Math.max(.05,open*Math.exp((rand()-.5)*.0024));
    const excursion=open*(.0001+rand()*.0012);
    result.push({time:ending-(count-i-1)*FIVE_MINUTES,open,
      high:Math.max(open,price)+excursion*rand(),
      low:Math.max(.01,Math.min(open,price)-excursion*rand()),
      close:price,volume:50+rand()*5000});
  }
  const factor=openingCents/100/price;
  return result.map((bar)=>({...bar,open:bar.open*factor,high:bar.high*factor,
    low:bar.low*factor,close:bar.close*factor}));
}

export function minuteBackstory(symbol:string, fiveMinuteBars:Bar[], fromTime:number):Bar[] {
  const result:Bar[]=[];
  for(const bar of fiveMinuteBars){
    if(bar.time+240<fromTime)continue;
    const rand=random(hash(`${symbol}:${bar.time}`));
    const highIndex=Math.floor(rand()*5);
    const lowIndex=(highIndex+1+Math.floor(rand()*4))%5;
    const weights=Array.from({length:5},()=>.5+rand());
    const weightSum=weights.reduce((sum,weight)=>sum+weight,0);
    let open=bar.open,usedVolume=0;
    for(let i=0;i<5;i++){
      const close=i===4?bar.close:Math.max(bar.low,Math.min(bar.high,
        bar.open+(bar.close-bar.open)*(i+1)/5+(rand()-.5)*(bar.high-bar.low)*.12));
      const volume=i===4?bar.volume-usedVolume:bar.volume*weights[i]/weightSum;
      usedVolume+=volume;
      const time=bar.time+i*60;
      if(time>=fromTime)result.push({time,open,high:i===highIndex?bar.high:Math.max(open,close),
        low:i===lowIndex?bar.low:Math.min(open,close),close,volume});
      open=close;
    }
  }
  return result;
}

export function aggregate(bars:Bar[], interval:Interval):Bar[] {
  const grouped=new Map<number,Bar>();
  for(const bar of bars){
    const time=bucketTime(bar.time,interval);
    const prior=grouped.get(time);
    if(prior){
      prior.high=Math.max(prior.high,bar.high);
      prior.low=Math.min(prior.low,bar.low);
      prior.close=bar.close;
      prior.volume+=bar.volume;
    }else grouped.set(time,{...bar,time});
  }
  return [...grouped.values()].sort((a,b)=>a.time-b.time).map((bar)=>({
    ...bar,open:+bar.open.toFixed(4),high:+bar.high.toFixed(4),
    low:+bar.low.toFixed(4),close:+bar.close.toFixed(4),volume:+bar.volume.toFixed(3),
  }));
}

export function joinAndFill(history:Bar[],live:Bar[],interval:Interval,nowSeconds:number,
  lastPrice:number,priorLivePrice?:number):Bar[] {
  const grouped=new Map<number,Bar>();
  for(const bar of [...history,...live]){
    const earlier=grouped.get(bar.time);
    if(earlier)grouped.set(bar.time,{time:bar.time,open:earlier.open,
      high:Math.max(earlier.high,bar.high),low:Math.min(earlier.low,bar.low),
      close:bar.close,volume:earlier.volume+bar.volume});
    else grouped.set(bar.time,{...bar});
  }
  const sorted=[...grouped.values()].sort((a,b)=>a.time-b.time);
  const period=PERIOD_SECONDS[interval];
  const end=bucketTime(nowSeconds,interval);
  const requestedStart=end-(BAR_LIMIT[interval]-1)*period;
  const start=requestedStart;
  let previous=priorLivePrice??sorted.filter((bar)=>bar.time<start).at(-1)?.close
    ??sorted.find((bar)=>bar.time>=start)?.open??lastPrice;
  const result:Bar[]=[];
  for(let time=start;time<=end;time+=period){
    const bar=grouped.get(time);
    if(bar){result.push(bar);previous=bar.close;}
    else result.push({time,open:previous,high:previous,low:previous,close:previous,volume:0});
  }
  return result;
}
