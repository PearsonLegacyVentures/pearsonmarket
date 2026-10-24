"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDownLeft, ArrowRight, ArrowUpRight, BarChart3, BookOpen, ChevronDown, Clock3, Menu, Search, ShieldCheck, TrendingUp, Wallet, X, Zap } from "lucide-react";
import TerminalChart from "./terminal-chart";

type Market = { symbol:string;name:string;sector:string;description:string;tier:string;opening_price_cents:number;cash_cents:number;shares_micros:number;last_price_cents:number;version:number };
type Holding = {symbol:string;shares_micros:number};
type Position = {id:number;user_id:string;symbol:string;side:"LONG"|"SHORT";leverage:number;margin_cents:number;entry_fee_cents:number;entry_price_cents:number;quantity_micros:number;status:"OPEN"|"CLOSED"|"LIQUIDATED";opened_at:number;closed_at:number|null;exit_price_cents:number|null;realized_pnl_cents:number|null};
type News = {id:number;symbol:string;headline:string;direction:string;created_at:number};
type Activity = {id:number;symbol:string;side:string;shares_micros:number;cash_cents:number;price_after_cents:number;created_at:number;name:string;is_bot:number};
type GameState = {market:Market[];player:{name:string;cashCents:number};positions:Holding[];futures:{open:Position[];history:Position[]};news:News[];activity:Activity[];leaderboard:{name:string;liquidationCents:number;isYou:boolean}[];feeRate:number;startedAt:number};

const cash=(cents:number,precision=2)=>"B$"+(cents/100).toLocaleString("en-US",{minimumFractionDigits:precision,maximumFractionDigits:precision});
const compact=(cents:number)=>cents>=100_000_000?`B$${(cents/100_000_000).toFixed(1)}m`:`B$${Math.round(cents/100_000).toLocaleString()}k`;
const qty=(micros:number)=> (micros/1_000_000).toLocaleString("en-US",{maximumFractionDigits:3});
const change=(m:Market)=>(m.last_price_cents/m.opening_price_cents-1)*100;
const ago=(timestamp:number)=>{const delta=Math.floor((Date.now()-timestamp)/1000);return delta<60?"now":delta<3600?`${Math.floor(delta/60)}m`:`${Math.floor(delta/3600)}h`;};

function valuation(position:Position,mark:number){
  const pnl=Math.round((position.side==="LONG"?1:-1)*position.quantity_micros*(mark-position.entry_price_cents)/1_000_000);
  const notional=Math.round(position.quantity_micros*mark/1_000_000);
  const equity=position.margin_cents+pnl;
  const maintenance=Math.max(100,Math.ceil(notional*.01));
  const exitFee=Math.ceil(notional*.0005);
  const liquidatable=equity<=maintenance+exitFee;
  const payout=liquidatable?0:Math.max(0,equity-exitFee);
  const perShare=position.margin_cents*1_000_000/position.quantity_micros;
  const liquidation=position.side==="LONG"?(position.entry_price_cents-perShare)/.9895:(position.entry_price_cents+perShare)/1.0105;
  return {pnl,equity,payout,liquidatable,liquidation:Math.max(0,Math.round(liquidation))};
}

