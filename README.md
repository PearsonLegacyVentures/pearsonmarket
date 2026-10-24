# Pearson Market

A fictional Bahamian trading game. Twenty invented companies share one market. Human spot orders and finite-budget bots move constant-product AMM pools. Players can also open cash-settled long or short futures positions with 1–10× isolated virtual leverage.

**All prices, company stories, charts, cash and contracts are simulated.** No actual BISX data, real money, real securities or investment services are involved. The project is unaffiliated with BISX and its issuers. Names are provisional and should be checked before a public launch.

## Playable features

- One shared D1-backed market, US$1,000 starting virtual cash per player, and 20 fictional listings.
- Spot pairs trade as `SYMBOL/USD`: buy with virtual USD to receive fractional stock units in your wallet; sell those units into the same pair to recover virtual USD. A US$10 minimum applies to buys. No direct cash-out button or automatic conversion.
- AMM cash reserves: US$2m large stocks, US$1m middle stocks, US$500k small stocks. A 0.25% fee applies to spot swaps. Liquidity is fixed at game launch and does not shrink with player count.
- A dense trading terminal with a ticker strip, watchlist, order ticket, trade tape, market news, positions, and liquidation-value leaderboard.
- [TradingView Lightweight Charts](https://tradingview.github.io/lightweight-charts/) candlesticks, volume, MA 7/25/99, timeframes, crosshair, trend lines, horizontal lines, rectangles, move measurements and chart images. Drawings are stored in that browser.
- Fictional preseason history followed by actual in-game trades. No real exchange feed is used.
- Isolated futures: market long/short entry, margin additions, close, P&L, approximate liquidation price, and automatic liquidation. Entry and exit fees are 0.05% of notional; maintenance margin is 1% of current notional. Opening a future does **not** move the spot AMM. Its mark price follows that shared spot pool.
- Fictional news prompts finite-budget bot orders while at least one player has the game open. News never resets prices.

## Game rules worth understanding

The score estimates each spot holding by actually selling it into the current AMM pool, then adds available cash and the estimated net exit value of open futures positions. At the end of a season, a settlement routine and ranking freeze still need to be added. There is currently no funding rate, limit-order book, cross margin, teacher admin panel, or scheduled bot activity while every player is offline. The limit-order and stop-loss controls from commercial futures terminals are deliberately absent until they have real execution logic.

The US$1,000 rule also updates untouched accounts that were created under the old US$100,000 setting. Accounts with any trades or positions keep their history; restarting those would require an explicit new season.

The market game is intentionally manipulable through legitimate virtual trades. A player can pump a thin stock, coordinate with others, or exploit an event. Account balances, order validation and settlement stay server-side; stale market versions cause an entire database batch to roll back.

## Stack and local development

Vinext (React/Next-compatible), TypeScript, Cloudflare Workers/D1, Drizzle migrations and TradingView Lightweight Charts. The `.openai/hosting.json` file binds the `DB` D1 resource to the private Site used for this prototype.

```bash
pnpm install
pnpm db:generate   # only after schema changes
pnpm build
```

For a local D1 preview, apply pending SQL in `drizzle/` to the local database using the generated `dist/server/wrangler.json`, then run `pnpm start`. The private hosted Site provides ChatGPT sign-in headers; local requests need an equivalent development identity, so do not expose a local preview to the public internet. Production migrations are applied by the Sites deployment workflow.

Important code paths:

- `lib/market-data.ts`: fictional roster and reserve depths
- `lib/market-engine.ts`: AMM, trades, bot events, shared game state
- `lib/perps.ts`: leverage, margin, P&L and liquidation
- `lib/chart-data.ts`: chart history and trade aggregation
- `app/game.tsx`: terminal and order tickets
- `app/terminal-chart.tsx`: interactive chart and drawing tools

The GitHub repository is the source of truth. The private Site uses a separate deployment repository; changes from GitHub must be synchronized and published through the Sites workflow.
