import { requireChatGPTUser } from "./chatgpt-auth";
import Game from "./game";

export const dynamic = "force-dynamic";

export default async function Home() {
  await requireChatGPTUser("/");
  return <Game />;
}