export default function Game(){
  const [state,setState]=useState<GameState|null>(null);
  const [symbol,setSymbol]=useState("PML");
  const [filter,setFilter]=useState("");
  const [mobileMarkets,setMobileMarkets]=useState(false);
  const [mode,setMode]=useState<"futures"|"spot">("futures");
  const [spotSide,setSpotSide]=useState<"buy"|"sell">("buy");
  const [amount,setAmount]=useState("1000");
  const [margin,setMargin]=useState("1000");
  const [leverage,setLeverage]=useState(3);
  const [tab,setTab]=useState<"positions"|"history"|"holdings"|"trades">("positions");
  const [marginId,setMarginId]=useState<number|null>(null);
  const [marginExtra,setMarginExtra]=useState("100");
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [error,setError]=useState("");
  const [guide,setGuide]=useState(false);

  const refresh=useCallback(async()=>{
    try{
      const response=await fetch("/api/state",{cache:"no-store"});
      const body=await response.json() as GameState & {error?:string};
      if(!response.ok)throw new Error(body.error??"Market unavailable");
      setState(body);setError("");
    }catch(e){setError(e instanceof Error?e.message:"Market unavailable");}
  },[]);
  useEffect(()=>{void refresh();const timer=setInterval(()=>void refresh(),15_000);return()=>clearInterval(timer);},[refresh]);
  const market=state?.market.find((item)=>item.symbol===symbol)??state?.market[0];
  const watch=useMemo(()=>(state?.market??[]).filter((item)=>`${item.symbol} ${item.name} ${item.sector}`.toLowerCase().includes(filter.toLowerCase()))
    .sort((a,b)=>Math.abs(change(b))-Math.abs(change(a))||a.symbol.localeCompare(b.symbol)),[state,filter]);
  const held=state?.positions.find((item)=>item.symbol===symbol)?.shares_micros??0;
  const spotValue=state?.positions.reduce((sum,holding)=>{
    const m=state.market.find((item)=>item.symbol===holding.symbol);
    return m?sum+Math.floor(Math.floor(m.cash_cents*holding.shares_micros/(m.shares_micros+holding.shares_micros))*(1-state.feeRate)):sum;
  },0)??0;
  const futuresValue=state?.futures.open.reduce((sum,position)=>{
    const m=state.market.find((item)=>item.symbol===position.symbol);
    return m?sum+valuation(position,m.last_price_cents).payout:sum;
  },0)??0;
  const equity=(state?.player.cashCents??0)+spotValue+futuresValue;
  const accountChange=equity-10_000_000;
  const notional=Math.round(Number(margin)*100*leverage);
  const marginCents=Math.round(Number(margin)*100);
  const futuresFee=Math.ceil(notional*.0005);
  const virtualQty=market&&notional>0?Math.floor(notional*1_000_000/market.last_price_cents):0;
  const liqLong=market&&virtualQty>0?Math.max(0,Math.round((market.last_price_cents-marginCents*1_000_000/virtualQty)/.9895)):0;
  const liqShort=market&&virtualQty>0?Math.round((market.last_price_cents+marginCents*1_000_000/virtualQty)/1.0105):0;
  let spotQuote:{shares:number;proceeds:number;after:number;impact:number}|null=null;
  const input=Number(amount);
  if(market&&Number.isFinite(input)&&input>0){
    if(spotSide==="buy"){
      const spend=Math.round(input*100),effective=Math.floor(spend*(1-(state?.feeRate??.0025)));
      const shares=Math.floor(market.shares_micros*effective/(market.cash_cents+effective));
      const nextCash=market.cash_cents+effective,nextShares=market.shares_micros-shares;
      const after=Math.round(nextCash*1_000_000/nextShares);
      spotQuote={shares,proceeds:spend,after,impact:(after/market.last_price_cents-1)*100};
    }else{
      const shares=Math.round(input*1_000_000),gross=Math.floor(market.cash_cents*shares/(market.shares_micros+shares));
      const proceeds=Math.floor(gross*(1-(state?.feeRate??.0025)));
      const after=Math.round((market.cash_cents-gross)*1_000_000/(market.shares_micros+shares));
      spotQuote={shares,proceeds,after,impact:(after/market.last_price_cents-1)*100};
    }
  }

  function select(next:string){setSymbol(next);setMobileMarkets(false);setMessage("");}
  async function post(url:string,body:Record<string,unknown>,success:string){
    setBusy(true);setError("");setMessage("");
    try{
      const response=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
      const result=await response.json() as {error?:string;result?:{status?:string}};
      if(!response.ok)throw new Error(result.error??"Order failed");
      setMessage(result.result?.status==="LIQUIDATED"?"Position hit liquidation before it could close.":success);
      await refresh();
    }catch(e){setError(e instanceof Error?e.message:"Order failed");await refresh();}
    finally{setBusy(false);}
  }
  const open=(side:"LONG"|"SHORT")=>{
    if(!market)return;
    void post("/api/perps",{action:"open",symbol:market.symbol,side,margin:Number(margin),leverage},`${side} ${leverage}× opened on ${market.symbol}.`);
  };
  const tradeSpot=()=>{
    if(!market)return;
    void post("/api/trade",{symbol:market.symbol,side:spotSide,amount:input},`${spotSide==="buy"?"Bought":"Sold"} ${market.symbol}.`);
  };

  return <div className="terminal-shell">
    <header className="topbar"><div className="topbrand"><div className="brand-icon">P<span>M</span></div><div><strong>PEARSON<span>MARKET</span></strong><small>THE BAHAMAS, REIMAGINED</small></div></div><nav><a href="#terminal" className="nav-on">Trade</a><a href="#markets">Markets</a><a href="#positions">Portfolio</a><a href="#leaderboard">Leaderboard</a></nav><div className="top-right"><span className="live-pill"><i/> SIMULATION LIVE</span><button onClick={()=>setGuide(!guide)}><BookOpen size={16}/> Rules</button><button className="mobile-menu" onClick={()=>setMobileMarkets(!mobileMarkets)} aria-label="Markets"><Menu size={18}/></button></div></header>
    <div className="ticker-tape" aria-label="Market ticker">{(state?.market??[]).map((m)=><button key={m.symbol} onClick={()=>select(m.symbol)} className={m.symbol===symbol?"active":""}><b>{m.symbol}</b><span className={change(m)>=0?"gain":"loss"}>{change(m)>=0?"+":""}{change(m).toFixed(2)}%</span></button>)}</div>

    {guide&&<div className="rules-panel"><button className="rules-close" onClick={()=>setGuide(false)} aria-label="Close rules"><X size={18}/></button><h2>How this market works</h2><div><p><b>Spot:</b> AMM orders move the shared price. The pool fills even if nobody else is online. Pools hold B$500k–B$2m in virtual cash.</p><p><b>Futures:</b> Cash-settled isolated long/short positions at 1–10×. Opening futures does not itself move the spot price; the spot AMM sets the mark price. Margin is locked, 0.05% charged on entry and close.</p><p><b>Liquidation:</b> When equity falls to maintenance margin (1% of current notional) plus closing fee, the position closes and locked margin is lost. Price gaps can jump over the displayed estimate.</p><p><b>News & bots:</b> Bots trade with finite virtual budgets when the game is open. Events never force a price reset. Charts begin with fictional preseason candles, followed by actual game trades.</p></div><small>All companies, prices, money and contracts are fictional. No real securities, BISX data or cash.</small></div>}

    <div id="terminal" className="terminal-layout">
      <aside id="markets" className={`market-sidebar ${mobileMarkets?"show":""}`}><div className="section-title"><span>MARKETS</span><span>{state?.market.length??20} ASSETS</span></div><label className="market-search"><Search size={15}/><input aria-label="Search markets" placeholder="Search symbols, companies" value={filter} onChange={(e)=>setFilter(e.target.value)}/></label><div className="watch-head"><span>SYMBOL / NAME</span><span>LAST / CHG</span></div><div className="watch-list">{watch.map((m)=><button key={m.symbol} className={`watch-row ${symbol===m.symbol?"selected":""}`} onClick={()=>select(m.symbol)}><div><b>{m.symbol}</b><small>{m.name}</small></div><div className="watch-price"><b>{cash(m.last_price_cents)}</b><small className={change(m)>=0?"gain":"loss"}>{change(m)>=0?"+":""}{change(m).toFixed(2)}%</small></div></button>)}</div><div className="sidebar-note"><ShieldCheck size={15}/> ALL LISTINGS ARE FICTIONAL</div></aside>

      <main className="trade-center"><div className="instrument-head">{market?<><div className="instrument-id"><div className="symbol-badge">{market.symbol.slice(0,1)}</div><div><h1>{market.symbol}<span> / B$</span></h1><small>{market.name} · {market.sector}</small></div><ChevronDown size={16} className="mobile-symbol" onClick={()=>setMobileMarkets(!mobileMarkets)}/></div><div className={`instrument-price ${change(market)>=0?"gain":"loss"}`}><strong>{cash(market.last_price_cents)}</strong><span>{change(market)>=0?"+":""}{change(market).toFixed(2)}%</span></div><div className="instrument-stat"><small>OPEN</small><b>{cash(market.opening_price_cents)}</b></div><div className="instrument-stat"><small>POOL CASH</small><b>{compact(market.cash_cents)}</b></div><div className="instrument-stat"><small>DEPTH TIER</small><b>{market.tier.toUpperCase()}</b></div><div className="instrument-stat instrument-description"><small>THE BUSINESS</small><b>{market.description}</b></div></>:<div className="loading">Opening market…</div>}</div>
        {market&&<TerminalChart symbol={market.symbol} version={market.version}/>}
        <div id="positions" className="positions-panel"><div className="table-tabs"><button className={tab==="positions"?"active":""} onClick={()=>setTab("positions")}>Positions <span>{state?.futures.open.length??0}</span></button><button className={tab==="history"?"active":""} onClick={()=>setTab("history")}>Position History</button><button className={tab==="holdings"?"active":""} onClick={()=>setTab("holdings")}>Spot Holdings <span>{state?.positions.length??0}</span></button><button className={tab==="trades"?"active":""} onClick={()=>setTab("trades")}>Trade Tape</button></div>
          {tab==="positions"&&<div className="data-scroll">{state?.futures.open.length?<table><thead><tr><th>CONTRACT</th><th>SIZE</th><th>ENTRY / MARK</th><th>LIQ. PRICE</th><th>MARGIN</th><th>UPNL / ROI</th><th>ACTION</th></tr></thead><tbody>{state.futures.open.map((p)=>{const m=state.market.find((item)=>item.symbol===p.symbol);if(!m)return null;const v=valuation(p,m.last_price_cents);return <tr key={p.id}><td><b className={p.side==="LONG"?"gain":"loss"}>{p.side}</b> <b>{p.symbol}</b> <span className="leverage-tag">{p.leverage}×</span></td><td>{qty(p.quantity_micros)}</td><td>{cash(p.entry_price_cents)} <span className="dim">/ {cash(m.last_price_cents)}</span></td><td className="loss">{cash(v.liquidation)}</td><td>{cash(p.margin_cents)}</td><td><strong className={v.pnl>=0?"gain":"loss"}>{v.pnl>=0?"+":""}{cash(v.pnl)}</strong><small className={v.pnl>=0?"gain":"loss"}>{(v.pnl/p.margin_cents*100).toFixed(1)}%</small></td><td><button className="table-action" disabled={busy} onClick={()=>void post("/api/perps",{action:"close",id:p.id},`Closed ${p.symbol} ${p.side}.`)}>Close</button><button className="table-action quiet" onClick={()=>setMarginId(marginId===p.id?null:p.id)}>+ Margin</button>{marginId===p.id&&<div className="add-margin"><input type="number" aria-label="Additional margin in B$" min="10" value={marginExtra} onChange={(e)=>setMarginExtra(e.target.value)}/><button disabled={busy} onClick={()=>void post("/api/perps",{action:"add-margin",id:p.id,amount:Number(marginExtra)},`Added ${cash(Math.round(Number(marginExtra)*100))} margin.`).then(()=>setMarginId(null))}>Add</button></div>}</td></tr>})}</tbody></table>:<div className="empty-state"><TrendingUp size={22}/><span>No futures positions yet. Choose margin and a direction to make your first move.</span></div>}</div>}
          {tab==="history"&&<div className="data-scroll">{state?.futures.history.length?<table><thead><tr><th>CONTRACT</th><th>STATUS</th><th>ENTRY / EXIT</th><th>LEVERAGE</th><th>REALIZED PNL</th><th>CLOSED</th></tr></thead><tbody>{state.futures.history.map((p)=><tr key={p.id}><td><b>{p.symbol}</b> <span className={p.side==="LONG"?"gain":"loss"}>{p.side}</span></td><td><span className={p.status==="LIQUIDATED"?"loss":"gain"}>{p.status}</span></td><td>{cash(p.entry_price_cents)} / {cash(p.exit_price_cents??0)}</td><td>{p.leverage}×</td><td className={(p.realized_pnl_cents??0)>=0?"gain":"loss"}>{cash(p.realized_pnl_cents??0)}</td><td>{p.closed_at?new Date(p.closed_at).toLocaleString():"—"}</td></tr>)}</tbody></table>:<div className="empty-state">No closed positions.</div>}</div>}
          {tab==="holdings"&&<div className="data-scroll">{state?.positions.length?<table><thead><tr><th>COMPANY</th><th>SHARES</th><th>LAST</th><th>LIQUIDATION VALUE</th><th></th></tr></thead><tbody>{state.positions.map((holding)=>{const m=state.market.find((item)=>item.symbol===holding.symbol)!;const proceeds=Math.floor(Math.floor(m.cash_cents*holding.shares_micros/(m.shares_micros+holding.shares_micros))*(1-state.feeRate));return <tr key={holding.symbol}><td><b>{holding.symbol}</b> <span className="dim">{m.name}</span></td><td>{qty(holding.shares_micros)}</td><td>{cash(m.last_price_cents)}</td><td>{cash(proceeds)}</td><td><button className="table-action" onClick={()=>{select(m.symbol);setMode("spot");setSpotSide("sell");setAmount((holding.shares_micros/1_000_000).toFixed(3));}}>Trade <ArrowRight size={12}/></button></td></tr>})}</tbody></table>:<div className="empty-state">No spot holdings yet.</div>}</div>}
          {tab==="trades"&&<div className="data-scroll">{state?.activity.length?<table><thead><tr><th>TIME</th><th>ACTOR</th><th>SYMBOL</th><th>SIDE</th><th>SIZE</th><th>PRICE AFTER</th></tr></thead><tbody>{state.activity.map((trade)=><tr key={trade.id}><td>{ago(trade.created_at)}</td><td>{trade.name}</td><td><b>{trade.symbol}</b></td><td className={trade.side==="buy"?"gain":"loss"}>{trade.side.toUpperCase()}</td><td>{qty(trade.shares_micros)}</td><td>{cash(trade.price_after_cents)}</td></tr>)}</tbody></table>:<div className="empty-state">The tape is quiet. Make the first trade.</div>}</div>}
        </div>
      </main>

      <aside className="order-sidebar"><div className="order-tabs"><button className={mode==="futures"?"active":""} onClick={()=>setMode("futures")}>Futures</button><button className={mode==="spot"?"active":""} onClick={()=>setMode("spot")}>Spot</button></div>
        {mode==="futures"?<div className="order-content"><div className="order-settings"><span>ISOLATED MARGIN</span><span className="lev-pill">{leverage}×</span></div><div className="market-order-type"><span>Market order</span><span>Virtual perpetual</span></div><label className="field-label" htmlFor="margin">MARGIN TO LOCK <small>Available {cash(state?.player.cashCents??0)}</small></label><div className="amount-input"><input id="margin" type="number" min="100" step="10" value={margin} onChange={(e)=>setMargin(e.target.value)}/><b>B$</b></div><div className="slider-label"><span>LEVERAGE</span><strong>{leverage}×</strong></div><input className="leverage-slider" type="range" min="1" max="10" step="1" value={leverage} onChange={(e)=>setLeverage(Number(e.target.value))} aria-label="Leverage"/><div className="leverage-stops">{[1,3,5,7,10].map((v)=><button key={v} className={leverage===v?"active":""} onClick={()=>setLeverage(v)}>{v}×</button>)}</div><div className="order-summary"><div><span>NOTIONAL SIZE</span><strong>{Number.isFinite(notional)?cash(notional):"—"}</strong></div><div><span>ENTRY / MARK</span><strong>{market?cash(market.last_price_cents):"—"}</strong></div><div><span>ENTRY FEE (0.05%)</span><strong>{Number.isFinite(futuresFee)?cash(futuresFee):"—"}</strong></div><div><span>LONG LIQ. ESTIMATE</span><strong className="loss">{market&&virtualQty?cash(liqLong):"—"}</strong></div><div><span>SHORT LIQ. ESTIMATE</span><strong className="loss">{market&&virtualQty?cash(liqShort):"—"}</strong></div></div><div className="side-actions"><button className="go-long" disabled={busy||!market||!Number.isFinite(marginCents)||marginCents<10_000||marginCents+futuresFee>(state?.player.cashCents??0)} onClick={()=>open("LONG")}>Buy / Long</button><button className="go-short" disabled={busy||!market||!Number.isFinite(marginCents)||marginCents<10_000||marginCents+futuresFee>(state?.player.cashCents??0)} onClick={()=>open("SHORT")}>Sell / Short</button></div><p className="risk-line"><Zap size={15}/> At {leverage}×, a roughly {(100/leverage).toFixed(1)}% adverse move can wipe out margin before maintenance and fees.</p></div>
        :<div className="order-content"><div className="order-settings"><span>SPOT MARKET</span><span className="lev-pill">1×</span></div><div className="market-order-type"><span>Market order</span><span>AMM execution</span></div><div className="buy-sell-tabs"><button className={spotSide==="buy"?"active buy":""} onClick={()=>{setSpotSide("buy");setAmount("1000");}}>Buy</button><button className={spotSide==="sell"?"active sell":""} onClick={()=>{setSpotSide("sell");setAmount("10");}}>Sell</button></div><label className="field-label" htmlFor="spot-amount">{spotSide==="buy"?"AMOUNT TO SPEND":"SHARES TO SELL"}<small>{spotSide==="buy"?`Available ${cash(state?.player.cashCents??0)}`:`Owned ${qty(held)}`}</small></label><div className="amount-input"><input id="spot-amount" type="number" min={spotSide==="buy"?"100":"0.001"} step={spotSide==="buy"?"1":"0.001"} value={amount} onChange={(e)=>setAmount(e.target.value)}/><b>{spotSide==="buy"?"B$":symbol}</b></div><div className="quick-spot">{(spotSide==="buy"?[1000,5000,10000]:[25,50,100]).map((value)=><button key={value} onClick={()=>setAmount(spotSide==="buy"?String(value):(Math.floor(held*value/100/1000)/1000).toFixed(3))}>{spotSide==="buy"?cash(value*100,0):`${value}%`}</button>)}</div><div className="order-summary"><div><span>{spotSide==="buy"?"EST. SHARES RECEIVED":"EST. CASH RECEIVED"}</span><strong>{spotQuote?spotSide==="buy"?`${qty(spotQuote.shares)} ${symbol}`:cash(spotQuote.proceeds):"—"}</strong></div><div><span>SPOT AFTER ORDER</span><strong>{spotQuote?cash(spotQuote.after):"—"}</strong></div><div><span>PRICE IMPACT</span><strong className={spotQuote&&spotQuote.impact>=0?"gain":"loss"}>{spotQuote?`${spotQuote.impact>=0?"+":""}${spotQuote.impact.toFixed(2)}%`:"—"}</strong></div><div><span>POOL FEE</span><strong>0.25%</strong></div></div><button className={`spot-submit ${spotSide}`} disabled={busy||!spotQuote||(spotSide==="buy"&&(spotQuote.proceeds>(state?.player.cashCents??0)||spotQuote.proceeds<10_000))||(spotSide==="sell"&&(spotQuote.shares>held||spotQuote.shares<1000))} onClick={tradeSpot}>{spotSide==="buy"?"Buy":"Sell"} {symbol}</button><p className="risk-line">Orders fill against the shared pool. Bigger orders move the next price.</p></div>}
        <div className="account-box"><div className="section-title"><span>ACCOUNT</span><Wallet size={16}/></div><div className="account-equity">{state?cash(equity):"B$—"}<small>ESTIMATED LIQUIDATION EQUITY</small></div><div className={`account-pnl ${accountChange>=0?"gain":"loss"}`}>{accountChange>=0?"+":""}{cash(accountChange)} since start</div><div className="account-row"><span>Available cash</span><strong>{cash(state?.player.cashCents??0)}</strong></div><div className="account-row"><span>Spot exit value</span><strong>{cash(spotValue)}</strong></div><div className="account-row"><span>Futures exit value</span><strong>{cash(futuresValue)}</strong></div><div className="account-row"><span>Open positions</span><strong>{state?.futures.open.length??0}</strong></div></div>
      </aside>
    </div>

    {(error||message)&&<div className={`toast ${error?"error":"success"}`} role="status"><span>{error||message}</span><button onClick={()=>{setError("");setMessage("");}} aria-label="Dismiss"><X size={16}/></button></div>}

    <div className="below-grid"><section className="feed-panel"><div className="section-title"><span><Zap size={15}/> MARKET PULSE</span><span>NEWS → TRADES → PRICE</span></div><div className="feed-items">{(state?.news??[]).map((item)=><button key={item.id} onClick={()=>select(item.symbol)}><span className={`news-signal ${item.direction}`}/><div><small>{item.symbol} · {ago(item.created_at)}</small><p>{item.headline}</p></div><ArrowRight size={14}/></button>)}</div></section><section id="leaderboard" className="leader-panel"><div className="section-title"><span><BarChart3 size={15}/> LEADERBOARD</span><span>EXIT VALUE</span></div>{(state?.leaderboard??[]).slice(0,10).map((player,i)=><div className={`leader-row ${player.isYou?"self":""}`} key={i}><span>{String(i+1).padStart(2,"0")}</span><strong>{player.isYou?"You":player.name}</strong><b>{cash(player.liquidationCents,0)}</b></div>)}</section></div>
    <footer><div><span className="brand-icon mini">PM</span> PEARSON MARKET <span className="footer-divider">/</span> VIRTUAL EXCHANGE</div><p>Educational simulation. Fictional companies, money and market history. Unaffiliated with BISX or its issuers. No live investment or financial product.</p><span>MARKETS MOVE. SO DO YOU.</span></footer>
  </div>;
}
