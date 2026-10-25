# Pearson Market

A fictional Bahamian trading game. Twenty invented companies share one market. Human spot orders and finite-budget bots move constant-product AMM pools. Players can also open cash-settled long or short futures positions with 1–10× isolated virtual leverage.

**All prices, company stories, charts, cash and contracts are simulated.** No actual BISX data, real money, real securities or investment services are involved. The project is unaffiliated with BISX and its issuers. Names are provisional and should be checked before a public launch.

## Playable features

- One shared D1-backed market, US$1,000 starting virtual cash per player, and 20 fictional listings.
- Spot pairs trade as `SYMBOL/USD`: buy with virtual USD to receive fractional stock units in your wallet; sell those units into the same pair to recover virtual USD. A US$10 minimum applies to buys. No direct cash-out button or automatic conversion.
- AMM cash reserves: US$2m large stocks, US$1m middle stocks, US$500k small stocks. A 0.25% fee applies to spot swaps. Liquidity is fixed at game launch and does not shrink with player count.
- A dense trading terminal with a ticker strip, watchlist, order ticket, trade tape, market news, positions, and liquidation-value leaderboard.
- [TradingView Lightweight Charts](https://tradingview.github.io/lightweight-charts/) candlesticks, volume, MA 7/25/99, aligned 1m/5m/15m/30m/1h/4h/1d/1w timeframes, crosshair, trend lines, horizontal lines, rectangles, move measurements and chart images. Drawings are stored in that browser.
- One deterministic fictional 5-minute backstory spans 14 weeks. Its simulated participants move a virtual AMM and generate matching trade volume; quiet bars stay flat with zero volume. Its last two days are subdivided into true 1-minute candles with the same parent OHLCV. Live executed trades write one-minute OHLCV in the trade transaction. Larger candles aggregate those minutes; quiet intervals carry the last close with zero volume. Days open at 00:00 UTC and weeks at Monday 00:00 UTC. No real exchange feed is used.
- Isolated futures: market long/short entry, margin additions, close, P&L, approximate liquidation price, and automatic liquidation. Entry and exit fees are 0.05% of notional; maintenance margin is 1% of current notional. Opening a future does **not** move the spot AMM. Its mark price follows that shared spot pool.
- Futures positions display entry, live mark, liquidation estimate, margin, P&L, distance to liquidation, take profit and stop loss. Exit levels may be set at entry or edited later, and are drawn on the selected stock's chart. When a trade or market tick moves the mark through a level, the game closes the position at the observed mark. Liquidation takes priority over other exits if a gap crosses multiple levels.
- Finite-budget bots place modest routine orders while a player has the game open. Rarer, larger news orders scale with AMM depth; both paths create real trade volume and move prices only through swaps. News never resets prices.

## Game rules worth understanding

The score estimates each spot holding by actually selling it into the current AMM pool, then adds available cash and the estimated net exit value of open futures positions. At the end of a season, a settlement routine and ranking freeze still need to be added. There is currently no funding rate, limit-order book, cross margin, teacher admin panel, or scheduled bot activity while every player is offline. Stop loss and take profit are full-position market exits at the next observed mark, not guaranteed target-price fills.

The US$1,000 rule also updates untouched accounts that were created under the old US$100,000 setting. Accounts with any trades or positions keep their history; restarting those would require an explicit new season.

The market game is intentionally manipulable through legitimate virtual trades. A player can pump a thin stock, coordinate with others, or exploit an event. Account balances, order validation and settlement stay server-side; stale market versions cause an entire database batch to roll back.

## Stack and local development

Vinext (React/Next-compatible), TypeScript, Cloudflare Workers/D1, Drizzle migrations and TradingView Lightweight Charts. The `.openai/hosting.json` file binds the `DB` D1 resource to the private Site used for this prototype.

## Deploying on Cloudflare

**Use Cloudflare Workers with D1, not a static Cloudflare Pages deployment.** This game renders on the server and uses API routes, a shared database and player sessions. Uploading `dist/` or `dist/client/` as a Pages site cannot run the game. The existing private Sites preview is a separate host and database.

1. In your Cloudflare account, create a D1 database named `pearson-market` and copy its database UUID. For example, run `pnpm wrangler d1 create pearson-market` after logging into Wrangler.
2. Connect this GitHub repository to **Workers Builds**. Set the Worker name to `pearson-market` (or set `PEARSON_WORKER_NAME` to the name of an existing Worker), Node.js 22.13 or newer, the build command to `pnpm run build:cloudflare`, and the deploy command to `pnpm run deploy:cloudflare`.
3. Add build variable `PEARSON_D1_DATABASE_ID` with the D1 UUID. The build refuses the private Site's placeholder UUID. The deploy command applies all pending migrations to **that** D1 database before publishing the Worker. Select a Workers Builds API token with **D1 Edit** and Worker deployment access; Cloudflare's automatically generated build token may lack D1 access, which would make the migration step fail.
4. Test the resulting `workers.dev` URL before moving a custom domain. The Worker gives each browser a guest wallet with US$1,000 virtual cash; it never trusts ChatGPT identity headers sent by visitors. The private Sites preview continues to use its own ChatGPT sign-in and D1 data.

Guest wallets are tied to an HTTP-only cookie for 120 days. Clearing it or using another browser creates a fresh wallet. For a graded classroom season, add roster-backed accounts and a season reset before inviting students.

```bash
pnpm install
pnpm db:generate   # only after schema changes
pnpm build
```

For local Worker testing, build with `PEARSON_D1_DATABASE_ID` set to a disposable UUID, run `wrangler d1 migrations apply DB --local --config dist/server/wrangler.json`, then `wrangler dev --config dist/server/wrangler.json --local`. Production migrations use `--remote` through the deploy command. Keep local and production D1 data separate.

Important code paths:

- `lib/market-data.ts`: fictional roster and reserve depths
- `lib/market-engine.ts`: AMM, trades, bot events, shared game state
- `lib/perps.ts`: leverage, margin, P&L and liquidation
- `lib/chart-data.ts`: chart history and trade aggregation
- `lib/chart-series.ts`: UTC bucket rules and consistent OHLCV aggregation
- `app/game.tsx`: terminal and order tickets
- `app/terminal-chart.tsx`: interactive chart and drawing tools
- `lib/game-auth.ts`, `app/api/join/route.ts`: standalone Worker guest sessions
- `scripts/prepare-cloudflare.mjs`, `scripts/deploy-cloudflare.mjs`: direct Workers build and deploy

The GitHub repository is the source of truth. The private Site uses a separate deployment repository; changes from GitHub must be synchronized and published through the Sites workflow.
