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
const { fetchAndUpdateFile, pollLongTerm } = require('./services/polling');
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
  state.lastShortTermTimestamp = await backfillShortTermGraph(shortTermPressureGraph);

  console.log('Backfilling long-term pressure cache...');
  state.lastLongTermTimestamp = await backfillLongTermGraph(longTermPressureGraph);

  console.log('Backfilling CCS temperature graphs...');
  await backfillCCSGraphs(ccsGraphA, ccsGraphB, ccsGraphC);

  // 2) Grab the latest scalar data right now
  await fetchAndUpdateFile();

  // 3) Poll short-term + scalars every 3 seconds
  setInterval(fetchAndUpdateFile, 3_000);

  // 4) Poll long-term every 60 seconds
  setInterval(pollLongTerm, 60_000);

  // 5) Open the HTTP port after caches are warm
  app.listen(PORT, () => console.log(`Listening on ${PORT}`));
})();
