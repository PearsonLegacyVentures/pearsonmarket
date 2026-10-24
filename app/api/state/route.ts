import { getGameUser } from "../../../lib/game-auth";
import { ensureGame, getState, maybeTick } from "../../../lib/market-engine";
import { settleLiquidations } from "../../../lib/perps";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getGameUser();
  if (!user) return Response.json({ error: "Join the market to play." }, { status: 401 });
  try {
    await ensureGame(user.userId, user.displayName);
    await maybeTick();
    await settleLiquidations();
    return Response.json(await getState(user.userId), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("State error", error);
    return Response.json({ error: "The market is unavailable. Try again shortly." }, { status: 500 });
  }
}
