# services/ — Architecture

## Shared state (`state.js`)
- Single exported object; all modules mutate directly — no getters/setters
- `experimentRunning`: false when newest row age > `INACTIVE_THRESHOLD` (15 min)
- `lastShortTermCursor` / `lastLongTermCursor`: `{ timestamp: string, id: number|string|null }`
- `state.data` fields set to `null` when inactive (via `resetData()` in supabase.js)
- `baseStatus` — static defaults for sample-data generation only; not live telemetry

## Cursor model (polling.js + supabase.js)
- Shape: `{ timestamp: ISO string, id: row id }`
- Solves: multiple rows can share the same timestamp; timestamp-only cursors skip/replay rows
- `isCursorAfter(candidate, reference)`:
  - candidate.timestamp > reference.timestamp → true
  - equal timestamps AND candidate.id > reference.id → true
  - (short_term ids are ints; long_term ids are UUIDs — same-timestamp UUIDs sort consistently)
- Supabase query: `.gte(timestampCol, cursor.timestamp)` — inclusive boundary, then filter client-side with `isRowAfterCursor()`

## Batch catch-up / paginated fetch (`fetchEntriesSince` in supabase.js)
- `while(true)` loop drains ALL unseen rows since cursor
- `PAGE_SIZE = 1000`; breaks on `data.length < PAGE_SIZE` or `fullXVals.length >= maxDataPoints`
- Always drains full backlog — never single-row polling

## Overlap guards (polling.js)
- Three booleans: `telemetrySyncInProgress`, `longTermSyncInProgress`, `displayRefreshInProgress`
- Skip (not queue) on collision — safe for `setInterval`
- `fetchAndUpdateFile()` calls `pollShortTerm()` internally — do not put `pollShortTerm` on its own interval

## Graph objects (graphs.js)
- Full arrays: `fullXVals[]`, `fullYVals[]` — complete history, never truncated
- Display arrays: `displayXVals[]`, `displayYVals[]` — downsampled copy served to client
- Instances:
  - `shortTermPressureGraph`: maxDataPoints 30000, maxDisplayPoints 1024
  - `longTermPressureGraph`: maxDataPoints 100000, maxDisplayPoints 256

## Downsampling algorithm (`updateDisplayData`)
- If predicted display count > `maxDisplayPoints`: double `lastUsedFactor`, rebuild display arrays from full arrays
- Otherwise: append or overwrite last display point in place (avoids full rebuild)
- `lastPermanentIndex`: tracks last committed index vs. trailing "live" point that gets overwritten

## CCS ring buffers (graphs.js)
- `CCS_MAX_POINTS = 1200` (~1h at 3s cadence)
- `addCCSPoint(graph, tSec, temp)`: push then `shift()` when over limit
- Three objects: `ccsGraphA`, `ccsGraphB`, `ccsGraphC`
- Backfilled from last 1h of `short_term_logs.data.clamp_temperature_{A,B,C}`
- Not downsampled — served raw to `/ccs-chart-data`

## Interlock colors (interlocks.js)
- Returns: `"green"` | `"red"` | `"grey"`
- `"grey"` when flags array is null, too short, or `!experimentRunning`
- `computeAllColors(data, experimentRunning)` → `{ sicColors[11], vacColors[8] }`
- sicColors index map: 0=door, 1=water, 2=vacPower, 3=vacPressure, 4=oilLow, 5=oilHigh, 6=estopInternal, 7=estopExternal, 8=allInterlocks, 9=G9Output, 10=hvolt
- `hvolt` (index 10): green when `inputFlags[11]==0 && statusFlags[11]==1` — **inverted logic vs. all other interlocks**
- `vacuumBits` in `state.data`: boolean array converted from "11010101"-style string in `mapSupabaseDataToAppFormat`

## Google Drive pipeline (gdrive.js)
- Lists up to 5 most-recent `text/plain` files in `FOLDER_ID`, picks first with name starting `log_`
- Downloads via raw HTTPS (not googleapis SDK): `googleapis.drive.v3/files/{id}?alt=media&key=`
- 3 retries on download failure
- Reverses all lines, caps at 100,000, writes to `reversed.txt` in project root
- `state.displayLogLastModified` set to Drive file's `modifiedTime` on successful write

## Key constants
| Constant | Value | File |
|---|---|---|
| `INACTIVE_THRESHOLD` | 15 min (ms) | config.js |
| `SHORT_TERM_EXPECTED_INTERVAL_MS` | 3000 | polling.js |
| `LONG_TERM_EXPECTED_INTERVAL_MS` | 60000 | polling.js |
| `CCS_MAX_POINTS` | 1200 | graphs.js |
| `PAGE_SIZE` | 1000 | supabase.js |
| `shortTermPressureGraph.maxDataPoints` | 30000 | graphs.js |
| `longTermPressureGraph.maxDataPoints` | 100000 | graphs.js |

## Adding a new telemetry field from Supabase
1. `state.js` — add field (null) to `state.data`
2. `supabase.js` — map in `mapSupabaseDataToAppFormat()` + add to `resetData()`
3. `routes.js` — expose on `/data` response
4. `views/dashboard.js` — consume in client poll handler + add to SSR HTML if needed
