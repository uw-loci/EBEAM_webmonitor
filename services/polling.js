const { INACTIVE_THRESHOLD } = require('../config');
const state = require('./state');
const { fetchLatestSupabaseEntry, mapSupabaseDataToAppFormat, resetData } = require('./supabase');
const { fetchDisplayFileContents } = require('./gdrive');
const { sampleGraph, pressureGraph, addSampleChartDataPoint, updateDisplayData } = require('./graphs');

/**
 * Main polling function - fetches from Supabase and updates global state.
 *
 * Steps:
 * 1. Fetch latest entry from Supabase
 * 2. Check if experiment is still active (within 15 minutes)
 * 3. Map Supabase data to application format
 * 4. Update global data object
 * 5. Fetch display logs from Google Drive (separate operation)
 */
async function fetchAndUpdateFile() {
  sampleGraph.chartDataIntervalCount++;
  if (sampleGraph.chartDataIntervalCount == sampleGraph.chartDataIntervalDuration) {
    if (sampleGraph.fullXVals.length < sampleGraph.maxDataPoints) {
      addSampleChartDataPoint();
      sampleGraph.chartDataIntervalCount = 0;
    }
  }

  try {
    // 1. Fetch latest entry from Supabase
    const latestEntry = await fetchLatestSupabaseEntry();

    if (!latestEntry) {
      console.log('No data available from Supabase');
      state.experimentRunning = false;
      resetData();
      return;
    }

    // 2. Parse experiment timestamp (use created_at which has proper UTC timezone)
    const experimentTime = new Date(latestEntry.created_at);
    const experimentTimestamp = experimentTime.getTime();
    state.webMonitorLastModified = experimentTime;

    // 3. Check if experiment is still active (within 15 minutes)
    const now = Date.now();

    if (now - experimentTimestamp > INACTIVE_THRESHOLD) {
      console.log('Experiment inactive - last update too old');
      state.experimentRunning = false;
      resetData();
      return;
    }

    // 4. Map Supabase data to application format
    const mappedData = mapSupabaseDataToAppFormat(latestEntry.log_data);

    if (mappedData) {
      Object.assign(state.data, mappedData);
      state.experimentRunning = true;
      console.log(`Data updated from Supabase at ${new Date().toLocaleTimeString()}`);

      // Update pressure graph
      if (state.data.pressure !== null && state.data.pressureTimestamp !== null) {
        pressureGraph.fullXVals.push(state.data.pressureTimestamp);
        pressureGraph.fullYVals.push(state.data.pressure);
        updateDisplayData(pressureGraph);
      }
    } else {
      console.log('Failed to map Supabase data');
      state.experimentRunning = false;
      resetData();
    }

    // 5. Still fetch display logs from Google Drive (separate operation)
    await fetchDisplayFileContents();

  } catch (error) {
    console.error('Error in fetchAndUpdateFile:', error);
    state.experimentRunning = false;
    resetData();
  }
}

module.exports = { fetchAndUpdateFile };
