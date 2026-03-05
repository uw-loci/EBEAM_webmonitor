# E-Beam Web Monitor

A Node.js/Express server that provides a real-time web dashboard for monitoring the subsystems of the 3D electron-beam metal printer. The dashboard displays interlock states, vacuum indicators, pressure graphs, temperatures, and CCS heater readings — all updated live without page reloads.

**Live site:** [ebeam-webmonitor.onrender.com](https://ebeam-webmonitor.onrender.com/)

## Setup

### Prerequisites
- Node.js (v18+)
- A Supabase project with the `short_term_logs` and `long_term_logs` tables (see [SUPABASE-README.md](./SUPABASE-README.md))
- A Google Cloud API key with Drive API enabled
- A Google Drive folder containing the system log files

### Environment Variables

Create a `.env` file in the project root:

```
SUPABASE_API_URL=https://your-project.supabase.co
SUPABASE_API_KEY=your-anon-key
API_KEY=your-google-cloud-api-key
FOLDER_ID=your-google-drive-folder-id
PORT=3000
```

### Running Locally

```bash
npm install
npm start
```

On startup the server will:
1. Backfill both pressure graph caches from Supabase
2. Begin polling for new data
3. Open the HTTP port once caches are ready

## Architecture Overview

```
Supabase                        Server (Node/Express)                Browser
┌──────────────┐               ┌───────────────────────┐           ┌──────────────┐
│short_term_logs│──3s poll────▶│ polling.js            │           │              │
│              │               │  ├─ scalar state.data  │──/data──▶│ DOM updates  │
│              │               │  └─ shortTermGraph     │           │ (3s interval)│
├──────────────┤               │                        │           │              │
│long_term_logs │──60s poll───▶│  └─ longTermGraph      │           │              │
└──────────────┘               │                        │──/chart──▶│ uPlot chart  │
                               │ routes.js              │  -data    │ .setData()   │
Google Drive                   │  ├─ GET /              │           │              │
┌──────────────┐               │  ├─ GET /data          │           │              │
│  log files   │──gdrive.js──▶│  ├─ GET /chart-data    │           │              │
└──────────────┘               │  ├─ GET /raw           │           │              │
                               │  └─ GET /health        │           │              │
                               └───────────────────────┘           └──────────────┘
```

## Project Structure

```
├── index.js                  # Entry point — backfill, polling intervals, server start
├── config.js                 # Env vars, Supabase client, Google Drive client, constants
├── routes.js                 # Express route handlers
├── services/
│   ├── state.js              # Shared mutable state singleton (all modules read/write)
│   ├── supabase.js           # Supabase queries — backfill, polling, data mapping
│   ├── polling.js            # Polling orchestration — fetchAndUpdateFile, pollLongTerm
│   ├── graphs.js             # Graph data structures and downsampling algorithm
│   ├── interlocks.js         # Interlock/vacuum color computation from safety flags
│   ├── gdrive.js             # Google Drive file fetching for system log viewer
│   └── utils.js              # Helpers — sample data generation, timestamps
├── views/
│   └── dashboard.js          # Server-side HTML renderer (full dashboard template)
├── assets/                   # Static files served by Express
├── render.yaml               # Render.com deployment config
└── SUPABASE-README.md        # Supabase table schemas and automation docs
```

## Key Concepts

### Data Flow

1. **Startup backfill** (`index.js` → `supabase.js`): On boot, the server pulls all rows from `short_term_logs` and `long_term_logs` into in-memory graph arrays. The HTTP port opens only after backfill completes.

2. **Short-term polling** (every 3s in `polling.js`): `fetchAndUpdateFile()` fetches the latest row from `short_term_logs`. It updates both the scalar `state.data` (interlocks, temps, pressure, heater values) and appends to `shortTermPressureGraph`. Timestamp comparison prevents duplicate processing.

3. **Long-term polling** (every 60s in `polling.js`): `pollLongTerm()` fetches the latest row from `long_term_logs` and appends to `longTermPressureGraph`. Also uses timestamp dedup.

4. **Client updates**: The browser polls `GET /data` every 3s to update scalar DOM elements (indicator circles, temperature readings, etc.). It also polls `GET /chart-data?view=short|long` to live-update the uPlot pressure chart via `setData()`.

### Pressure Graph Toggle

The dashboard has a toggle button that switches between:
- **Short-term view**: Last ~24h of data at ~3s resolution (from `short_term_logs`)
- **Historical view**: All-time data at 1-minute averaged resolution (from `long_term_logs`)

Both datasets are always in server memory, so toggling is instant — no Supabase query on switch. See [SUPABASE-README.md](./SUPABASE-README.md) for the database-side architecture.

### Downsampling (`graphs.js`)

Raw data arrays can grow to tens of thousands of points. The `updateDisplayData()` function maintains a separate `displayXVals`/`displayYVals` array capped at 256 points using a stride-doubling algorithm. The `/chart-data` endpoint serves these downsampled arrays to keep payloads small.

### Interlock Color Logic (`interlocks.js`)

Each interlock indicator (Door, Water, Vacuum, E-Stop, etc.) is derived from safety flag bit arrays in the experiment data. `computeAllColors()` returns arrays of `"green"`, `"red"`, or `"grey"` strings used for both server-side rendering and client-side polling updates.

### Google Drive Log Viewer (`gdrive.js`)

A separate system fetches raw log files from Google Drive for the expandable "System Logs" section at the bottom of the dashboard. This is independent of the Supabase data pipeline.

## API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/` | GET | Server-rendered HTML dashboard |
| `/data` | GET | JSON with all current scalar values and computed colors |
| `/chart-data?view=short\|long` | GET | JSON with downsampled `xVals`/`yVals` for the pressure chart |
| `/health` | GET | Supabase connection status and experiment state |
| `/raw` | GET | Plain text content of the reversed system log file |
| `/refresh-display` | GET | Triggers a manual Google Drive log fetch |

## Deployment

Hosted on [Render](https://render.com/). Render auto-deploys on pushes to `main`.

Required Render environment variables:
- `SUPABASE_API_URL`
- `SUPABASE_API_KEY`
- `API_KEY` (Google Cloud)
- `FOLDER_ID` (Google Drive)

## Contributors

Brandon, Pratyush, Arundhati, Anurag, Mathom
