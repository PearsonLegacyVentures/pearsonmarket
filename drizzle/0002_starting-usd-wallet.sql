-- Custom SQL migration file, put your code below! --
-- Existing accounts that have never traded receive the new US$1,000 start.
-- Preserve all accounts with trades, stock balances, or futures history.
UPDATE players SET cash_cents = 100000
WHERE is_bot = 0 AND cash_cents = 10000000
  AND NOT EXISTS (SELECT 1 FROM trades WHERE trades.user_id = players.user_id)
  AND NOT EXISTS (SELECT 1 FROM positions WHERE positions.user_id = players.user_id)
  AND NOT EXISTS (SELECT 1 FROM holdings WHERE holdings.user_id = players.user_id AND holdings.shares_micros > 0);
