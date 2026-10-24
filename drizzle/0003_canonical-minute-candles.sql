CREATE TABLE `market_candles_1m` (
	`symbol` text NOT NULL,
	`minute` integer NOT NULL,
	`open_cents` integer NOT NULL,
	`high_cents` integer NOT NULL,
	`low_cents` integer NOT NULL,
	`close_cents` integer NOT NULL,
	`volume_micros` integer NOT NULL,
	PRIMARY KEY(`symbol`, `minute`)
);
--> statement-breakpoint
-- Rebuild existing live candles from the trade tape in execution order.
WITH ordered AS (
  SELECT t.symbol, (t.created_at / 60000) * 60 AS minute,
    t.created_at, t.id, t.price_after_cents, t.shares_micros,
    COALESCE(LAG(t.price_after_cents) OVER
      (PARTITION BY t.symbol ORDER BY t.created_at,t.id), m.opening_price_cents) AS before_cents
  FROM trades t JOIN markets m ON m.symbol = t.symbol
), ranked AS (
  SELECT *,
    ROW_NUMBER() OVER (PARTITION BY symbol,minute ORDER BY created_at,id) AS first_trade,
    ROW_NUMBER() OVER (PARTITION BY symbol,minute ORDER BY created_at DESC,id DESC) AS last_trade
  FROM ordered
)
INSERT INTO market_candles_1m
  (symbol,minute,open_cents,high_cents,low_cents,close_cents,volume_micros)
SELECT symbol,minute,
  MAX(CASE WHEN first_trade = 1 THEN before_cents END),
  MAX(MAX(before_cents,price_after_cents)),
  MIN(MIN(before_cents,price_after_cents)),
  MAX(CASE WHEN last_trade = 1 THEN price_after_cents END),
  SUM(shares_micros)
FROM ranked GROUP BY symbol,minute;
