export const FUTURES_FEE_RATE = 0.0005;
export const MAINTENANCE_RATE = 0.01;

export type PositionRow = {
  id: number; user_id: string; symbol: string; side: "LONG" | "SHORT"; leverage: number;
  margin_cents: number; entry_fee_cents: number; entry_price_cents: number;
  quantity_micros: number; take_profit_cents: number | null; stop_loss_cents: number | null;
  status: "OPEN" | "CLOSED" | "LIQUIDATED"; close_reason: "MANUAL" | "TAKE_PROFIT" | "STOP_LOSS" | "LIQUIDATION" | null;
  opened_at: number; closed_at: number | null; exit_price_cents: number | null;
  realized_pnl_cents: number | null;
};

type PositionCore = Pick<PositionRow,"side" | "margin_cents" | "entry_price_cents" | "quantity_micros">;

export function markPosition(position: PositionCore, markPriceCents: number) {
  const direction = position.side === "LONG" ? 1 : -1;
  const currentNotionalCents = Math.round(position.quantity_micros * markPriceCents / 1_000_000);
  const unrealizedPnlCents = Math.round(direction * position.quantity_micros *
    (markPriceCents - position.entry_price_cents) / 1_000_000);
  const equityCents = position.margin_cents + unrealizedPnlCents;
  const maintenanceCents = Math.max(100, Math.ceil(currentNotionalCents * MAINTENANCE_RATE));
  const exitFeeCents = Math.ceil(currentNotionalCents * FUTURES_FEE_RATE);
  const liquidatable = equityCents <= maintenanceCents + exitFeeCents;
  const closeReturnCents = liquidatable ? 0 : Math.max(0, equityCents - exitFeeCents);
  const marginPerShare = position.margin_cents * 1_000_000 / position.quantity_micros;
  const rate = MAINTENANCE_RATE + FUTURES_FEE_RATE;
  const approximateLiqPriceCents = position.side === "LONG"
    ? Math.max(0, Math.round((position.entry_price_cents - marginPerShare) / (1 - rate)))
    : Math.round((position.entry_price_cents + marginPerShare) / (1 + rate));
  return { currentNotionalCents, unrealizedPnlCents, equityCents, maintenanceCents, exitFeeCents,
    closeReturnCents, approximateLiqPriceCents, liquidatable };
}

export type ExitReason = "LIQUIDATION" | "STOP_LOSS" | "TAKE_PROFIT";

export function exitReason(position: PositionRow, markPriceCents: number): ExitReason | null {
  // Liquidation takes priority if a gap crosses multiple levels at once.
  if (markPosition(position, markPriceCents).liquidatable) return "LIQUIDATION";
  if (position.stop_loss_cents !== null &&
    (position.side === "LONG" ? markPriceCents <= position.stop_loss_cents : markPriceCents >= position.stop_loss_cents)) return "STOP_LOSS";
  if (position.take_profit_cents !== null &&
    (position.side === "LONG" ? markPriceCents >= position.take_profit_cents : markPriceCents <= position.take_profit_cents)) return "TAKE_PROFIT";
  return null;
}

export function validateExitLevels(side: "LONG" | "SHORT", markPriceCents: number,
  liquidationPriceCents: number, takeProfitCents: number | null, stopLossCents: number | null) {
  for (const price of [takeProfitCents, stopLossCents]) {
    if (price !== null && (!Number.isSafeInteger(price) || price <= 0)) throw new Error("Exit levels must be positive prices in USD.");
  }
  if (takeProfitCents !== null && (side === "LONG" ? takeProfitCents <= markPriceCents : takeProfitCents >= markPriceCents))
    throw new Error(`Take profit must be ${side === "LONG" ? "above" : "below"} the current mark price.`);
  if (stopLossCents !== null) {
    if (side === "LONG" ? stopLossCents >= markPriceCents : stopLossCents <= markPriceCents)
      throw new Error(`Stop loss must be ${side === "LONG" ? "below" : "above"} the current mark price.`);
    if (side === "LONG" ? stopLossCents <= liquidationPriceCents : stopLossCents >= liquidationPriceCents)
      throw new Error("Stop loss must be before the estimated liquidation level.");
  }
}
