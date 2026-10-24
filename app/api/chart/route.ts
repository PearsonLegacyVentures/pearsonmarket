import { getChatGPTUser } from "../../chatgpt-auth";
import { ensureGame } from "../../../lib/market-engine";
import { chartData } from "../../../lib/chart-data";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in to view charts." }, { status: 401 });
  const url = new URL(request.url);
  const symbol = (url.searchParams.get("symbol") ?? "").toUpperCase();
  const interval = url.searchParams.get("interval") ?? "5m";
  if (!/^[A-Z]{3}$/.test(symbol) || !["1m","5m","15m","1h","4h","1d"].includes(interval))
    return Response.json({ error: "Invalid chart request." }, { status: 400 });
  try {
    await ensureGame(user.userId,user.displayName);
    return Response.json(await chartData(symbol,interval),{headers:{"Cache-Control":"no-store"}});
  } catch (error) {
    console.error("Chart error",error);
    return Response.json({error:"Chart unavailable."},{status:500});
  }
}
