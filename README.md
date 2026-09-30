# Tickwhy

Tickwhy helps you understand why a stock or a market index moved. Pick a ticker and it:

- flags the **unusual days** on an interactive chart (moves of at least 2× the usual daily swing),
- splits each move into **market / sector / company-specific** parts (for indexes: which **sectors** drove it),
- lines each move up with the **news and earnings** from around that date,
- and lets an **AI agent** (Claude, orchestrated with LangGraph) explain the biggest moves, citing its sources.

It's a learning tool for past price moves. It does not predict prices or give investment advice.

---

## Contents

- [Features](#features)
- [Tech stack](#tech-stack)
- [Quick start](#quick-start)
- [API keys](#api-keys)
- [Configuration](#configuration)
- [How it works](#how-it-works)
- [Project structure](#project-structure)
- [API reference](#api-reference)
- [Rate limits and caching](#rate-limits-and-caching)
- [LangSmith tracing](#langsmith-tracing)
- [Theming](#theming)
- [Development](#development)
- [Troubleshooting](#troubleshooting)
- [Limitations](#limitations)

---

## Features

**Stocks** (`/stock/NVDA`)
- Candlestick chart with volume, ranges from 1M to 5Y, hover values (open/high/low/close and the day's change).
- ▲/▼ markers on unusual moves and ● markers on earnings dates. Click near a marker to select that day.
- **Unusual moves** table with a market/sector/company bar for each move.
- **Day detail**: the day's return, how big the move was compared with a typical day, volume, overnight gap vs. the move during the day, where the move came from, and the earnings result (EPS beat or miss).
- **News** from around the selected day. Articles the AI cited are marked and listed first.
- **Explain with AI**: explanations stream in live, one per big move, plus a summary of the whole period.

**Indexes** (`/index/SPX`, `NDX`, `DJI`, `RUT`)
- S&P 500, Nasdaq-100, Dow Jones and Russell 2000.
- **What drove the index**: how much each of the 11 sectors added to or took from the return over the range.
- Day detail shows each sector's contribution, how many sectors fell, and whether the move was broad or concentrated.
- Market-wide news, and a separate AI agent built for macro causes (economic data, the Fed, policy, earnings of the largest companies).

**General**
- Search across every US stock plus the indexes ("nvda", "tesla", "s&p", "dow").
- Home page with live index tiles.
- Dark and light themes (the switch is in the top bar, and the choice is remembered). Works on phones.
- A setup notice appears when the market-data keys are missing.

## Tech stack

| Part | Tech |
|---|---|
| Frontend | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4, [TradingView Lightweight Charts](https://www.tradingview.com/lightweight-charts/) 5 |
| Backend | FastAPI, LangGraph, Anthropic Python SDK (Claude), LangSmith, numpy, httpx |
| Data | [Finnhub](https://finnhub.io) (symbols, profiles, quotes, news, earnings), [Twelve Data](https://twelvedata.com) (daily price history) |
| AI model | `claude-opus-5-5` by default (configurable) |

## Quick start

### Prerequisites

- Python 3.11+ (developed on 3.14)
- Node.js 20.9+ (developed on 22)
- API keys: see [API keys](#api-keys). Finnhub, Twelve Data and Anthropic are needed for full functionality.

### 1. Backend (first time)

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env      # then open .env and add your keys
```

### 2. Frontend (first time)

```bash
cd frontend
npm install
cp .env.example .env.local
```

### 3. Run it (two terminals)

```bash
# Terminal 1: backend on http://localhost:8000
cd backend
.venv/bin/uvicorn app.main:app --reload --port 8000
```

```bash
# Terminal 2: frontend on http://localhost:3000
cd frontend
npm run dev
```

Open **http://localhost:3000**. To check the backend, open http://localhost:8000/api/health: it shows `true` for each market-data key that's configured.

Stop either server with `Ctrl+C`. **Restart the backend after editing `backend/.env`**, because `--reload` only watches code files.

## API keys

| Key | Needed? | What it's for | Where to get it |
|---|---|---|---|
| `FINNHUB_API_KEY` | **Required** | Stock search, company profile, live quote, news, earnings | [finnhub.io/register](https://finnhub.io/register) (free) |
| `TWELVEDATA_API_KEY` | **Required** | Daily price history (charts, unusual moves, sector breakdown) | [twelvedata.com/pricing](https://twelvedata.com/pricing) (free "Basic" plan) |
| `ANTHROPIC_API_KEY` | For AI explanations | The "Explain with AI" button | [platform.claude.com](https://platform.claude.com) |
| `LANGSMITH_API_KEY` | Optional | Tracing agent runs in LangSmith | [smith.langchain.com](https://smith.langchain.com) (free) |

Everything except the AI explanations works without an Anthropic key. Instead of `ANTHROPIC_API_KEY`, you can sign in with `ant auth login`; the SDK picks that up automatically.

Keys live only in `backend/.env`, which git ignores. Never commit them. If a key gets exposed (for example, pasted into a chat), revoke it and create a new one.

## Configuration

### `backend/.env`

| Variable | Default | Description |
|---|---|---|
| `FINNHUB_API_KEY` | — | Finnhub key |
| `TWELVEDATA_API_KEY` | — | Twelve Data key |
| `FINNHUB_RATE_PER_MIN` | `60` | Finnhub requests per minute (free tier: 60) |
| `TWELVEDATA_RATE_PER_MIN` | `8` | Twelve Data requests per minute (free tier: 8). Raise it on a paid plan. |
| `ANTHROPIC_API_KEY` | — | Claude key (or use `ant auth login`) |
| `CLAUDE_MODEL` | `claude-opus-5-5` | Model used by both agents |
| `CLAUDE_EFFORT` | `medium` | `low` / `medium` / `high` / `xhigh` / `max`: higher means more thorough, slower and more expensive |
| `MOVE_Z_THRESHOLD` | `2.0` | How unusual a day must be to get flagged, as a multiple of the prior 60 days' standard deviation |
| `MAX_MOVES_TO_EXPLAIN` | `6` | How many of the biggest moves the AI explains per run |
| `LANGSMITH_TRACING` | `false` | `true` sends traces to LangSmith (needs `LANGSMITH_API_KEY`) |
| `LANGSMITH_API_KEY` | — | LangSmith key |
| `LANGSMITH_PROJECT` | `tickwhy` | LangSmith project name |
| `LANGSMITH_ENDPOINT` | US endpoint | Set to `https://eu.api.smith.langchain.com` if your LangSmith account is in the EU region |
| `CORS_ORIGINS` | `["http://localhost:3000"]` | Allowed frontend origins (JSON list) |

### `frontend/.env.local`

| Variable | Default | Description |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `http://localhost:8000` | Where the backend runs |

## How it works

### Detecting unusual moves

For each trading day, the return is compared with the standard deviation of the previous 60 daily returns. Days at or beyond **2σ** are flagged. Each move also records its volume relative to the 20-day average, and splits the return into the **overnight gap** (previous close → open) and the **move during the day** (open → close). A big gap usually means news came out outside trading hours, for example earnings released before the open or after the close.

### Stock attribution: market / sector / company

Each stock's sector (from Finnhub's industry field) is mapped to a sector ETF (e.g. Semiconductors → SMH, Banking → XLF). The stock's daily returns are regressed on the market and on the sector's move beyond the market:

```
r_stock = α + β_mkt · r_SPY + β_sec · (r_sectorETF − r_SPY) + residual
```

A day's move is then split into **market** (`β_mkt · r_SPY`), **sector** (`β_sec · (r_sector − r_SPY)`) and **company** (the rest: news, earnings, stock-specific events).

### Index attribution: which sectors moved it

Indexes are tracked through the ETFs that replicate them (SPY, QQQ, DIA, IWM). Their daily returns match the underlying index to within a few hundredths of a percent. Each day's index return is split across the 11 SPDR sector ETFs:

```
contribution_sector = sector ETF return × estimated weight
```

The weights **aren't hard-coded**. A non-negative least-squares fit of the index's returns on the sector returns estimates them over the trailing ~6 months (126 trading days). The fit is redone monthly and only uses past data. For the S&P 500 this recovers the real sector weights closely. The part the sectors can't explain is shown as "Not explained by sectors". The sector panel also shows the fit quality (R²).

### The AI agents (LangGraph)

Both agents are LangGraph `StateGraph`s. The biggest moves are explained **in parallel** (fan-out with `Send`), and progress streams to the browser as server-sent events.

```
Stocks  (app/agent/graph.py)
gather_data ─► analyze_moves ─┬─► explain_move × N (parallel) ─► summarize
                              └─────────────────────────────────► summarize

Indexes (app/agent/index_graph.py)
gather_data ─► analyze_moves ─► gather_news ─┬─► explain_move × N (parallel) ─► summarize
                                             └─────────────────────────────────► summarize
```

| Step | What happens |
|---|---|
| `gather_data` | Fetch prices (plus SPY and sector ETFs), profile, news and earnings |
| `analyze_moves` | Deterministic: detect moves and calculate the attribution (the same code powers the chart, so it works without AI) |
| `gather_news` | Indexes only: market-wide news for each big move's date window |
| `explain_move` | One Claude call per move, returning **structured output**: primary driver, headline, 2–4 sentence explanation, cited news ids and confidence |
| `summarize` | One Claude call for a summary of the whole period |

The prompts (`app/agent/prompts.py`) tell Claude to stay grounded: cite only news it was given, check timestamps (news published after the close explains the *next* day), say "unclear" instead of guessing, and never predict prices or give advice. Requests use the Anthropic API's server-side fallback (`fallbacks="default"`): if a safety classifier declines a request, it is retried on a suitable fallback model.

### Where news comes from

- **Stocks:** Finnhub company news, ±3 days around the selected date.
- **Indexes:** Finnhub has no free historical market-news search, so Tickwhy combines news about each index's largest companies (where market wrap-ups show up) with Finnhub's general market feed, which only covers the last few days. Market-wide stories (Fed, inflation, jobs, yields, tariffs, …) are ranked first and tagged "market-wide".

## Project structure

```
backend/
  app/
    main.py              FastAPI app and all HTTP endpoints (incl. SSE streaming)
    config.py            Settings loaded from .env
    cache.py             In-memory TTL cache
    ratelimit.py         Per-minute rate limiter for data providers
    clients/
      finnhub.py         Symbols, profile, quote, company & market news, earnings
      twelvedata.py      Daily price history (5 years, cached)
    services/
      market.py          Ranges, sector-ETF mapping, price loading
      moves.py           Unusual-move detection and stock attribution
      indexes.py         Index definitions, sector attribution, index news
    agent/
      graph.py           LangGraph agent for stocks
      index_graph.py     LangGraph agent for indexes
      prompts.py         System prompts and structured-output schemas
      llm.py             Claude client and the LangSmith-traced call
  requirements.txt
  .env.example

frontend/
  src/
    app/
      page.tsx           Home: hero, search, index tiles
      stock/[symbol]/    Stock page
      index/[id]/        Index page
      layout.tsx         Theme setup, fonts
      globals.css        Theme tokens (colors for dark/light)
    components/
      StockView.tsx, IndexView.tsx       The two main pages
      PriceChart.tsx                     TradingView chart, markers, selected-day band
      MovesPanel.tsx                     Unusual-moves table + AI run button/summary
      DayDetail.tsx, IndexParts.tsx      Day detail panels, sector panel
      layout-parts.tsx, ui.tsx           Shared layout pieces and UI primitives
      NavBar.tsx, SymbolSearch.tsx, ThemeToggle.tsx, SetupNotice.tsx, MarketTiles.tsx, NewsList.tsx, DriverBadge.tsx
    lib/
      api.ts             Typed API client + SSE stream reader
      useAnalysis.ts     Runs an agent and collects streamed results
      useFetch.ts        Small data-fetching hook
      theme.tsx          Theme provider and switch logic
      format.ts          Number/date formatting
```

## API reference

Base URL: `http://localhost:8000`. `range` is one of `1M`, `3M`, `6M`, `1Y`, `2Y`, `5Y`.

| Method | Path | Returns |
|---|---|---|
| GET | `/api/health` | Which data keys are configured, and the model in use |
| GET | `/api/symbols/search?q=` | Matching indexes and US stocks |
| GET | `/api/stocks/{symbol}/overview` | Company profile, sector ETF, live quote |
| GET | `/api/stocks/{symbol}/chart?range=1Y` | Candles, unusual moves with attribution, earnings, period stats |
| GET | `/api/stocks/{symbol}/news?from=&to=` | Company news (`YYYY-MM-DD`; default: last 14 days) |
| POST | `/api/stocks/{symbol}/analyze?range=1Y` | Runs the stock agent; streams SSE events |
| GET | `/api/indexes` | All indexes with today's quote |
| GET | `/api/indexes/{id}/overview` | One index with its quote |
| GET | `/api/indexes/{id}/chart?range=1Y` | Candles, unusual moves, period stats |
| GET | `/api/indexes/{id}/sectors?range=1Y` | Estimated sector weights, daily and period contributions, R² |
| GET | `/api/indexes/{id}/news?from=&to=` | Market-wide news for a window |
| POST | `/api/indexes/{id}/analyze?range=1Y` | Runs the index agent; streams SSE events |

**SSE events** from the `analyze` endpoints, in order: `gather_data`, `analyze_moves` (includes `explain_dates`), `gather_news` (indexes only), one `explain_move` per explained move, `summarize`, then `done`. If something fails, an `error` event is sent before `done`.

Try it:

```bash
curl -N -X POST "http://localhost:8000/api/stocks/NVDA/analyze?range=1Y"
```

FastAPI also serves interactive docs at http://localhost:8000/docs.

## Rate limits and caching

The free data tiers are small, so the backend is careful with requests:

- **Rate limiters** queue requests instead of failing: 8/min for Twelve Data and 60/min for Finnhub (configurable).
- **Price history** for each ticker is fetched once (5 years) and cached for **1 hour**, so switching ranges costs no extra requests.
- **Cache times:** news 15 minutes, quotes 30 seconds, profiles and the symbol list 24 hours, earnings 6 hours.
- A **stock page** needs 3 price requests (stock, SPY, sector ETF).
- An **index page's sector panel** needs 12 (index + 11 sector ETFs). On the free tier the **first load takes about a minute**, then it's instant for an hour. The chart itself loads right away.
- The cache is in memory, so it resets when the backend restarts.

## LangSmith tracing

Optional. With tracing on, every agent run appears in LangSmith as `analyze SYMBOL RANGE` or `analyze index ID RANGE`, showing each step, the data fetches, and every Claude call with its prompt, output, token usage and model.

```
LANGSMITH_TRACING=true
LANGSMITH_API_KEY=your_key
LANGSMITH_PROJECT=tickwhy
```

Restart the backend after changing these. The Claude call is traced with `@traceable` rather than `langsmith.wrappers.wrap_anthropic`, because that wrapper fails with Anthropic SDK 1.x (it patches `client.completions`, which no longer exists).

## Theming

- Dark theme by default; the sun/moon button in the top bar switches themes. The choice is saved in `localStorage` and applied before the page renders, so there's no flash.
- All colors are **semantic tokens** defined once in `frontend/src/app/globals.css` (`--bg`, `--surface`, `--fg`, `--muted`, `--accent`, `--up`, `--down`, …) and used as Tailwind classes (`bg-surface`, `text-muted`, `bg-accent`, …).
- The brand color is Tailwind's **`emerald-400`**. To change it, edit `--accent` (and `--accent-text` / `--up`) in `globals.css`. The chart reads the same variables.

## Development

```bash
# Frontend checks
cd frontend
npx tsc --noEmit        # type check
npm run lint            # ESLint
npm run build           # production build

# Backend: confirm the app imports cleanly
cd backend
.venv/bin/python -c "import app.main"
```

In the Claude desktop app, `.claude/launch.json` defines `frontend` and `backend` launch configs.

## Troubleshooting

| Problem | Fix |
|---|---|
| **"FINNHUB_API_KEY is not set"** / yellow "Market data isn't connected" banner | Add `FINNHUB_API_KEY` and `TWELVEDATA_API_KEY` to `backend/.env`, then restart the backend. |
| Keys added but still "not set" | The backend reads `.env` only at startup, so restart it. Make sure the file is `backend/.env`, not `.env.example`. |
| `address already in use` on port 3000 or 8000 | Another server is running. Stop it, or run `lsof -ti :3000,:8000 \| xargs kill`. |
| Index sector panel stuck on "Loading…" | Expected on the first load with Twelve Data's free tier (≈1 minute for 12 requests). It's cached afterwards. |
| "run out of API credits for the current minute" | Your Twelve Data key is also being used elsewhere, or `TWELVEDATA_RATE_PER_MIN` is set too high. The client waits and retries once. |
| LangSmith logs `403 Forbidden` on `/runs/multipart` | Your account is probably in the EU region: set `LANGSMITH_ENDPOINT=https://eu.api.smith.langchain.com`. If you have several workspaces, also set `LANGSMITH_WORKSPACE_ID`. |
| "Explain with AI" shows an authentication error | Check `ANTHROPIC_API_KEY` in `backend/.env` (or run `ant auth login`) and restart the backend. |
| Frontend can't reach the backend / CORS error | Check that `NEXT_PUBLIC_API_URL` in `frontend/.env.local` matches the backend, and that the frontend origin is in `CORS_ORIGINS`. |
| Changes to `frontend/.env.local` not applied | Restart `npm run dev`. |

## Limitations

- **Attribution is statistical.** The market/sector/company and sector splits are regression estimates, not accounting facts.
- **News coverage is incomplete.** Finnhub's free tier keeps about a year of company news, and its general market feed covers only recent days. For older index moves, the macro story may be missing, and the AI will then say the cause is unclear.
- **Indexes are tracked via ETFs** (SPY, QQQ, DIA, IWM) rather than the index values themselves.
- **Sector-ETF fit** is tight for the S&P 500 and Nasdaq-100, looser for the Dow (price-weighted), and loosest for the Russell 2000 (small caps don't track the large-cap sector ETFs closely).
- **In-memory cache** doesn't survive restarts and isn't shared between multiple backend processes.
- **Daily data only**: no intraday charts.

---

Educational tool for understanding past price moves. **Not investment advice.**
