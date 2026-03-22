# E-Beam Web Monitor

A Node.js/Express server that provides a real-time web dashboard for monitoring the subsystems of the 3D electron-beam metal printer. The dashboard shows interlock states, vacuum indicators, short-term and long-term pressure history, CCS clamp temperatures, and system logs without full page reloads.

**Live site:** [ebeam-webmonitor.onrender.com](https://ebeam-webmonitor.onrender.com/)

If you need to change the web monitor branch that Render deploys:
1. Log into Render
2. Open `EBEAM_webmonitor` under Projects > Services
3. Open **Settings**
4. In **Build & Deploy**, find the **Branch** field
5. Click **Edit**
6. Select the branch you want and save; Render will redeploy automatically

## Setup

### Prerequisites
- Node.js (v18+)
- A Supabase project with the `short_term_logs` and `long_term_logs` tables
- A Google Cloud API key with Drive API enabled
- A Google Drive folder containing the system log files

See [SUPABASE-README.md](./SUPABASE-README.md) for the database schema and hot/cold data split.

### Environment Variables

Create a `.env` file in the project root:

```bash
SUPABASE_API_URL=https://your-project.supabase.co
SUPABASE_API_KEY=your-anon-key
API_KEY=your-google-cloud-api-key
FOLDER_ID=your-google-drive-folder-id
PORT=3000
EXPERIMENT_RESET_PASSWORD=optional-reset-password
```

`EXPERIMENT_RESET_PASSWORD` is optional and only required if you want to enable the dashboard reset flow.

### Running Locally

```bash
npm install
npm start
```

On startup the server will:
1. Backfill short-term pressure data from the last 24 hours of `short_term_logs`
2. Backfill long-term pressure history from `long_term_logs`
3. Backfill the three CCS clamp-temperature graphs from the last hour of short-term data
4. Fetch the latest short-term row to seed scalar dashboard state
5. Refresh the cached display log from Google Drive
6. Start the recurring sync loops
7. Open the HTTP port after the caches are warm

### Running Tests

```bash
npm test
```

`npm test` runs Node's built-in test runner (`node --test`).

Current automated coverage lives in `test/polling.test.js` and uses mocked Supabase and Google Drive clients, so you do not need live cloud services or a populated `.env` file to run the suite.

The tests currently focus on:
- short-term and long-term catch-up polling
- composite cursor pagination across tied timestamps
- stale-data and inactivity handling
- overlap guards that prevent concurrent sync jobs
- pressure chart density and downsampling metadata

There is not yet a browser or end-to-end test suite.

## Architecture Overview

The app has three background data paths that converge in shared in-memory state: short-term Supabase telemetry, long-term Supabase history, and Google Drive display logs.

```text
Supabase: short_term_logs ------------------------------+
                                                        |
Supabase: long_term_logs ---------------------------+   |
                                                    v   v
                                              services/supabase.js
                                                    |
                                                    v
                                              services/polling.js
                                         - fetchAndUpdateFile() every 3s
                                         - pollLongTerm() every 60s
                                         - refreshDisplayLogs() every 60s
                                                    |
                    +-------------------------------+------------------------------+
                    |                                                              |
                    v                                                              v
            services/state.js                                               services/graphs.js
    - scalar dashboard values                                        - shortTermPressureGraph
    - experimentRunning                                              - longTermPressureGraph
    - lastShortTermCursor                                            - ccsGraphA / ccsGraphB / ccsGraphC
    - lastLongTermCursor
    - web/display last-modified timestamps

Google Drive log files --> services/gdrive.js --> cached reversed.txt --> /raw and /refresh-display

Express routes:
- `/` renders the dashboard HTML
- `/data` serves current scalar values and computed colors
- `/chart-data` serves the selected pressure graph plus density metadata
- `/ccs-chart-data` serves the three CCS clamp-temperature series
- `/health`, `/raw`, `/refresh-display`, and `/experiment-reset` expose operational controls
```

The startup sequence in `index.js` warms the pressure caches, CCS caches, and display-log cache before calling `app.listen()`, so the first page load has data ready instead of starting cold.

The browser then:
- polls `/data` every 3 seconds for scalar values and status badges
- polls `/chart-data` for the active pressure view
- polls `/ccs-chart-data` for the three clamp-temperature charts
- fetches `/raw` only when the full log viewer is expanded

## Project Structure

```text
.
|-- index.js                 # App entry point: startup warm-up, polling intervals, server start
|-- config.js                # Environment variables, Supabase client, Google Drive client, constants
|-- routes.js                # Express routes for HTML, JSON APIs, health checks, and reset actions
|-- services/
|   |-- state.js             # Shared runtime state: cursors, last-modified times, scalar data, flags
|   |-- supabase.js          # Supabase backfills, latest-row fetches, and cursor-based pagination
|   |-- polling.js           # Batch sync orchestration, gap logging, inactivity handling, overlap guards
|   |-- graphs.js            # Pressure graph caches, CCS ring buffers, downsampling metadata helpers
|   |-- interlocks.js        # Interlock and vacuum indicator color computation
|   |-- gdrive.js            # Google Drive display-log fetch, reversal, and local cache writes
|   `-- utils.js             # Small helper utilities
|-- test/
|   `-- polling.test.js      # Node test suite for sync, cursor, and chart behavior
|-- views/
|   `-- dashboard.js         # Server-rendered dashboard HTML plus client-side polling/chart scripts
|-- assets/
|   `-- refresh.png          # Refresh icon used by the dashboard
|-- render.yaml              # Render deployment config
|-- SUPABASE-README.md       # Database architecture and maintenance notes
|-- Graph-README.md          # Additional graph-specific notes
`-- README.md                # Project overview and developer setup
```

## Key Concepts

### Composite cursors, not just timestamps

Short-term and long-term sync both track a cursor shaped like `{ timestamp, id }`. This matters because multiple rows can share the same timestamp; comparing timestamps alone can skip valid rows or reprocess them. The polling and backfill logic therefore sorts by timestamp and `id`, and resumes from the exact last processed row.

### Batch catch-up sync

The branch no longer treats polling as "grab the latest row and append it if the timestamp changed." Instead, `fetchAndUpdateFile()` and `pollLongTerm()` drain every unseen row since the last cursor, oldest-first. That lets the server recover cleanly after missed intervals, network delays, or temporarily paused polling.

### Deterministic pagination across tied timestamps

`services/supabase.js` fetches rows in pages of 1000 and applies the cursor after querying. This preserves ordering even when a page boundary lands inside a block of rows that share the same timestamp, which is one of the main changes in this branch.

### Gap detection and overlap guards

`services/polling.js` logs a warning when the observed spacing between records is much larger than expected for the stream being processed. It also uses in-progress guards so telemetry sync, long-term sync, and display-log refresh jobs do not overlap and duplicate work.

### Inactivity handling

The dashboard treats the experiment as inactive when the newest short-term row is older than the configured inactivity threshold. In that case the app clears live scalar values, marks the dashboard as not running, and still advances the short-term cursor so old history is not replayed when fresh data returns.

### Pressure graph density

The server keeps the full in-memory pressure arrays separately from the display arrays sent to the browser. Short-term pressure data keeps a denser live view (`maxDisplayPoints: 1024`) because it represents recent ~3 second data over the last 24 hours, while the long-term historical view stays capped at a lower display density (`maxDisplayPoints: 256`) because it already uses 1-minute averaged source data.

`/chart-data` now returns both the plotted points and graph metadata such as `rawPointCount`, `displayPointCount`, `downsampleFactor`, and `sourceResolutionLabel`, allowing the UI to explain what the chart is showing.

### CCS clamp-temperature charts

In addition to the pressure graphs, startup backfills three CCS clamp-temperature series from the last hour of short-term telemetry. These are stored in fixed-size ring buffers (`ccsGraphA`, `ccsGraphB`, and `ccsGraphC`) and served through `/ccs-chart-data` for the three cathode charts on the dashboard.

### Interlock color logic

Each interlock indicator (Door, Water, Vacuum, E-Stop, and others) is derived from safety flag arrays in the experiment data. `computeAllColors()` centralizes this translation and returns the `"green"`, `"red"`, or `"grey"` values used by both the server-rendered page and the browser's polling updates.

### Display logs are a separate pipeline

Google Drive log fetching is independent from the Supabase telemetry path. The app periodically downloads the most recent display log, reverses it, writes it to a local cache file, and serves that cached content through `/raw` so the log viewer does not depend on a live Drive request for every page refresh.

### Reset is an explicit operational action

The dashboard includes an experiment reset flow backed by `POST /experiment-reset`. When `EXPERIMENT_RESET_PASSWORD` is configured, that route deletes both Supabase log tables and clears the in-memory pressure caches, so it should be treated as an operator control rather than part of normal monitoring.

See [SUPABASE-README.md](./SUPABASE-README.md) for the database-side hot/cold table design that feeds the short-term and long-term graphs.

## API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/` | GET | Server-rendered HTML dashboard |
| `/data` | GET | JSON with current scalar values, computed colors, and last-modified timestamps |
| `/chart-data?view=short\|long` | GET | JSON for the selected pressure graph plus `rawPointCount`, `displayPointCount`, `downsampleFactor`, and `sourceResolutionLabel` |
| `/ccs-chart-data` | GET | JSON with the A/B/C CCS clamp-temperature chart series |
| `/health` | GET | Supabase connection status and experiment state |
| `/raw` | GET | Plain text content of the cached reversed display log file |
| `/refresh-display` | GET | Triggers a manual Google Drive display-log refresh |
| `/experiment-reset` | POST | Clears both log tables and in-memory pressure caches when password auth is configured |

## Deployment

Hosted on [Render](https://render.com/). Render auto-deploys on pushes to whichever Git branch the service is configured to track.

Required Render environment variables:
- `SUPABASE_API_URL`
- `SUPABASE_API_KEY`
- `API_KEY` (Google Cloud)
- `FOLDER_ID` (Google Drive)

Optional Render environment variables:
- `EXPERIMENT_RESET_PASSWORD` (enables the dashboard reset flow)

## Contributors

Brandon, Pratyush, Arundhati, Anurag, Mathom
