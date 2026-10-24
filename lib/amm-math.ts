export type Pool = { cash_cents: number; shares_micros: number };
export type Side = "buy" | "sell";

// Spot orders swap virtual USD for fractional shares, or those shares for USD.
// The pool's price changes with every swap, regardless of player count.
export function quote(market: Pool, side: Side, units: number, feeRate = 0.0025) {
  if (!Number.isSafeInteger(units) || units <= 0) throw new Error("Enter a positive order size.");
  if (side === "buy") {
    const spent = units;
    const effective = Math.floor(spent * (1 - feeRate));
    const shares = Math.floor(market.shares_micros * effective / (market.cash_cents + effective));
    if (shares < 1) throw new Error("Order is too small.");
    const cash = market.cash_cents + effective;
    const inventory = market.shares_micros - shares;
    if (inventory <= 0) throw new Error("Insufficient pool inventory.");
    return { cashCents: spent, sharesMicros: shares, poolCashCents: cash, poolSharesMicros: inventory,
      afterCents: Math.round(cash * 1_000_000 / inventory) };
  }

  const shares = units;
  const gross = Math.floor(market.cash_cents * shares / (market.shares_micros + shares));
  const paid = Math.floor(gross * (1 - feeRate));
  if (paid <= 0) throw new Error("Order is too small.");
  const cash = market.cash_cents - gross;
  const inventory = market.shares_micros + shares;
  return { cashCents: paid, sharesMicros: shares, poolCashCents: cash, poolSharesMicros: inventory,
    afterCents: Math.round(cash * 1_000_000 / inventory) };
}
