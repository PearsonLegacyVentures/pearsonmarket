CREATE TABLE `positions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`symbol` text NOT NULL,
	`side` text NOT NULL,
	`leverage` integer NOT NULL,
	`margin_cents` integer NOT NULL,
	`entry_fee_cents` integer NOT NULL,
	`entry_price_cents` integer NOT NULL,
	`quantity_micros` integer NOT NULL,
	`status` text DEFAULT 'OPEN' NOT NULL,
	`opened_at` integer NOT NULL,
	`closed_at` integer,
	`exit_price_cents` integer,
	`realized_pnl_cents` integer
);
--> statement-breakpoint
ALTER TABLE `game_clock` ADD `started_at` integer DEFAULT 0 NOT NULL;