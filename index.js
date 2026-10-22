///////////////////////////////////////////////////////////////////////////////
//  index.js - E-beam Log Monitor Server (Entry Point)
//
//  Fetches experimental data from Supabase database and serves
//  a real-time web dashboard for monitoring E-beam operations.
//
//  Author: Brandon, Pratyush, Arundhati, Anurag
///////////////////////////////////////////////////////////////////////////////

const express = require('express');
const path = require('path');
const { PORT } = require('./config');
const { fetchAndUpdateFile, pollLongTerm, refreshDisplayLogs } = require('./services/polling');
const { backfillShortTermGraph, backfillLongTermGraph, backfillCCSGraphs } = require('./services/supabase');
const { shortTermPressureGraph, longTermPressureGraph, ccsGraphA, ccsGraphB, ccsGraphC } = require('./services/graphs');
const state = require('./services/state');
const registerRoutes = require('./routes');
const { startHttpServer } = require('./services/startup');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'assets')));

// Register all routes
registerRoutes(app);

function startPollingIntervals() {
  // Poll short-term + scalars every 3 seconds
  setInterval(fetchAndUpdateFile, 3_000);

  // Poll long-term every 60 seconds
  setInterval(pollLongTerm, 60_000);

  // Refresh display logs every 60 seconds on a separate interval
  setInterval(refreshDisplayLogs, 60_000);
}

async function warmCachesAndStartPolling() {
  state.startup.status = 'warming';

  try {
    // 1) Backfill both pressure graph caches from Supabase
    console.log('Backfilling short-term pressure cache...');
    state.lastShortTermCursor = await backfillShortTermGraph(shortTermPressureGraph);

    console.log('Backfilling long-term pressure cache...');
    state.lastLongTermCursor = await backfillLongTermGraph(longTermPressureGraph);

    console.log('Backfilling CCS temperature graphs...');
    await backfillCCSGraphs(ccsGraphA, ccsGraphB, ccsGraphC);

    // 2) Grab the latest scalar data right now
    await fetchAndUpdateFile();

    // 3) Warm the display-log cache on its own path
    await refreshDisplayLogs();

    state.startup.status = 'ready';
    state.startup.completedAt = new Date().toISOString();
    state.startup.error = null;
  } catch (error) {
    state.startup.status = 'degraded';
    state.startup.completedAt = new Date().toISOString();
    state.startup.error = error?.message || String(error);
    throw error;
  } finally {
    // A failed warmup must not permanently disable subsequent polling.
    startPollingIntervals();
  }
}

// Open Render's HTTP port first. Remote cache warming begins only after the
// server is listening, so the dashboard and health page remain reachable even
// if Supabase or Google Drive is slow during a deployment.
startHttpServer({
  app,
  port: PORT,
  warmup: warmCachesAndStartPolling,
});
