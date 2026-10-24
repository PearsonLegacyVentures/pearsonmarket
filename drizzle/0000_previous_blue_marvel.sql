CREATE TABLE `game_clock` (
	`id` integer PRIMARY KEY NOT NULL,
	`last_tick` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `holdings` (
	`user_id` text NOT NULL,
	`symbol` text NOT NULL,
	`shares_micros` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`user_id`, `symbol`)
);
--> statement-breakpoint
CREATE TABLE `markets` (
	`symbol` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`sector` text NOT NULL,
	`description` text NOT NULL,
	`tier` text NOT NULL,
	`opening_price_cents` integer NOT NULL,
	`cash_cents` integer NOT NULL,
	`shares_micros` integer NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`last_price_cents` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `news` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`symbol` text NOT NULL,
	`headline` text NOT NULL,
	`direction` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `players` (
	`user_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`cash_cents` integer NOT NULL,
	`is_bot` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `trade_guard` (
	`id` integer PRIMARY KEY NOT NULL,
	`ok` integer NOT NULL,
	CONSTRAINT "trade_guard_ok" CHECK("trade_guard"."ok" = 1)
);
--> statement-breakpoint
CREATE TABLE `trades` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`symbol` text NOT NULL,
	`side` text NOT NULL,
	`shares_micros` integer NOT NULL,
	`cash_cents` integer NOT NULL,
	`price_after_cents` integer NOT NULL,
	`created_at` integer NOT NULL
);
