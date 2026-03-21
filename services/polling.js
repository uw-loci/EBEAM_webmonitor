const { INACTIVE_THRESHOLD } = require('../config');
const state = require('./state');
const {
  mapSupabaseDataToAppFormat,
  resetData,
  fetchLatestShortTermEntry,
  fetchShortTermEntriesSince,
  fetchLongTermEntriesSince,
} = require('./supabase');
const { fetchDisplayFileContents } = require('./gdrive');
const {
  shortTermPressureGraph,
  longTermPressureGraph,
  updateDisplayData,
  addCCSPoint,
  ccsGraphA,
  ccsGraphB,
  ccsGraphC,
} = require('./graphs');

const SHORT_TERM_EXPECTED_INTERVAL_MS = 3_000;
const LONG_TERM_EXPECTED_INTERVAL_MS = 60_000;

let telemetrySyncInProgress = false;
let displayRefreshInProgress = false;

function parseTimestampMs(timestamp) {
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : null;
}

function getCursorTimestamp(cursor) {
  return cursor?.timestamp ?? null;
}

function buildCursor(timestamp, id) {
  if (!timestamp) {
    return null;
  }

  return {
    timestamp,
    id: id ?? null,
  };
}

function logGapIfNeeded({
  logger,
  label,
  previousTimestamp,
  previousMs,
  currentTimestamp,
  currentMs,
  expectedIntervalMs,
}) {
  if (previousMs == null || currentMs == null) {
    return;
  }

  const gapMs = currentMs - previousMs;
  if (gapMs > expectedIntervalMs * 2) {
    logger.warn(
      `${label} sync gap detected: ${gapMs} ms between ${previousTimestamp} and ${currentTimestamp}`
    );
  }
}

function logBatchSummary(logger, label, summary) {
  if (summary.batchSize === 0) {
    return;
  }

  logger.log(
    `${label} sync processed ${summary.batchSize} rows ` +
    `(${summary.appendedCount} plotted, ${summary.skippedCount} skipped) ` +
    `from ${summary.firstTimestamp} to ${summary.lastTimestamp}`
  );
}

function applyShortTermEntries(entries, options = {}) {
  const {
    stateRef = state,
    graph = shortTermPressureGraph,
    graphUpdater = updateDisplayData,
    ccsA = ccsGraphA,
    ccsB = ccsGraphB,
    ccsC = ccsGraphC,
    ccsPointAdder = addCCSPoint,
    logger = console,
    expectedIntervalMs = SHORT_TERM_EXPECTED_INTERVAL_MS,
  } = options;

  const summary = {
    batchSize: entries.length,
    appendedCount: 0,
    skippedCount: 0,
    firstTimestamp: null,
    lastTimestamp: getCursorTimestamp(stateRef.lastShortTermCursor),
  };

  let previousTimestamp = getCursorTimestamp(stateRef.lastShortTermCursor);
  let previousMs = parseTimestampMs(previousTimestamp);

  for (const entry of entries) {
    const entryTimestamp = entry?.created_at;
    const entryMs = parseTimestampMs(entryTimestamp);
    const entryCursor = buildCursor(entryTimestamp, entry?.id);

    if (!entryTimestamp || entryMs == null) {
      logger.warn('Skipping short-term row with invalid timestamp');
      continue;
    }

    if (summary.firstTimestamp === null) {
      summary.firstTimestamp = entryTimestamp;
    }

    logGapIfNeeded({
      logger,
      label: 'Short-term',
      previousTimestamp,
      previousMs,
      currentTimestamp: entryTimestamp,
      currentMs: entryMs,
      expectedIntervalMs,
    });

    const tSec = Math.floor(entryMs / 1000);

    ccsPointAdder(ccsA, tSec, entry.data?.clamp_temperature_A ?? null);
    ccsPointAdder(ccsB, tSec, entry.data?.clamp_temperature_B ?? null);
    ccsPointAdder(ccsC, tSec, entry.data?.clamp_temperature_C ?? null);

    const pressure = Number.parseFloat(entry.data?.pressure);
    if (!Number.isFinite(pressure)) {
      summary.skippedCount++;
      logger.warn(`Skipping short-term pressure row at ${entryTimestamp}: invalid pressure value`);
      stateRef.lastShortTermCursor = entryCursor;
      previousTimestamp = entryTimestamp;
      previousMs = entryMs;
      summary.lastTimestamp = entryTimestamp;
      continue;
    }

    graph.fullXVals.push(tSec);
    graph.fullYVals.push(pressure);
    graphUpdater(graph);

    summary.appendedCount++;
    stateRef.lastShortTermCursor = entryCursor;
    previousTimestamp = entryTimestamp;
    previousMs = entryMs;
    summary.lastTimestamp = entryTimestamp;
  }

  logBatchSummary(logger, 'Short-term', summary);
  return summary;
}

