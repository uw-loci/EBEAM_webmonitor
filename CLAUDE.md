# E-Beam Web Monitor

> RULE: When making changes, update the corresponding CLAUDE.md files using the same style (fragments, key-value, no sentences).

## Commands
- run: `npm start` (`node index.js`)
- test: `npm test` (`node --test`)
- no build step

## Required env vars
- `SUPABASE_API_URL`, `SUPABASE_API_KEY`
- `FOLDER_ID`, `API_KEY` — Google Drive, public API key auth (not OAuth)
- `PORT` — default 3000
- `EXPERIMENT_RESET_PASSWORD` — optional; POST /experiment-reset returns 503 if absent

## Startup sequence (`index.js`) — port opens only after all caches warm
1. backfill short-term pressure cache — last 24h from `short_term_logs`
2. backfill long-term pressure cache — all-time from `long_term_logs`
3. backfill CCS ring buffers — last 1h from `short_term_logs`
4. `fetchAndUpdateFile()` — scalar state + short-term sync
5. `refreshDisplayLogs()` — Google Drive fetch → `reversed.txt`
6. polling intervals: `fetchAndUpdateFile` every 3s, `pollLongTerm` every 60s, `refreshDisplayLogs` every 60s
7. `app.listen(PORT)`

## Routes (`routes.js`)
- `GET /` — SSR HTML; chart data inlined as JSON literals at page load
- `GET /data` — JSON scalars + `sicColors[11]` + `vacuumColors[8]`; client polls every 3s
- `GET /chart-data?view=short|long` — downsampled display arrays + graph metadata
- `GET /ccs-chart-data` — CCS ring buffer arrays A/B/C
- `GET /health` — live Supabase ping + `experimentRunning`
- `GET /raw` — serves `reversed.txt` as `text/plain`
- `GET /refresh-display` — manual Google Drive re-fetch
- `POST /experiment-reset` — body `{ password }`, deletes both log tables + clears in-memory arrays

## Module roles
- `config.js` — env validation, Supabase + Drive client init, exports `INACTIVE_THRESHOLD`
- `services/state.js` — single mutable object shared across all modules by reference
- `services/polling.js` — orchestration + overlap guards + cursor advancement
- `services/supabase.js` — all DB queries; backfill + paginated `fetchEntriesSince`
- `services/graphs.js` — graph object factory, downsampling logic, CCS ring buffers
- `services/interlocks.js` — pure color functions; no I/O
- `services/gdrive.js` — Drive list/download, line-reverse, write `reversed.txt`
- `services/utils.js` — `secondsSinceMidnightChicago()`, `randomPressure()`, `generateLogLine()`
- `views/dashboard.js` — `renderDashboard(opts)` → full HTML string; all client JS inline
- `routes.js` — registers all Express routes

## Supabase tables
- `short_term_logs`: `id` (int), `created_at` (timestamptz), `data` (JSONB) — 3s cadence
- `long_term_logs`: `id` (UUID), `recorded_at` (timestamptz), `avg_pressure` (float) — 1-min avg

## Timestamps
- Supabase: ISO 8601 UTC strings
- Graph X-axis: Unix **seconds** (not ms) — `Math.floor(ms / 1000)`
- Display: `America/Chicago` timezone

## Deploy
- Render.com, `render.yaml`, auto-deploy from `main`
- `reversed.txt` written to project root at runtime — ephemeral on Render (re-fetched on restart)
- Live: ebeam-webmonitor.onrender.com

## Testing
- Framework: `node:test` + `node:assert/strict` — no jest/mocha
- Mocks set inline in `test/polling.test.js` before imports; no `.env` or live services needed
- Run single file: `node --test test/polling.test.js`
- Coverage: cursor pagination, catch-up sync, inactivity, overlap guards, downsampling
