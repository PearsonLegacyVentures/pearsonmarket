"use client";

import { useState } from "react";
import { ArrowUpRight, Crosshair, ShieldAlert, TrendingUp } from "lucide-react";
import { markPosition, type PositionRow } from "../lib/perp-math";

type MarketMark = { symbol: string; last_price_cents: number };
type Action = "close" | "add-margin" | "set-exits";

const money = (cents:number) => "US$"+(cents/100).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
const shares = (micros:number) => (micros/1_000_000).toLocaleString("en-US",{maximumFractionDigits:6});

export default function PositionBoard({positions,markets,activeSymbol,busy,onFocus,onAction}:{
  positions: PositionRow[]; markets: MarketMark[]; activeSymbol: string; busy: boolean;
  onFocus: (symbol:string) => void;
  onAction: (id:number,action:Action,values?:Record<string,unknown>) => Promise<boolean>;
}) {
  const [editingId,setEditingId]=useState<number|null>(null);
  const [marginId,setMarginId]=useState<number|null>(null);
  const [takeProfit,setTakeProfit]=useState("");
  const [stopLoss,setStopLoss]=useState("");
  const [marginExtra,setMarginExtra]=useState("100");

  if (!positions.length) return <div className="empty-state"><TrendingUp size={22}/><span>No futures positions yet. Open a long or short to see its levels here and on the chart.</span></div>;

  return <div className="position-board">
    <div className="position-board-head"><span><b>{positions.length}</b> OPEN FUTURES</span><small>Mark prices and exit levels update with the market</small></div>
    {positions.map((position) => {
      const market=markets.find((item)=>item.symbol===position.symbol);
      if (!market) return null;
      const mark=market.last_price_cents;
      const value=markPosition(position,mark);
      const distance=Math.max(0,(position.side==="LONG"?mark-value.approximateLiqPriceCents:value.approximateLiqPriceCents-mark)/mark*100);
      const risk=Math.max(0,Math.min(100,100-distance*8));
      const pnl=value.unrealizedPnlCents;
      const editing=editingId===position.id;
      return <article key={position.id} className={`position-card ${position.symbol===activeSymbol?"focused":""}`}>
        <div className="position-top"><button className="position-symbol" onClick={()=>onFocus(position.symbol)} title={`View ${position.symbol} on chart`}>
          <span className={`position-side ${position.side.toLowerCase()}`}>{position.side}</span><strong>{position.symbol}/USD</strong>
          <span className="leverage-tag">{position.leverage}×</span><Crosshair size={14}/>
        </button><div className="position-profit"><small>UNREALIZED P&L</small><strong className={pnl>=0?"gain":"loss"}>{pnl>=0?"+":""}{money(pnl)}</strong><span className={pnl>=0?"gain":"loss"}>{(pnl/position.margin_cents*100).toFixed(1)}% ROI</span></div></div>
        <div className="position-metrics">
          <div><small>ENTRY</small><b>{money(position.entry_price_cents)}</b></div>
          <div><small>MARK</small><b>{money(mark)}</b></div>
          <div><small>LIQ. ESTIMATE</small><b className="loss">{money(value.approximateLiqPriceCents)}</b></div>
          <div><small>TAKE PROFIT</small><b className={position.take_profit_cents!==null?"gain":"dim"}>{position.take_profit_cents===null?"Not set":money(position.take_profit_cents)}</b></div>
          <div><small>STOP LOSS</small><b className={position.stop_loss_cents!==null?"risk-amber":"dim"}>{position.stop_loss_cents===null?"Not set":money(position.stop_loss_cents)}</b></div>
          <div><small>SIZE / MARGIN</small><b>{shares(position.quantity_micros)} / {money(position.margin_cents)}</b></div>
        </div>
        <div className="position-risk-status"><span className={distance<5?"loss":""}><ShieldAlert size={13}/>{distance.toFixed(2)}% to liquidation</span><span>Est. exit value {money(value.closeReturnCents)}</span></div>
        <div className="position-risk-track" aria-hidden="true"><i style={{width:`${risk}%`}}/></div>
        <div className="position-actions">
          <button onClick={()=>{setEditingId(editing?null:position.id);setMarginId(null);setTakeProfit(position.take_profit_cents===null?"":(position.take_profit_cents/100).toFixed(2));setStopLoss(position.stop_loss_cents===null?"":(position.stop_loss_cents/100).toFixed(2));}}>TP / SL</button>
          <button onClick={()=>{setMarginId(marginId===position.id?null:position.id);setEditingId(null);}}>+ Margin</button>
          <button className="position-view" onClick={()=>onFocus(position.symbol)}>View chart <ArrowUpRight size={12}/></button>
          <button className="position-close" disabled={busy} onClick={()=>void onAction(position.id,"close")}>Close position</button>
        </div>
        {editing&&<div className="position-editor"><div className="position-editor-fields">
          <label htmlFor={`tp-${position.id}`}>TAKE PROFIT <span>USD</span><input id={`tp-${position.id}`} type="number" min="0.01" step="0.01" placeholder="Not set" value={takeProfit} onChange={(event)=>setTakeProfit(event.target.value)}/></label>
          <label htmlFor={`sl-${position.id}`}>STOP LOSS <span>USD</span><input id={`sl-${position.id}`} type="number" min="0.01" step="0.01" placeholder="Not set" value={stopLoss} onChange={(event)=>setStopLoss(event.target.value)}/></label>
        </div><p>{position.side==="LONG"?"Long: take profit above mark; stop loss below mark and before liquidation.":"Short: take profit below mark; stop loss above mark and before liquidation."} Leave a field blank to remove its level.</p>
          <button disabled={busy} onClick={()=>void onAction(position.id,"set-exits",{takeProfit,stopLoss}).then((ok)=>{if(ok)setEditingId(null);})}>Save exit levels</button>
        </div>}
        {marginId===position.id&&<div className="position-editor position-margin-editor"><label htmlFor={`extra-${position.id}`}>ADD ISOLATED MARGIN <span>USD</span><input id={`extra-${position.id}`} type="number" min="10" step="0.01" value={marginExtra} onChange={(event)=>setMarginExtra(event.target.value)}/></label><button disabled={busy} onClick={()=>void onAction(position.id,"add-margin",{amount:Number(marginExtra)}).then((ok)=>{if(ok)setMarginId(null);})}>Add margin</button><p>Adding margin moves the liquidation estimate; it does not change your position size.</p></div>}
      </article>;
    })}
    <div className="position-board-foot">Exit levels check the live mark after a trade or market tick. A price gap can close beyond your target; liquidation takes priority.</div>
  </div>;
}
