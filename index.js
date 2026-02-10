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
const { fetchAndUpdateFile } = require('./polling');
const registerRoutes = require('./routes');

const app = express();
app.use(express.static(path.join(__dirname, 'assets')));

// Register all routes
registerRoutes(app);

// Start server
(async function start() {
  // 1) grab the latest logs right now
  await fetchAndUpdateFile();

  // 2) then keep polling every 3 seconds
  setInterval(fetchAndUpdateFile, 3_000);

  // 3) finally open the HTTP port
  app.listen(PORT, () => console.log(`Listening on ${PORT}`));
})();