function applyLongTermEntries(entries, options = {}) {
  const {
    stateRef = state,
    graph = longTermPressureGraph,
    graphUpdater = updateDisplayData,
    logger = console,
    expectedIntervalMs = LONG_TERM_EXPECTED_INTERVAL_MS,
  } = options;

  const summary = {
    batchSize: entries.length,
    appendedCount: 0,
    skippedCount: 0,
    firstTimestamp: null,
    lastTimestamp: getCursorTimestamp(stateRef.lastLongTermCursor),
  };

  let previousTimestamp = getCursorTimestamp(stateRef.lastLongTermCursor);
  let previousMs = parseTimestampMs(previousTimestamp);

  for (const entry of entries) {
    const entryTimestamp = entry?.recorded_at;
    const entryMs = parseTimestampMs(entryTimestamp);
    const entryCursor = buildCursor(entryTimestamp, entry?.id);

    if (!entryTimestamp || entryMs == null) {
      logger.warn('Skipping long-term row with invalid timestamp');
      continue;
    }

    if (summary.firstTimestamp === null) {
      summary.firstTimestamp = entryTimestamp;
    }

    logGapIfNeeded({
      logger,
      label: 'Long-term',
      previousTimestamp,
      previousMs,
      currentTimestamp: entryTimestamp,
      currentMs: entryMs,
      expectedIntervalMs,
    });

    const pressure = Number.parseFloat(entry.avg_pressure);
    if (!Number.isFinite(pressure)) {
      summary.skippedCount++;
      logger.warn(`Skipping long-term pressure row at ${entryTimestamp}: invalid avg_pressure`);
      stateRef.lastLongTermCursor = entryCursor;
      previousTimestamp = entryTimestamp;
      previousMs = entryMs;
      summary.lastTimestamp = entryTimestamp;
      continue;
    }

    const tSec = Math.floor(entryMs / 1000);
    graph.fullXVals.push(tSec);
    graph.fullYVals.push(pressure);
    graphUpdater(graph);

    summary.appendedCount++;
    stateRef.lastLongTermCursor = entryCursor;
    previousTimestamp = entryTimestamp;
    previousMs = entryMs;
    summary.lastTimestamp = entryTimestamp;
  }

  logBatchSummary(logger, 'Long-term', summary);
  return summary;
}

/**
 * Polls the short_term_logs table and drains every unseen row since the last cursor.
 */
async function pollShortTerm() {
  try {
    const entries = await fetchShortTermEntriesSince(state.lastShortTermCursor);
    return applyShortTermEntries(entries);
  } catch (err) {
    console.error('Error in pollShortTerm:', err);
    return null;
  }
}

/**
 * Polls the long_term_logs table and drains every unseen row since the last cursor.
 */
async function pollLongTerm() {
  try {
    const entries = await fetchLongTermEntriesSince(state.lastLongTermCursor);
    return applyLongTermEntries(entries);
  } catch (err) {
    console.error('Error in pollLongTerm:', err);
    return null;
  }
}

/**
 * Main telemetry polling function - fetches scalar state and catches up graph caches.
 */
async function fetchAndUpdateFile() {
  if (telemetrySyncInProgress) {
    console.warn('Telemetry sync skipped because the previous run is still in progress');
    return;
  }

  telemetrySyncInProgress = true;

  try {
    const latestEntry = await fetchLatestShortTermEntry();

    if (!latestEntry) {
      console.log('No data available from Supabase');
      state.experimentRunning = false;
      resetData();
      return;
    }

    await pollShortTerm();

    const experimentTime = new Date(latestEntry.created_at);
    const experimentTimestamp = experimentTime.getTime();
    state.webMonitorLastModified = experimentTime;

    const now = Date.now();

    if (now - experimentTimestamp > INACTIVE_THRESHOLD) {
      console.log('Experiment inactive - last update too old');
      state.experimentRunning = false;
      resetData();
      return;
    }

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
  } catch (error) {
    console.error('Error in fetchAndUpdateFile:', error);
    state.experimentRunning = false;
    resetData();
  } finally {
    telemetrySyncInProgress = false;
  }
}

async function refreshDisplayLogs() {
  if (displayRefreshInProgress) {
    console.warn('Display log refresh skipped because the previous run is still in progress');
    return false;
  }

  displayRefreshInProgress = true;

  try {
    return await fetchDisplayFileContents();
  } finally {
    displayRefreshInProgress = false;
  }
}

module.exports = {
  fetchAndUpdateFile,
  pollShortTerm,
  pollLongTerm,
  refreshDisplayLogs,
  applyShortTermEntries,
  applyLongTermEntries,
  SHORT_TERM_EXPECTED_INTERVAL_MS,
  LONG_TERM_EXPECTED_INTERVAL_MS,
};
