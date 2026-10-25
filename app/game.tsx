"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, BarChart3, BookOpen, ChevronDown, Menu, Search, ShieldCheck, Wallet, X, Zap } from "lucide-react";
import TerminalChart from "./terminal-chart";
import PositionBoard from "./position-board";
import { STARTING_CASH_CENTS } from "../lib/market-data";
import { markPosition, type PositionRow } from "../lib/perp-math";

type Market = { symbol:string;name:string;sector:string;description:string;tier:string;opening_price_cents:number;cash_cents:number;shares_micros:number;last_price_cents:number;version:number };
type Holding = {symbol:string;shares_micros:number};
type Position = PositionRow;
type News = {id:number;symbol:string;headline:string;direction:string;created_at:number};
type Activity = {id:number;symbol:string;side:string;shares_micros:number;cash_cents:number;price_after_cents:number;created_at:number;name:string;is_bot:number};
type GameState = {market:Market[];player:{name:string;cashCents:number};positions:Holding[];futures:{open:Position[];history:Position[]};news:News[];activity:Activity[];leaderboard:{name:string;liquidationCents:number;isYou:boolean}[];feeRate:number;startedAt:number};

const cash=(cents:number,precision=2)=>"US$"+(cents/100).toLocaleString("en-US",{minimumFractionDigits:precision,maximumFractionDigits:precision});
const compact=(cents:number)=>cents>=100_000_000?`US$${(cents/100_000_000).toFixed(1)}m`:`US$${Math.round(cents/100_000).toLocaleString()}k`;
const qty=(micros:number)=> (micros/1_000_000).toLocaleString("en-US",{maximumFractionDigits:6});
const change=(m:Market)=>(m.last_price_cents/m.opening_price_cents-1)*100;
const ago=(timestamp:number)=>{const delta=Math.floor((Date.now()-timestamp)/1000);return delta<60?"now":delta<3600?`${Math.floor(delta/60)}m`:`${Math.floor(delta/3600)}h`;};

