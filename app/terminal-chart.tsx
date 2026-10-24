"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CandlestickSeries, ColorType, createChart, HistogramSeries, LineSeries,
  type IChartApi, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import { Camera, ChartCandlestick, Eraser, Maximize2, Minus, MousePointer2, PencilRuler, RotateCcw, Square, TrendingUp, Undo2 } from "lucide-react";

export type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number };
type Tool = "cursor" | "trend" | "horizontal" | "rectangle" | "measure";
type Point = { time: number; price: number };
type Drawing = { id: number; tool: Exclude<Tool,"cursor">; points: Point[] };
const intervals = ["1m","5m","15m","1h","4h","1d"];

function movingAverage(candles: Candle[], window: number) {
  let sum = 0;
  return candles.flatMap((bar,index) => {
    sum += bar.close;
    if (index >= window) sum -= candles[index-window].close;
    return index < window-1 ? [] : [{time:bar.time as UTCTimestamp,value:+(sum/window).toFixed(5)}];
  });
}

export default function TerminalChart({symbol,version}:{symbol:string;version:number}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi|null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick">|null>(null);
  const lineRef = useRef<ISeriesApi<"Line">|null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram">|null>(null);
  const maRefs = useRef<ISeriesApi<"Line">[]>([]);
  const drawingsRef = useRef<Drawing[]>([]);
  const pendingRef = useRef<Point|null>(null);
  const toolRef = useRef<Tool>("cursor");
  const hydratedRef = useRef(false);
  const lastSeriesKeyRef = useRef("");
  const lastFetchKeyRef = useRef("");
  const [interval,setIntervalValue] = useState("5m");
  const [bars,setBars] = useState<Candle[]>([]);
  const [tool,setTool] = useState<Tool>("cursor");
  const [drawings,setDrawings] = useState<Drawing[]>([]);
  const [pending,setPending] = useState<Point|null>(null);
  const [geometry,setGeometry] = useState(0);
  const [showMA,setShowMA] = useState(true);
  const [showVolume,setShowVolume] = useState(true);
  const [chartType,setChartType] = useState<"candle"|"line">("candle");
  const [source,setSource] = useState("");
  const [chartError,setChartError] = useState("");

  useEffect(() => { toolRef.current = tool; },[tool]);
  useEffect(() => { drawingsRef.current = drawings; },[drawings]);
  useEffect(() => { pendingRef.current = pending; },[pending]);
  useEffect(() => {
    hydratedRef.current=false;
    try {
      const saved = localStorage.getItem(`pearson-drawings-${symbol}`);
      setDrawings(saved ? JSON.parse(saved) as Drawing[] : []);
      setPending(null);
    } catch { setDrawings([]); }
  },[symbol]);
  useEffect(() => {
    if(!hydratedRef.current){hydratedRef.current=true;return;}
    try { localStorage.setItem(`pearson-drawings-${symbol}`,JSON.stringify(drawings)); } catch { /* local preference */ }
  },[drawings,symbol]);
  useEffect(() => { const handler=(event:KeyboardEvent)=>{if(event.key==="Escape"){setTool("cursor");setPending(null);}};window.addEventListener("keydown",handler);return()=>window.removeEventListener("keydown",handler);},[]);

  useEffect(() => {
    const host = containerRef.current;
    if (!host) return;
    const chart = createChart(host,{
      width:host.clientWidth,height:host.clientHeight,
      layout:{background:{type:ColorType.Solid,color:"#0d1219"},textColor:"#8c98a8",fontFamily:"Arial, Helvetica, sans-serif",fontSize:11},
      grid:{vertLines:{color:"#202933"},horzLines:{color:"#202933"}},
      crosshair:{vertLine:{color:"#647687",style:2},horzLine:{color:"#647687",style:2}},
      rightPriceScale:{borderColor:"#33404b",scaleMargins:{top:.07,bottom:.23}},
      timeScale:{borderColor:"#33404b",timeVisible:true,secondsVisible:false,rightOffset:8,barSpacing:7},
      handleScroll:{mouseWheel:true,pressedMouseMove:true,horzTouchDrag:true,vertTouchDrag:false},
    });
    chartRef.current = chart;
    const candle = chart.addSeries(CandlestickSeries,{upColor:"#17c895",downColor:"#f04c5d",borderVisible:false,wickUpColor:"#17c895",wickDownColor:"#f04c5d",priceFormat:{type:"price",precision:4,minMove:.0001}});
    const line = chart.addSeries(LineSeries,{color:"#eebc65",lineWidth:2,visible:false,priceFormat:{type:"price",precision:4,minMove:.0001}});
    const volume = chart.addSeries(HistogramSeries,{priceScaleId:"",priceFormat:{type:"volume"},lastValueVisible:false,priceLineVisible:false});
    volume.priceScale().applyOptions({scaleMargins:{top:.80,bottom:0}});
    const ma = ["#e9c466","#4d9beb","#9467ff"].map((color) => chart.addSeries(LineSeries,{color,lineWidth:1,priceLineVisible:false,lastValueVisible:false}));
    candleRef.current=candle;lineRef.current=line;volumeRef.current=volume;maRefs.current=ma;
    chart.timeScale().subscribeVisibleTimeRangeChange(() => setGeometry((v) => v+1));
    chart.subscribeClick((params) => {
      if (toolRef.current === "cursor" || !params.point) return;
      const time = chart.timeScale().coordinateToTime(params.point.x);
      const price = candle.coordinateToPrice(params.point.y);
      if (typeof time !== "number" || price === null) return;
      const point = {time,price};
      if (toolRef.current === "horizontal") {
        setDrawings((current) => [...current,{id:Date.now(),tool:"horizontal",points:[point]}]);
        setTool("cursor");
      } else if (pendingRef.current) {
        setDrawings((current) => [...current,{id:Date.now(),tool:toolRef.current as Exclude<Tool,"cursor">,points:[pendingRef.current!,point]}]);
        setPending(null);pendingRef.current=null;setTool("cursor");
      } else { setPending(point);pendingRef.current=point; }
    });
    const observer = new ResizeObserver(() => { chart.applyOptions({width:host.clientWidth,height:host.clientHeight});setGeometry((v)=>v+1); });
    observer.observe(host);
    return () => { observer.disconnect();chart.remove();chartRef.current=null;candleRef.current=null;lineRef.current=null;volumeRef.current=null;maRefs.current=[]; };
  },[]);

  useEffect(() => {
    let active = true;
    const key=`${symbol}:${interval}`;
    if(lastFetchKeyRef.current!==key){setBars([]);lastFetchKeyRef.current=key;}
    fetch(`/api/chart?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}`,{cache:"no-store"})
      .then(async (response) => { const data = await response.json() as {bars?:Candle[];source?:string;error?:string};if(!response.ok)throw new Error(data.error??"Chart unavailable");return data; })
      .then((data) => { if(active){setBars(data.bars??[]);setSource(data.source??"");setChartError("");} })
      .catch((error) => { if(active)setChartError(error instanceof Error?error.message:"Chart unavailable"); });
    return () => { active=false; };
  },[symbol,interval,version]);

  useEffect(() => {
    if (!candleRef.current || !lineRef.current || !volumeRef.current) return;
    candleRef.current.setData(bars.map((b) => ({time:b.time as UTCTimestamp,open:b.open,high:b.high,low:b.low,close:b.close})));
    lineRef.current.setData(bars.map((b) => ({time:b.time as UTCTimestamp,value:b.close})));
    volumeRef.current.setData(bars.map((b) => ({time:b.time as UTCTimestamp,value:b.volume,color:b.close>=b.open?"#16483c":"#502b35"})));
    [7,25,99].forEach((window,i) => maRefs.current[i]?.setData(movingAverage(bars,window)));
    if(bars.length&&lastSeriesKeyRef.current!==`${symbol}:${interval}`){
      chartRef.current?.timeScale().setVisibleLogicalRange({from:Math.max(0,bars.length-110),to:bars.length+7});
      lastSeriesKeyRef.current=`${symbol}:${interval}`;
    }
    setGeometry((v)=>v+1);
  },[bars,symbol,interval]);
  useEffect(() => {
    candleRef.current?.applyOptions({visible:chartType==="candle"});
    lineRef.current?.applyOptions({visible:chartType==="line"});
    volumeRef.current?.applyOptions({visible:showVolume});
    maRefs.current.forEach((series) => series.applyOptions({visible:showMA}));
  },[chartType,showVolume,showMA]);

  const coords = useCallback((point:Point) => {
    const chart=chartRef.current,series=candleRef.current;
    if(!chart||!series)return null;
    const x=chart.timeScale().timeToCoordinate(point.time as UTCTimestamp);
    const y=series.priceToCoordinate(point.price);
    return x===null||y===null?null:{x,y};
  },[]);
  void geometry;
  const graphics = [...drawings,...(pending ? [{id:-1,tool:tool==="cursor"?"trend":tool,points:[pending,pending]} as Drawing] : [])].flatMap((drawing) => {
    const start=coords(drawing.points[0]);if(!start)return [];
    const end=coords(drawing.points[1]??drawing.points[0])??start;
    const stroke=drawing.tool==="measure"?"#f1c36c":"#63aaff";
    if(drawing.tool==="horizontal")return [<line key={drawing.id} x1="0" x2="100%" y1={start.y} y2={start.y} stroke={stroke} strokeWidth="1.5" strokeDasharray="5 3"/>];
    if(drawing.tool==="rectangle")return [<rect key={drawing.id} x={Math.min(start.x,end.x)} y={Math.min(start.y,end.y)} width={Math.abs(end.x-start.x)} height={Math.abs(end.y-start.y)} fill="#63aaff17" stroke={stroke} strokeWidth="1.5"/>];
    return [<g key={drawing.id}><line x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke={stroke} strokeWidth="2"/>{drawing.tool==="measure"&&drawing.points.length>1&&<text x={end.x+6} y={end.y-6} fill={stroke} fontSize="11">{((drawing.points[1].price/drawing.points[0].price-1)*100).toFixed(2)}%</text>}</g>];
  });

  function screenshot() {
    const image=chartRef.current?.takeScreenshot(true);
    if(!image)return;
    const anchor=document.createElement("a");anchor.href=image.toDataURL("image/png");anchor.download=`${symbol}-${interval}-chart.png`;anchor.click();
  }

  return <section className="terminal-chart">
    <div className="chart-toolbar"><div className="timeframes">{intervals.map((value) => <button key={value} className={interval===value?"on":""} onClick={() => setIntervalValue(value)}>{value}</button>)}</div><span className="toolbar-divider"/><button title="Candles or line" onClick={() => setChartType(chartType==="candle"?"line":"candle")}><ChartCandlestick size={16}/> <span>{chartType==="candle"?"Candles":"Line"}</span></button><button className={showMA?"on":""} onClick={() => setShowMA(!showMA)}>MA 7/25/99</button><button className={showVolume?"on":""} onClick={() => setShowVolume(!showVolume)}>Volume</button><span className="toolbar-spacer"/><button title="Reset chart" onClick={() => chartRef.current?.timeScale().fitContent()}><RotateCcw size={16}/></button><button title="Save chart image" onClick={screenshot}><Camera size={16}/></button></div>
    <div className="chart-body"><div className="drawing-tools">
      {([{name:"cursor",icon:MousePointer2,label:"Crosshair"},{name:"trend",icon:TrendingUp,label:"Trend line"},{name:"horizontal",icon:Minus,label:"Horizontal line"},{name:"rectangle",icon:Square,label:"Rectangle"},{name:"measure",icon:PencilRuler,label:"Measure move"}] as const).map(({name,icon:Icon,label}) => <button title={label} aria-label={label} key={name} className={tool===name?"active":""} onClick={() => {setTool(name);setPending(null);}}><Icon size={19}/></button>)}
      <span className="tool-break"/><button title="Undo drawing" aria-label="Undo drawing" onClick={() => setDrawings((items)=>items.slice(0,-1))}><Undo2 size={19}/></button><button title="Clear drawings" aria-label="Clear drawings" onClick={() => setDrawings([])}><Eraser size={19}/></button></div>
      <div className="chart-canvas-wrap"><div ref={containerRef} className="chart-canvas"/><svg className="drawing-overlay" aria-hidden="true">{graphics}</svg><div className="chart-watermark">{symbol} <small>· PEARSON MARKET</small></div>{chartError&&<div className="chart-error">{chartError}</div>}{tool!=="cursor"&&<div className="draw-hint">{pending?"Click the end point":"Click the chart to draw"} · Esc selects cursor</div>}</div>
    </div><div className="chart-footer"><span>{source||"Loading market chart…"}</span><span>Charts by <a href="https://www.tradingview.com/lightweight-charts/" target="_blank" rel="noreferrer">TradingView</a> <Maximize2 size={12}/></span></div>
  </section>;
}
