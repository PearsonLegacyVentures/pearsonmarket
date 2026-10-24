export const FUTURES_FEE_RATE = 0.0005;
export const MAINTENANCE_RATE = 0.01;

export type PositionRow = {
  id: number; user_id: string; symbol: string; side: "LONG" | "SHORT"; leverage: number;
  margin_cents: number; entry_fee_cents: number; entry_price_cents: number;
  quantity_micros: number; status: "OPEN" | "CLOSED" | "LIQUIDATED";
  opened_at: number; closed_at: number | null; exit_price_cents: number | null;
  realized_pnl_cents: number | null;
};

export function markPosition(position: PositionRow, markPriceCents: number) {
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
