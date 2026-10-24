import { requireChatGPTUser } from "./chatgpt-auth";
import { gameAuthMode, getGameUser } from "../lib/game-auth";
import Game from "./game";
import GuestJoin from "./guest-join";

export const dynamic = "force-dynamic";

export default async function Home() {
  const mode=gameAuthMode();
  if(mode==="site")await requireChatGPTUser("/");
  else if(mode==="guest"){
    const user=await getGameUser();
    if(!user)return <GuestJoin/>;
  }else return <main className="join-screen"><div className="join-card"><h1>Game setup needed</h1><p>The host has not selected an authentication mode.</p></div></main>;
  return <Game />;
}
