import { getGameUser } from "../../../lib/game-auth";
import { ensureGame, findMarket } from "../../../lib/market-engine";
import { addMargin, closePosition, openPosition, settlePositionExits, updateExitLevels } from "../../../lib/perps";

export const dynamic = "force-dynamic";

function optionalPrice(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const price = Number(value);
  const cents = Math.round(price * 100);
  if (!Number.isFinite(price) || !Number.isSafeInteger(cents) || cents <= 0)
    throw new Error("Exit levels must be positive prices in USD.");
  return cents;
}

export async function POST(request: Request) {
  const user = await getGameUser();
  if (!user) return Response.json({ error: "Join the market to trade." }, { status: 401 });
  try {
    const body = await request.json() as { action?: unknown; symbol?: unknown; side?: unknown;
      margin?: unknown; leverage?: unknown; id?: unknown; amount?: unknown;
      takeProfit?: unknown; stopLoss?: unknown };
    await ensureGame(user.userId,user.displayName);
    if (body.action === "open") {
      const symbol = String(body.symbol ?? "").toUpperCase();
      const side = body.side;
      const marginCents = Math.round(Number(body.margin) * 100);
      const leverage = Number(body.leverage);
      if (!/^[A-Z]{3}$/.test(symbol) || (side !== "LONG" && side !== "SHORT") ||
          !Number.isSafeInteger(marginCents) || !Number.isSafeInteger(leverage)) {
        return Response.json({ error: "Invalid margin order." }, { status: 400 });
      }
      await settlePositionExits(symbol);
      const market = await findMarket(symbol);
      if (!market) return Response.json({ error: "Company not found." }, { status: 404 });
      return Response.json({ position: await openPosition(user.userId,market,side,marginCents,leverage,
        optionalPrice(body.takeProfit),optionalPrice(body.stopLoss)) });
    }
    const id = Number(body.id);
    if (!Number.isSafeInteger(id) || id <= 0) return Response.json({ error: "Invalid position." }, { status: 400 });
    if (body.action === "close") return Response.json({ result: await closePosition(user.userId,id) });
    if (body.action === "add-margin") {
      await settlePositionExits();
      const amountCents = Math.round(Number(body.amount) * 100);
      return Response.json({ result: await addMargin(user.userId,id,amountCents) });
    }
    if (body.action === "set-exits") {
      await settlePositionExits();
      return Response.json({ result: await updateExitLevels(user.userId,id,
        optionalPrice(body.takeProfit),optionalPrice(body.stopLoss)) });
    }
    return Response.json({ error: "Unknown position action." }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Position failed.";
    const known = /margin|cash|price changed|position|leverage|available|small|large|profit|loss|exit levels/i.test(message);
    if (!known) console.error("Perp error",error);
    return Response.json({ error: known ? message : "Position failed. Try again." }, { status: known ? 400 : 500 });
  }
}
