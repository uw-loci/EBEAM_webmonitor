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

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'assets')));

// Register all routes
registerRoutes(app);

// Start server
(async function start() {
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

  // 4) Poll short-term + scalars every 3 seconds
  setInterval(fetchAndUpdateFile, 3_000);

  // 5) Poll long-term every 60 seconds
  setInterval(pollLongTerm, 60_000);

  // 6) Refresh display logs every 60 seconds on a separate interval
  setInterval(refreshDisplayLogs, 60_000);

  // 7) Open the HTTP port after caches are warm
  app.listen(PORT, () => console.log(`Listening on ${PORT}`));
})();
