// Both bot and human spot swaps persist their minute candle in the market batch.
export const UPSERT_MINUTE_CANDLE = `INSERT INTO market_candles_1m
  (symbol,minute,open_cents,high_cents,low_cents,close_cents,volume_micros)
  VALUES (?,?,?,?,?,?,?)
  ON CONFLICT(symbol,minute) DO UPDATE SET
    high_cents=MAX(market_candles_1m.high_cents,excluded.high_cents),
    low_cents=MIN(market_candles_1m.low_cents,excluded.low_cents),
    close_cents=excluded.close_cents,
    volume_micros=market_candles_1m.volume_micros+excluded.volume_micros`;

// Only known interval lengths from chart-series are passed by the API.
export function liveBucketsSql(period:number,mondayWeek:boolean) {
  const shift=mondayWeek?259200:0;
  const bucket=`((minute + ${shift}) / ${period}) * ${period} - ${shift}`;
  return `WITH source AS (
    SELECT minute,open_cents,high_cents,low_cents,close_cents,volume_micros,
      ${bucket} AS bucket FROM market_candles_1m
    WHERE symbol=? AND minute>=? AND minute<=?
  ), ranked AS (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY bucket ORDER BY minute) AS first_row,
      ROW_NUMBER() OVER (PARTITION BY bucket ORDER BY minute DESC) AS last_row FROM source
  )
  SELECT bucket AS time,MAX(CASE WHEN first_row=1 THEN open_cents END) AS open_cents,
    MAX(high_cents) AS high_cents,MIN(low_cents) AS low_cents,
    MAX(CASE WHEN last_row=1 THEN close_cents END) AS close_cents,
    SUM(volume_micros) AS volume_micros
  FROM ranked GROUP BY bucket ORDER BY bucket`;
}
