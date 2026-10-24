import { getChatGPTUser } from "../../chatgpt-auth";
import { ensureGame, executeTrade, findMarket } from "../../../lib/market-engine";
import { settleLiquidations } from "../../../lib/perps";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in to play." }, { status: 401 });
  try {
    const payload = (await request.json()) as { symbol?: unknown; side?: unknown; amount?: unknown };
    const symbol = String(payload.symbol ?? "").toUpperCase();
    const side = payload.side;
    const amount = Number(payload.amount);
    if (!/^[A-Z]{3}$/.test(symbol) || (side !== "buy" && side !== "sell") ||
        !Number.isFinite(amount) || amount <= 0) {
      return Response.json({ error: "Enter a valid stock and order size." }, { status: 400 });
    }
    const units = side === "buy" ? Math.round(amount * 100) : Math.round(amount * 1_000_000);
    if (!Number.isSafeInteger(units) || (side === "buy" && units < 10_000) ||
        (side === "sell" && units < 1_000)) {
      return Response.json({ error: "Minimum buy B$100 or sell 0.001 shares." }, { status: 400 });
    }
    await ensureGame(user.userId, user.displayName);
    const market = await findMarket(symbol);
    if (!market) return Response.json({ error: "Company not found." }, { status: 404 });
    const trade = await executeTrade(user.userId, market, side, units);
    await settleLiquidations(symbol);
    return Response.json({ trade });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Trade failed.";
    const isConflict = message.includes("market changed");
    const expected = /cash|shares|order|pool|small|market changed/i.test(message);
    if (!expected) console.error("Trade error", error);
    return Response.json({ error: expected ? message : "Trade failed. Try again." }, { status: isConflict ? 409 : expected ? 400 : 500 });
  }
}
