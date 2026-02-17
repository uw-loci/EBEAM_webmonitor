const { INACTIVE_THRESHOLD } = require('../config');
const state = require('./state');
const { mapSupabaseDataToAppFormat, resetData, fetchLatestShortTermEntry, fetchLatestLongTermEntry } = require('./supabase');
const { fetchDisplayFileContents } = require('./gdrive');
const { sampleGraph, shortTermPressureGraph, longTermPressureGraph, addSampleChartDataPoint, updateDisplayData } = require('./graphs');

/**
 * Polls the short_term_logs table for the latest entry.
 * Skips if the timestamp hasn't advanced past the last one we processed.
 */
async function pollShortTerm() {
  try {
    const entry = await fetchLatestShortTermEntry();
    if (!entry) return;

    const entryTimestamp = entry.created_at;
    if (state.lastShortTermTimestamp && entryTimestamp <= state.lastShortTermTimestamp) return;

    const pressure = entry.data?.pressure;
    if (pressure == null) return;

    const tSec = Math.floor(new Date(entryTimestamp).getTime() / 1000);
    shortTermPressureGraph.fullXVals.push(tSec);
    shortTermPressureGraph.fullYVals.push(parseFloat(pressure));
    updateDisplayData(shortTermPressureGraph);

    state.lastShortTermTimestamp = entryTimestamp;
  } catch (err) {
    console.error('Error in pollShortTerm:', err);
  }
}

/**
 * Polls the long_term_logs table for the latest entry.
 * Skips if the timestamp hasn't advanced past the last one we processed.
 */
async function pollLongTerm() {
  try {
    const entry = await fetchLatestLongTermEntry();
    if (!entry) return;

    const entryTimestamp = entry.recorded_at;
    if (state.lastLongTermTimestamp && entryTimestamp <= state.lastLongTermTimestamp) return;

    if (entry.avg_pressure == null) return;

    const tSec = Math.floor(new Date(entryTimestamp).getTime() / 1000);
    longTermPressureGraph.fullXVals.push(tSec);
    longTermPressureGraph.fullYVals.push(entry.avg_pressure);
    updateDisplayData(longTermPressureGraph);

    state.lastLongTermTimestamp = entryTimestamp;
  } catch (err) {
    console.error('Error in pollLongTerm:', err);
  }
}

/**
 * Main polling function - fetches from Supabase and updates global state.
 *
 * Steps:
 * 1. Tick sample graph
 * 2. Fetch latest entry from short_term_logs for scalar state + graph
 * 3. Check if experiment is still active (within 15 minutes)
 * 4. Map data to application format and update global state
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
    // 1. Fetch latest entry from short_term_logs
    const latestEntry = await fetchLatestShortTermEntry();

    if (!latestEntry) {
      console.log('No data available from Supabase');
      state.experimentRunning = false;
      resetData();
      return;
    }

    // 2. Parse experiment timestamp
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

    // 4. Map data to application format
    const mappedData = mapSupabaseDataToAppFormat(latestEntry.data);

    if (mappedData) {
      Object.assign(state.data, mappedData);
      state.experimentRunning = true;
      console.log(`Data updated from Supabase at ${new Date().toLocaleTimeString()}`);
    } else {
      console.log('Failed to map Supabase data');
      state.experimentRunning = false;
      resetData();
    }

    // 5. Update short-term pressure graph (dedup by timestamp)
    await pollShortTerm();

    // 6. Fetch display logs from Google Drive (separate operation)
    await fetchDisplayFileContents();

  } catch (error) {
    console.error('Error in fetchAndUpdateFile:', error);
    state.experimentRunning = false;
    resetData();
  }
}

module.exports = { fetchAndUpdateFile, pollLongTerm };
