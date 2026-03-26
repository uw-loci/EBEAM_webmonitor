const fs = require('fs');
const { supabase, REVERSED_FILE_PATH } = require('./config');
const state = require('./services/state');
const { computeAllColors } = require('./services/interlocks');
const { fetchDisplayFileContents } = require('./services/gdrive');
const {
  shortTermPressureGraph,
  longTermPressureGraph,
  ccsGraphA,
  ccsGraphB,
  ccsGraphC,
  clearPressureGraph,
  getGraphMetadata,
} = require('./services/graphs');
const { renderDashboard } = require('./views/dashboard');

const codeLastUpdated = new Date().toLocaleString('en-US', {
  timeZone: 'America/Chicago'
});

function registerRoutes(app) {

  // Dashboard HTML page
  app.get('/', async (req, res) => {
    try {
      console.log('experimentRunning: ', state.experimentRunning);

      const { sicColors, vacColors } = computeAllColors(state.data, state.experimentRunning);

      const html = renderDashboard({
        data: state.data,
        state,
        sicColors,
        vacColors,
        shortTermPressureGraph,
        longTermPressureGraph,
        ccsGraphA,
        ccsGraphB,
        ccsGraphC,
        codeLastUpdated,
      });

      res.send(html);
    } catch (err) {
      console.error(err);
      res.status(500).send(`Error: ${err.message}`);
    }
  });

  // JSON API endpoint for frontend polling
  app.get('/data', (req, res) => {
    const { sicColors, vacColors } = computeAllColors(state.data, state.experimentRunning);

    res.json({
      pressure: state.data.pressure,
      pressureTimestamp: state.data.pressureTimestamp,
      safetyInputStatusFlags: state.data.safetyInputStatusFlags,
      safetyOutputStatusFlags: state.data.safetyOutputStatusFlags,
      safetyOutputDataFlags: state.data.safetyOutputDataFlags,
      safetyInputDataFlags: state.data.safetyInputDataFlags,
      temperatures: state.data.temperatures,
      vacuumBits: state.data.vacuumBits,
      vacuumColors: vacColors,
      sicColors,
      heaterCurrent_A: state.data.heaterCurrent_A,
      heaterCurrent_B: state.data.heaterCurrent_B,
      heaterCurrent_C: state.data.heaterCurrent_C,
      heaterVoltage_A: state.data.heaterVoltage_A,
      heaterVoltage_B: state.data.heaterVoltage_B,
      heaterVoltage_C: state.data.heaterVoltage_C,
      clamp_temperature_A: state.data.clamp_temperature_A,
      clamp_temperature_B: state.data.clamp_temperature_B,
      clamp_temperature_C: state.data.clamp_temperature_C,
      siteLastUpdated: new Date().toISOString(),
      webMonitorLastModified: state.webMonitorLastModified || null,
      displayLogLastModified: state.displayLogLastModified || null
    });
  });

  app.get('/refresh-display', async (req, res) => {
    await fetchDisplayFileContents();
    res.status(200).send('Refreshed display logs');
  });

  // Health check endpoint
  app.get('/health', async (req, res) => {
    try {
      const { data, error } = await supabase
        .from('short_term_logs')
        .select('count')
        .limit(1);

      res.json({
        status: 'ok',
        supabase: error ? 'disconnected' : 'connected',
        experimentRunning: state.experimentRunning,
        lastUpdate: state.webMonitorLastModified
      });
    } catch (err) {
      res.status(500).json({
        status: 'error',
        message: err.message
      });
    }
  });

  // Chart data endpoint for live chart updates
  app.get('/chart-data', (req, res) => {
    const view = req.query.view === 'long' ? 'long' : 'short';
    const graph = view === 'long' ? longTermPressureGraph : shortTermPressureGraph;

    res.json({
      view,
      xVals: graph.displayXVals,
      yVals: graph.displayYVals,
      ...getGraphMetadata(graph),
    });
  });

  // CCS clamp temperature chart data
  app.get('/ccs-chart-data', (req, res) => {
    res.json({
      A: { xVals: ccsGraphA.xVals, yVals: ccsGraphA.yVals },
      B: { xVals: ccsGraphB.xVals, yVals: ccsGraphB.yVals },
      C: { xVals: ccsGraphC.xVals, yVals: ccsGraphC.yVals },
    });
  });

  // Experiment reset — deletes all log data
  app.post('/experiment-reset', async (req, res) => {
    const resetPassword = process.env.EXPERIMENT_RESET_PASSWORD;
    if (!resetPassword) {
      return res.status(503).json({ error: 'Experiment reset is not configured on this server.' });
    }

    const { password } = req.body || {};
    if (password !== resetPassword) {
      return res.status(401).json({ error: 'Incorrect password.' });
    }

    const [longResult, shortResult] = await Promise.all([
      supabase.from('long_term_logs').delete().gte('id', '00000000-0000-0000-0000-000000000000'),
      supabase.from('short_term_logs').delete().gte('id', 0),
    ]);

    if (longResult.error || shortResult.error) {
      const msg = (longResult.error?.message || '') + ' ' + (shortResult.error?.message || '');
      console.error('Experiment reset Supabase error:', msg.trim());
      return res.status(500).json({ error: msg.trim() });
    }

    clearPressureGraph(longTermPressureGraph);
    clearPressureGraph(shortTermPressureGraph);

    console.log('Experiment reset: long_term_logs and short_term_logs cleared.');
    return res.status(200).json({ success: true });
  });

  // Raw cached recent log snippet
  app.get('/raw', async (req, res) => {
    try {
      if (fs.existsSync(REVERSED_FILE_PATH)) {
        let content = await fs.promises.readFile(REVERSED_FILE_PATH, 'utf8');
        res.type('text/plain').send(content);
      } else {
        res.status(404).send("No file found.");
      }
    } catch (err) {
      console.error(err);
      res.status(500).send(`Error: ${err.message}`);
    }
  });
}

module.exports = registerRoutes;
