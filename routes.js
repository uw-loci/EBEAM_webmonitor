const fs = require('fs');
const { supabase, REVERSED_FILE_PATH } = require('./config');
const state = require('./state');
const { computeAllColors } = require('./interlocks');
const { fetchDisplayFileContents } = require('./gdrive');
const { sampleGraph, pressureGraph } = require('./graphs');
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
        sampleGraph,
        pressureGraph,
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
        .from('beam_logs')
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

  // Raw reversed log file
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
