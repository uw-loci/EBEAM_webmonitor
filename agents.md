# E-Beam Web Monitor

> RULE: When making changes, update the corresponding agents.md files using the same style (fragments, key-value, no sentences).

## Commands
- run: `npm start` (`node index.js`)
- test: `npm test` (`node --test`)
- no build step

## Required env vars
- `SUPABASE_API_URL`, `SUPABASE_API_KEY`
- `FOLDER_ID`, `API_KEY` — Google Drive, public API key auth (not OAuth)
- `PORT` — default 3000
- `EXPERIMENT_RESET_PASSWORD` — optional; POST /experiment-reset returns 503 if absent

## Startup sequence (`index.js`) — port opens before remote cache warmup
1. `app.listen(PORT)` — Render health + dashboard reachable during warmup
2. backfill short-term pressure cache — last 24h from `short_term_logs`
3. backfill long-term pressure cache — from `long_term_logs`, capped at `longTermPressureGraph.maxDataPoints` (100000 rows)
4. backfill CCS ring buffers — last 1h from `short_term_logs`
5. `fetchAndUpdateFile()` — scalar state + short-term sync
6. `refreshDisplayLogs()` — Google Drive fetch → `reversed.txt`
7. polling intervals: `fetchAndUpdateFile` every 3s, `pollLongTerm` every 60s, `refreshDisplayLogs` every 60s

## Routes (`routes.js`)
- `GET /` — SSR HTML; chart data inlined as JSON literals at page load
- `GET /data` — JSON scalars + backend `experimentRunning` + 902B pressure + beam-energy output booleans + `sicColors[11]` + `vacuumColors[8]`; client polls 3s after prior poll completion
- `GET /chart-data?view=short|long` — bounded display arrays only; max 1024 short / 256 long; short view also `pressure902bVals`; graph metadata; legacy raw/cursor params ignored
- `GET /ccs-chart-data` — CCS ring buffer arrays A/B/C
- `GET /health` — live Supabase ping + `experimentRunning`
- `GET /raw` — serves `reversed.txt` as `text/plain`
- `GET /refresh-display` — manual Google Drive re-fetch
- `POST /experiment-reset` — body `{ password }`, deletes both log tables + clears in-memory arrays

## Module roles
- `config.js` — env validation, Supabase client init, exports `INACTIVE_THRESHOLD` (2 min)
- `services/state.js` — single mutable object shared across all modules by reference
- `services/polling.js` — orchestration + overlap guards + stale-activity expiry + cursor advancement
- `services/supabase.js` — all DB queries; backfill + paginated `fetchEntriesSince`
- `services/graphs.js` — graph object factory, downsampling logic, CCS ring buffers
- `services/interlocks.js` — pure color functions; no I/O
- `services/gdrive.js` — Drive REST list/download, line-reverse, write `reversed.txt`
- `services/utils.js` — `secondsSinceMidnightChicago()`, `randomPressure()`, `generateLogLine()`
- `views/dashboard.js` — `renderDashboard(opts)` → full HTML string; all client JS inline
- `routes.js` — registers all Express routes

## Supabase tables
- `short_term_logs`: `id` (int), `created_at` (timestamptz), `data` (JSONB) — 3s cadence
- `long_term_logs`: `id` (UUID), `recorded_at` (timestamptz), `avg_pressure` (float) — 1-min avg

- pressure fields: `data.pressure` = 972B mbar; `data.pressure_902b_mbar` = 902B mbar; 902B Live graph + scalar only
- CCS chart colors: A orange `#f97316`; B green `#22c55e`; C pale red `#fca5a5`

## Timestamps
- Supabase: ISO 8601 UTC strings
- Graph X-axis: fractional Unix **seconds** — `ms / 1000`
- Display: `America/Chicago` timezone

## Pressure chart
- Y-axis: sanitized pressures are transformed to base-10 exponents and plotted on a bounded linear uPlot scale; labels convert back to mbar. This preserves logarithmic spacing without invoking uPlot's native logarithmic tick allocator.
- Live series: 972B cyan `#38bdf8`; 902B indigo `#818cf8`; solid, independently toggleable
- Historical series: 972B only
- values: finite `1e-15..1e6`; missing/out-of-range/invalid → aligned `null` gaps; no carry-forward
- labels: scientific notation; axis identifies `log10`
- range: visible positive minimum lower padding >= 0.5 decade; Y auto-range per X viewport
- grid: max 10 exact log mantissas; decades (`1`) first, then `2`, `3`, `5`, `7`, `9`
- interaction: Zoom selection; Pan drag; wheel/pinch zoom; minimum X window 10s; Reset/double-click restore
- live windows: `1h`, `3h`, `6h`, `12h`, `24h`; presets end at current server time; manual range fixed as Custom
- historical: all-time default ends at current server time; manual Custom range
- viewport-now: X-range only; no synthetic points; absolute-index downsampling unchanged
- dashboard polling: self-scheduled after completion; 10s request timeout
- pressure display polling: bounded snapshot; one request in flight; initial/poll/toggle shared; max 2048 client points
- empty pressure state: no uPlot construction/update; finite fallback exponent range; pressure-only placeholder
- chart failure: pressure-only fuse; dashboard + CCS polling continue

## CCS charts
- X window: moving 1h ending at current server time; independent of temperature-point availability
- X window refresh: initial render + each 3s dashboard poll; double-click restores current 1h
- Y values: nullable; empty series retains time axis

## Responsive layout
- Vacuum header `>992px`: title + both pressure readings in one row
- Vacuum header `601–992px`: title row + centered shared pressure row
- Vacuum header `<=600px`: title row + separate centered 972B/902B rows
- Vacuum pressure precision: 972B + 902B scalar and graph-hover values use 2 mantissa decimals
- Vacuum pressure validity: finite `> 0`; empty/nonpositive/invalid → `-- mbar`

## Experiment progress
- chevrons: 100px minimum width, 38px minimum height, -8px overlap
- layout: balanced rows `10`; `5,5`; `4,3,3`; `3,3,2,2`; `2,2,2,2,2`; ten `1`s
- row sizing: widest-row chevron width shared across rows, shorter rows centered, 8px row gap
- row transition: next pattern at `widest row count * 100px`; overlap excluded
- overflow: wrapping page rows; boxed background; no scrollbar
- progress spotlight: 260px low-intensity cyan radial; centered on first gray milestone; no movement animation; hidden when complete
- left edge: squared only for `PMON` / `Temperatures OK`; diagonal notch for all others
- left padding: 12px only for `machine_status_temps`; 20px for joined chevrons
- text glow: 3px blur, 0.35 active alpha
- text weight: 500
- temperature label: `PMON` / `Temperatures OK`
- HV power label: `HVolt Power` / `Supplies Nominal`

## Deploy
- Render.com, `render.yaml`, auto-deploy from `main`
- `reversed.txt` written to project root at runtime — ephemeral on Render (re-fetched on restart)
- Live: ebeam-webmonitor.onrender.com

## Testing
- Framework: `node:test` + `node:assert/strict` — no jest/mocha
- Mocks set inline in `test/polling.test.js` before imports; no `.env` or live services needed
- Run single file: `node --test test/polling.test.js`
- Coverage: cursor pagination, catch-up sync, inactivity, overlap guards, downsampling