export default function Game(){
  const [state,setState]=useState<GameState|null>(null);
  const [symbol,setSymbol]=useState("PML");
  const [filter,setFilter]=useState("");
  const [mobileMarkets,setMobileMarkets]=useState(false);
  const [mode,setMode]=useState<"futures"|"spot">("spot");
  const [spotSide,setSpotSide]=useState<"buy"|"sell">("buy");
  const [amount,setAmount]=useState("100");
  const [margin,setMargin]=useState("100");
  const [leverage,setLeverage]=useState(3);
  const [takeProfit,setTakeProfit]=useState("");
  const [stopLoss,setStopLoss]=useState("");
  const [tab,setTab]=useState<"positions"|"history"|"holdings"|"trades">("positions");
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
  const chartPositions=useMemo(()=>(state?.futures.open??[]).filter((position)=>position.symbol===symbol),[state,symbol]);
  const watch=useMemo(()=>(state?.market??[]).filter((item)=>`${item.symbol} ${item.name} ${item.sector}`.toLowerCase().includes(filter.toLowerCase()))
    .sort((a,b)=>Math.abs(change(b))-Math.abs(change(a))||a.symbol.localeCompare(b.symbol)),[state,filter]);
  const held=state?.positions.find((item)=>item.symbol===symbol)?.shares_micros??0;
  const spotValue=state?.positions.reduce((sum,holding)=>{
    const m=state.market.find((item)=>item.symbol===holding.symbol);
    return m?sum+Math.floor(Math.floor(m.cash_cents*holding.shares_micros/(m.shares_micros+holding.shares_micros))*(1-state.feeRate)):sum;
  },0)??0;
  const futuresValue=state?.futures.open.reduce((sum,position)=>{
    const m=state.market.find((item)=>item.symbol===position.symbol);
    return m?sum+markPosition(position,m.last_price_cents).closeReturnCents:sum;
  },0)??0;
  const equity=(state?.player.cashCents??0)+spotValue+futuresValue;
  const accountChange=state?equity-STARTING_CASH_CENTS:0;
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
  async function post(url:string,body:Record<string,unknown>,success:string):Promise<boolean>{
    setBusy(true);setError("");setMessage("");
    try{
      const response=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
      const result=await response.json() as {error?:string;result?:{status?:string}};
      if(!response.ok)throw new Error(result.error??"Order failed");
      setMessage(result.result?.status==="LIQUIDATED"?"Position hit liquidation before it could close.":success);
      await refresh();
      return true;
    }catch(e){setError(e instanceof Error?e.message:"Order failed");await refresh();return false;}
    finally{setBusy(false);}
  }
  const open=(side:"LONG"|"SHORT")=>{
    if(!market)return;
    void post("/api/perps",{action:"open",symbol:market.symbol,side,margin:Number(margin),leverage,
      takeProfit,stopLoss},`${side} ${leverage}× opened on ${market.symbol}.`).then((ok)=>{if(ok)setTab("positions");});
  };
  const tradeSpot=()=>{
    if(!market)return;
    void post("/api/trade",{symbol:market.symbol,side:spotSide,amount:input},`${spotSide==="buy"?"Bought":"Sold"} ${market.symbol}.`);
  };
  const positionAction=(id:number,action:"close"|"add-margin"|"set-exits",values:Record<string,unknown>={})=>
    post("/api/perps",{action,id,...values},action==="close"?"Position closed.":action==="add-margin"?"Margin added.":"Exit levels saved.");
  const focusPosition=(next:string)=>{select(next);setMode("futures");setTab("positions");};

  return <div className="terminal-shell">
    <header className="topbar"><div className="topbrand"><div className="brand-icon">P<span>M</span></div><div><strong>PEARSON<span>MARKET</span></strong><small>THE BAHAMAS, REIMAGINED</small></div></div><nav><a href="#terminal" className="nav-on">Trade</a><a href="#markets">Markets</a><a href="#positions">Portfolio</a><a href="#leaderboard">Leaderboard</a></nav><div className="top-right"><span className="live-pill"><i/> SIMULATION LIVE</span><button onClick={()=>setGuide(!guide)}><BookOpen size={16}/> Rules</button><button className="mobile-menu" onClick={()=>setMobileMarkets(!mobileMarkets)} aria-label="Markets"><Menu size={18}/></button></div></header>
    <div className="ticker-tape" aria-label="Market ticker">{(state?.market??[]).map((m)=><button key={m.symbol} onClick={()=>select(m.symbol)} className={m.symbol===symbol?"active":""}><b>{m.symbol}</b><span className={change(m)>=0?"gain":"loss"}>{change(m)>=0?"+":""}{change(m).toFixed(2)}%</span></button>)}</div>

    {guide&&<div className="rules-panel"><button className="rules-close" onClick={()=>setGuide(false)} aria-label="Close rules"><X size={18}/></button><h2>How this market works</h2><div><p><b>Start with US$1,000.</b> Each stock trades as SYMBOL/USD. Buy with virtual USD to receive fractional shares in your wallet. To get USD back, sell those shares through the same spot pair. The AMM fills your order even if nobody else is online.</p><p><b>Futures:</b> Cash-settled isolated long/short positions at 1–10×. Opening futures does not itself move the spot price; the spot AMM sets the mark price. Margin is locked, 0.05% charged on entry and close.</p><p><b>Exit levels:</b> Set take profit and stop loss when opening a future or from its position card. The game checks the AMM mark after trades and market ticks and closes at the observed price. Liquidation takes priority if a price gap crosses multiple levels.</p><p><b>News & bots:</b> Bots trade with finite virtual budgets when the game is open. Events never force a price reset. Charts begin with fictional preseason candles, followed by actual game trades.</p></div><small>All companies, prices, money and contracts are fictional. No real securities, BISX data or cash.</small></div>}

    <div id="terminal" className="terminal-layout">
      <aside id="markets" className={`market-sidebar ${mobileMarkets?"show":""}`}><div className="section-title"><span>MARKETS</span><span>{state?.market.length??20} ASSETS</span></div><label className="market-search"><Search size={15}/><input aria-label="Search markets" placeholder="Search symbols, companies" value={filter} onChange={(e)=>setFilter(e.target.value)}/></label><div className="watch-head"><span>SYMBOL / NAME</span><span>LAST / CHG</span></div><div className="watch-list">{watch.map((m)=><button key={m.symbol} className={`watch-row ${symbol===m.symbol?"selected":""}`} onClick={()=>select(m.symbol)}><div><b>{m.symbol}</b><small>{m.name}</small></div><div className="watch-price"><b>{cash(m.last_price_cents)}</b><small className={change(m)>=0?"gain":"loss"}>{change(m)>=0?"+":""}{change(m).toFixed(2)}%</small></div></button>)}</div><div className="sidebar-note"><ShieldCheck size={15}/> ALL LISTINGS ARE FICTIONAL</div></aside>

      <main className="trade-center"><div className="instrument-head">{market?<><div className="instrument-id"><div className="symbol-badge">{market.symbol.slice(0,1)}</div><div><h1>{market.symbol}<span> / USD</span></h1><small>{market.name} · {market.sector}</small></div><ChevronDown size={16} className="mobile-symbol" onClick={()=>setMobileMarkets(!mobileMarkets)}/></div><div className={`instrument-price ${change(market)>=0?"gain":"loss"}`}><strong>{cash(market.last_price_cents)}</strong><span>{change(market)>=0?"+":""}{change(market).toFixed(2)}%</span></div><div className="instrument-stat"><small>OPEN</small><b>{cash(market.opening_price_cents)}</b></div><div className="instrument-stat"><small>POOL CASH</small><b>{compact(market.cash_cents)}</b></div><div className="instrument-stat"><small>DEPTH TIER</small><b>{market.tier.toUpperCase()}</b></div><div className="instrument-stat instrument-description"><small>THE BUSINESS</small><b>{market.description}</b></div></>:<div className="loading">Opening market…</div>}</div>
        {market&&<TerminalChart symbol={market.symbol} version={market.version} markPriceCents={market.last_price_cents} positions={chartPositions}/>}
        <div id="positions" className="positions-panel"><div className="table-tabs"><button className={tab==="positions"?"active":""} onClick={()=>setTab("positions")}>Positions <span>{state?.futures.open.length??0}</span></button><button className={tab==="history"?"active":""} onClick={()=>setTab("history")}>Position History</button><button className={tab==="holdings"?"active":""} onClick={()=>setTab("holdings")}>Spot Holdings <span>{state?.positions.length??0}</span></button><button className={tab==="trades"?"active":""} onClick={()=>setTab("trades")}>Trade Tape</button></div>
          {tab==="positions"&&<PositionBoard positions={state?.futures.open??[]} markets={state?.market??[]} activeSymbol={symbol} busy={busy} onFocus={focusPosition} onAction={positionAction}/> }
          {tab==="history"&&<div className="data-scroll">{state?.futures.history.length?<table><thead><tr><th>CONTRACT</th><th>STATUS</th><th>ENTRY / EXIT</th><th>LEVERAGE</th><th>REALIZED PNL</th><th>CLOSED</th></tr></thead><tbody>{state.futures.history.map((p)=><tr key={p.id}><td><b>{p.symbol}</b> <span className={p.side==="LONG"?"gain":"loss"}>{p.side}</span></td><td><span className={p.status==="LIQUIDATED"||p.close_reason==="STOP_LOSS"?"loss":"gain"}>{p.status==="LIQUIDATED"?"LIQUIDATED":p.close_reason==="TAKE_PROFIT"?"TAKE PROFIT":p.close_reason==="STOP_LOSS"?"STOP LOSS":"CLOSED"}</span></td><td>{cash(p.entry_price_cents)} / {cash(p.exit_price_cents??0)}</td><td>{p.leverage}×</td><td className={(p.realized_pnl_cents??0)>=0?"gain":"loss"}>{cash(p.realized_pnl_cents??0)}</td><td>{p.closed_at?new Date(p.closed_at).toLocaleString():"—"}</td></tr>)}</tbody></table>:<div className="empty-state">No closed positions.</div>}</div>}
          {tab==="holdings"&&<div className="data-scroll">{state?.positions.length?<table><thead><tr><th>COMPANY</th><th>SHARES</th><th>LAST</th><th>LIQUIDATION VALUE</th><th></th></tr></thead><tbody>{state.positions.map((holding)=>{const m=state.market.find((item)=>item.symbol===holding.symbol)!;const proceeds=Math.floor(Math.floor(m.cash_cents*holding.shares_micros/(m.shares_micros+holding.shares_micros))*(1-state.feeRate));return <tr key={holding.symbol}><td><b>{holding.symbol}</b> <span className="dim">{m.name}</span></td><td>{qty(holding.shares_micros)}</td><td>{cash(m.last_price_cents)}</td><td>{cash(proceeds)}</td><td><button className="table-action" onClick={()=>{select(m.symbol);setMode("spot");setSpotSide("sell");setAmount((holding.shares_micros/1_000_000).toFixed(6));}}>Sell to USD <ArrowRight size={12}/></button></td></tr>})}</tbody></table>:<div className="empty-state">No spot holdings yet.</div>}</div>}
          {tab==="trades"&&<div className="data-scroll">{state?.activity.length?<table><thead><tr><th>TIME</th><th>ACTOR</th><th>SYMBOL</th><th>SIDE</th><th>SIZE</th><th>PRICE AFTER</th></tr></thead><tbody>{state.activity.map((trade)=><tr key={trade.id}><td>{ago(trade.created_at)}</td><td>{trade.name}</td><td><b>{trade.symbol}</b></td><td className={trade.side==="buy"?"gain":"loss"}>{trade.side.toUpperCase()}</td><td>{qty(trade.shares_micros)}</td><td>{cash(trade.price_after_cents)}</td></tr>)}</tbody></table>:<div className="empty-state">The tape is quiet. Make the first trade.</div>}</div>}
        </div>
      </main>

      <aside className="order-sidebar"><div className="order-tabs"><button className={mode==="spot"?"active":""} onClick={()=>setMode("spot")}>Spot</button><button className={mode==="futures"?"active":""} onClick={()=>setMode("futures")}>Futures</button></div>
        {mode==="futures"?<div className="order-content"><div className="order-settings"><span>ISOLATED MARGIN</span><span className="lev-pill">{leverage}×</span></div><div className="market-order-type"><span>Market order</span><span>Virtual perpetual</span></div><label className="field-label" htmlFor="margin">MARGIN TO LOCK <small>Available {cash(state?.player.cashCents??0)}</small></label><div className="amount-input"><input id="margin" type="number" min="100" step="10" value={margin} onChange={(e)=>setMargin(e.target.value)}/><b>USD</b></div><div className="slider-label"><span>LEVERAGE</span><strong>{leverage}×</strong></div><input className="leverage-slider" type="range" min="1" max="10" step="1" value={leverage} onChange={(e)=>setLeverage(Number(e.target.value))} aria-label="Leverage"/><div className="leverage-stops">{[1,3,5,7,10].map((v)=><button key={v} className={leverage===v?"active":""} onClick={()=>setLeverage(v)}>{v}×</button>)}</div><div className="exit-ticket"><div className="exit-ticket-head">OPTIONAL EXIT LEVELS <span>USD / SHARE</span></div><div className="exit-ticket-fields"><label htmlFor="ticket-tp">Take profit<input id="ticket-tp" type="number" min="0.01" step="0.01" placeholder="Not set" value={takeProfit} onChange={(event)=>setTakeProfit(event.target.value)}/></label><label htmlFor="ticket-sl">Stop loss<input id="ticket-sl" type="number" min="0.01" step="0.01" placeholder="Not set" value={stopLoss} onChange={(event)=>setStopLoss(event.target.value)}/></label></div><small>Long TP above mark, SL below. Short TP below mark, SL above. You can edit levels later.</small></div><div className="order-summary"><div><span>NOTIONAL SIZE</span><strong>{Number.isFinite(notional)?cash(notional):"—"}</strong></div><div><span>ENTRY / MARK</span><strong>{market?cash(market.last_price_cents):"—"}</strong></div><div><span>ENTRY FEE (0.05%)</span><strong>{Number.isFinite(futuresFee)?cash(futuresFee):"—"}</strong></div><div><span>LONG LIQ. ESTIMATE</span><strong className="loss">{market&&virtualQty?cash(liqLong):"—"}</strong></div><div><span>SHORT LIQ. ESTIMATE</span><strong className="loss">{market&&virtualQty?cash(liqShort):"—"}</strong></div></div><div className="side-actions"><button className="go-long" disabled={busy||!market||!Number.isFinite(marginCents)||marginCents<10_000||marginCents+futuresFee>(state?.player.cashCents??0)} onClick={()=>open("LONG")}>Buy / Long</button><button className="go-short" disabled={busy||!market||!Number.isFinite(marginCents)||marginCents<10_000||marginCents+futuresFee>(state?.player.cashCents??0)} onClick={()=>open("SHORT")}>Sell / Short</button></div><p className="risk-line"><Zap size={15}/> At {leverage}×, a roughly {(100/leverage).toFixed(1)}% adverse move can wipe out margin before maintenance and fees.</p></div>
        :<div className="order-content"><div className="order-settings"><span>SPOT MARKET</span><span className="lev-pill">1×</span></div><div className="market-order-type"><span>Market order</span><span>AMM execution</span></div><div className="buy-sell-tabs"><button className={spotSide==="buy"?"active buy":""} onClick={()=>{setSpotSide("buy");setAmount("100");}}>Buy</button><button className={spotSide==="sell"?"active sell":""} onClick={()=>{setSpotSide("sell");setAmount((held/1_000_000).toFixed(6));}}>Sell</button></div><label className="field-label" htmlFor="spot-amount">{spotSide==="buy"?"AMOUNT TO SPEND":"SHARES TO SELL"}<small>{spotSide==="buy"?`Available ${cash(state?.player.cashCents??0)}`:`Owned ${qty(held)}`}</small></label><div className="amount-input"><input id="spot-amount" type="number" min={spotSide==="buy"?"10":"0.000001"} step={spotSide==="buy"?"0.01":"0.000001"} value={amount} onChange={(e)=>setAmount(e.target.value)}/><b>{spotSide==="buy"?"USD":symbol}</b></div><div className="quick-spot">{(spotSide==="buy"?[10,25,50,100]:[25,50,100]).map((value)=><button key={value} onClick={()=>setAmount(spotSide==="buy"?(Math.floor((state?.player.cashCents??0)*value/100)/100).toFixed(2):(Math.floor(held*value/100)/1_000_000).toFixed(6))}>{value}%</button>)}</div><div className="order-summary"><div><span>{spotSide==="buy"?"EST. SHARES RECEIVED":"EST. CASH RECEIVED"}</span><strong>{spotQuote?spotSide==="buy"?`${qty(spotQuote.shares)} ${symbol}`:cash(spotQuote.proceeds):"—"}</strong></div><div><span>SPOT AFTER ORDER</span><strong>{spotQuote?cash(spotQuote.after):"—"}</strong></div><div><span>PRICE IMPACT</span><strong className={spotQuote&&spotQuote.impact>=0?"gain":"loss"}>{spotQuote?`${spotQuote.impact>=0?"+":""}${spotQuote.impact.toFixed(2)}%`:"—"}</strong></div><div><span>POOL FEE</span><strong>0.25%</strong></div></div><button className={`spot-submit ${spotSide}`} disabled={busy||!spotQuote||(spotSide==="buy"&&(spotQuote.proceeds>(state?.player.cashCents??0)||spotQuote.proceeds<1_000))||(spotSide==="sell"&&(spotQuote.shares>held||spotQuote.shares<1))} onClick={tradeSpot}>{spotSide==="buy"?"Buy":"Sell"} {symbol}</button><p className="risk-line">Your USD buys actual game shares. Sell them on this pair to receive USD again; each swap changes the shared price.</p></div>}
        <div className="account-box"><div className="section-title"><span>ACCOUNT</span><Wallet size={16}/></div><div className="account-equity">{state?cash(equity):"US$—"}<small>ESTIMATED LIQUIDATION EQUITY</small></div><div className={`account-pnl ${accountChange>=0?"gain":"loss"}`}>{accountChange>=0?"+":""}{cash(accountChange)} since start</div><div className="account-row"><span>Starting USD</span><strong>{cash(STARTING_CASH_CENTS)}</strong></div><div className="account-row"><span>Available USD</span><strong>{cash(state?.player.cashCents??0)}</strong></div><div className="account-row"><span>Spot exit value</span><strong>{cash(spotValue)}</strong></div><div className="account-row"><span>Futures exit value</span><strong>{cash(futuresValue)}</strong></div><div className="account-row"><span>Open positions</span><strong>{state?.futures.open.length??0}</strong></div></div>
      </aside>
    </div>

    {(error||message)&&<div className={`toast ${error?"error":"success"}`} role="status"><span>{error||message}</span><button onClick={()=>{setError("");setMessage("");}} aria-label="Dismiss"><X size={16}/></button></div>}

    <div className="below-grid"><section className="feed-panel"><div className="section-title"><span><Zap size={15}/> MARKET PULSE</span><span>NEWS → TRADES → PRICE</span></div><div className="feed-items">{(state?.news??[]).map((item)=><button key={item.id} onClick={()=>select(item.symbol)}><span className={`news-signal ${item.direction}`}/><div><small>{item.symbol} · {ago(item.created_at)}</small><p>{item.headline}</p></div><ArrowRight size={14}/></button>)}</div></section><section id="leaderboard" className="leader-panel"><div className="section-title"><span><BarChart3 size={15}/> LEADERBOARD</span><span>EXIT VALUE</span></div>{(state?.leaderboard??[]).slice(0,10).map((player,i)=><div className={`leader-row ${player.isYou?"self":""}`} key={i}><span>{String(i+1).padStart(2,"0")}</span><strong>{player.isYou?"You":player.name}</strong><b>{cash(player.liquidationCents,0)}</b></div>)}</section></div>
    <footer><div><span className="brand-icon mini">PM</span> PEARSON MARKET <span className="footer-divider">/</span> VIRTUAL EXCHANGE</div><p>Educational simulation. Fictional companies, money and market history. Unaffiliated with BISX or its issuers. No live investment or financial product.</p><span>MARKETS MOVE. SO DO YOU.</span></footer>
  </div>;
}
