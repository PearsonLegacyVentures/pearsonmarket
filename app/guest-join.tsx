"use client";

import { useState } from "react";

export default function GuestJoin() {
  const [name,setName]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  async function join(event:React.FormEvent<HTMLFormElement>) {
    event.preventDefault();setBusy(true);setError("");
    try {
      const response=await fetch("/api/join",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({name})});
      const result=await response.json() as {error?:string};
      if(!response.ok)throw new Error(result.error??"Could not join.");
      window.location.assign("/");
    }catch(cause){setError(cause instanceof Error?cause.message:"Could not join.");setBusy(false);}
  }
  return <main className="join-screen"><section className="join-card">
    <div className="join-brand"><span className="brand-icon">P<span>M</span></span><b>PEARSON<span>MARKET</span></b></div>
    <p className="join-kicker">THE BAHAMAS · VIRTUAL EXCHANGE</p>
    <h1>Trade the island. Read the market.</h1>
    <p className="join-intro">Start with US$1,000 in virtual cash. Trade fictional Bahamian companies through stock/USD pairs, hold fractional shares, and make your moves count.</p>
    <form onSubmit={(event)=>void join(event)}><label htmlFor="player-name">YOUR TRADING NAME</label>
      <input id="player-name" autoComplete="nickname" maxLength={24} minLength={2} required value={name}
        onChange={(event)=>setName(event.target.value)} placeholder="Enter your name"/>
      <button disabled={busy} type="submit">{busy?"Opening your wallet…":"Enter the market →"}</button>
      {error&&<p role="alert" className="join-error">{error}</p>}
    </form><small>Simulation only. No real money, stocks, or BISX data. Your wallet is saved in this browser.</small>
  </section></main>;
}
