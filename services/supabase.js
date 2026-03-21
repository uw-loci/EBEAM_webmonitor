const { supabase } = require('../config');
const state = require('./state');
const { updateDisplayData, addCCSPoint } = require('./graphs');

const PAGE_SIZE = 1000;

function normalizeCursor(cursor) {
  if (!cursor?.timestamp) {
    return null;
  }

  return {
    timestamp: cursor.timestamp,
    id: cursor.id ?? null,
  };
}

function buildCursorFromRow(row, timestampColumn) {
  const timestamp = row?.[timestampColumn];
  if (!timestamp) {
    return null;
  }

  return {
    timestamp,
    id: row?.id ?? null,
  };
}

function isRowAfterCursor(row, timestampColumn, cursor) {
  if (!cursor) {
    return true;
  }

  const rowTimestamp = row?.[timestampColumn];
  if (!rowTimestamp) {
    return false;
  }

  if (rowTimestamp > cursor.timestamp) {
    return true;
  }

  if (rowTimestamp < cursor.timestamp) {
    return false;
  }

  if (cursor.id == null) {
    return false;
  }

  return row?.id > cursor.id;
}

async function fetchEntriesSince(tableName, columns, timestampColumn, cursor) {
  const rows = [];
  let from = 0;
  const normalizedCursor = normalizeCursor(cursor);

  while (true) {
    let query = supabase
      .from(tableName)
      .select(columns)
      .order(timestampColumn, { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (normalizedCursor) {
      query = query.gte(timestampColumn, normalizedCursor.timestamp);
    }

    const { data, error } = await query;

    if (error) {
      throw error;
    }

    if (!data || data.length === 0) {
      break;
    }

    const unseenRows = normalizedCursor
      ? data.filter((row) => isRowAfterCursor(row, timestampColumn, normalizedCursor))
      : data;

    rows.push(...unseenRows);

    if (data.length < PAGE_SIZE) {
      break;
    }

    from += PAGE_SIZE;
  }

  return rows;
}

/**
 * Maps Supabase log_data JSON to the application's data object format
 * @param {Object} logData - The log_data JSON from Supabase
 * @returns {Object} Mapped data object
 */
function mapSupabaseDataToAppFormat(logData) {
  if (!logData) return null;

  return {
    pressure: logData.pressure || null,
    pressureTimestamp: logData.pressureTimestamp || null,
    safetyInputDataFlags: logData.safetyInputDataFlags || null,
    safetyOutputDataFlags: logData.safetyOutputDataFlags || null,
    safetyInputStatusFlags: logData.safetyInputStatusFlags || null,
    safetyOutputStatusFlags: logData.safetyOutputStatusFlags || null,
    temperatures: logData.temperatures || null,
    vacuumBits: typeof logData.vacuumBits === 'string'
      ? logData.vacuumBits.split('').map(bit => bit === '1')
      : (logData.vacuumBits || null),
    heaterCurrent_A: logData["Cathode A - Heater Current:"] ?? null,
    heaterCurrent_B: logData["Cathode B - Heater Current:"] ?? null,
    heaterCurrent_C: logData["Cathode C - Heater Current:"] ?? null,
    heaterVoltage_A: logData["Cathode A - Heater Voltage:"] ?? null,
    heaterVoltage_B: logData["Cathode B - Heater Voltage:"] ?? null,
    heaterVoltage_C: logData["Cathode C - Heater Voltage:"] ?? null,
    clamp_temperature_A: logData.clamp_temperature_A ?? null,
    clamp_temperature_B: logData.clamp_temperature_B ?? null,
    clamp_temperature_C: logData.clamp_temperature_C ?? null
  };
}

/**
 * Reset data when experiment is inactive
 */
function resetData() {
  state.data = {
    pressure: null,
    pressureTimestamp: null,
    safetyOutputDataFlags: null,
    safetyInputDataFlags: null,
    safetyOutputStatusFlags: null,
    safetyInputStatusFlags: null,
    temperatures: null,
    vacuumBits: null,
    heaterCurrent_A: null,
    heaterCurrent_B: null,
    heaterCurrent_C: null,
    heaterVoltage_A: null,
    heaterVoltage_B: null,
    heaterVoltage_C: null,
    clamp_temperature_A: null,
    clamp_temperature_B: null,
    clamp_temperature_C: null
  };
}

/**
 * Backfills the short-term pressure graph from the last 24 hours of short_term_logs.
 * Time window: 24h (matches the "Last 24h" chart label and maxDataPoints: 30000 @ 3s ≈ 25h capacity).
 * @param {Object} graph - The graph object to populate
 * @returns {{ timestamp: string, id: string|null }|null} Cursor for the last row, or null if no data
 */
async function backfillShortTermGraph(graph) {
  try {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    let from = 0;
    let lastCursor = null;

    while (true) {
      const { data, error } = await supabase
        .from('short_term_logs')
        .select('id, created_at, data')
        .gte('created_at', twentyFourHoursAgo)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, from + PAGE_SIZE - 1);

      if (error) {
        console.error('Backfill short-term error:', error);
        break;
      }
      if (!data || data.length === 0) break;

      for (const row of data) {
        const pressure = row.data?.pressure;
        if (pressure == null) continue;
        const tSec = Math.floor(new Date(row.created_at).getTime() / 1000);
        graph.fullXVals.push(tSec);
        graph.fullYVals.push(parseFloat(pressure));
        updateDisplayData(graph);
      }

      lastCursor = buildCursorFromRow(data[data.length - 1], 'created_at');

      if (data.length < PAGE_SIZE) break;
      if (graph.fullXVals.length >= graph.maxDataPoints) break;
      from += PAGE_SIZE;
    }

    if (lastCursor === null) {
      console.log('No short-term data to backfill');
      return null;
    }
    console.log(`Backfilled ${graph.fullXVals.length} short-term points`);
    return lastCursor;
  } catch (err) {
    console.error('Error backfilling short-term graph:', err);
    return null;
  }
}

/**
 * Backfills the long-term pressure graph from long_term_logs.
 * Time window: all-time (matches the "Historical / All-time" chart label; 1-min averaged rows).
 * @param {Object} graph - The graph object to populate
 * @returns {{ timestamp: string, id: string|null }|null} Cursor for the last row, or null if no data
 */
async function backfillLongTermGraph(graph) {
  try {
    let from = 0;
    let lastCursor = null;

    while (true) {
      const { data, error } = await supabase
        .from('long_term_logs')
        .select('id, recorded_at, avg_pressure')
        .order('recorded_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, from + PAGE_SIZE - 1);

      if (error) {
        console.error('Backfill long-term error:', error);
        break;
      }
      if (!data || data.length === 0) break;

      for (const row of data) {
        if (row.avg_pressure == null) continue;
        const tSec = Math.floor(new Date(row.recorded_at).getTime() / 1000);
        graph.fullXVals.push(tSec);
        graph.fullYVals.push(row.avg_pressure);
        updateDisplayData(graph);
      }

      lastCursor = buildCursorFromRow(data[data.length - 1], 'recorded_at');

      if (data.length < PAGE_SIZE) break;
      if (graph.fullXVals.length >= graph.maxDataPoints) break;
      from += PAGE_SIZE;
    }

    if (lastCursor === null) {
      console.log('No long-term data to backfill');
      return null;
    }
    console.log(`Backfilled ${graph.fullXVals.length} long-term points`);
    return lastCursor;
  } catch (err) {
    console.error('Error backfilling long-term graph:', err);
    return null;
  }
}

/**
 * Fetches the most recent entry from short_term_logs.
 */
async function fetchLatestShortTermEntry() {
  try {
    const { data, error } = await supabase
      .from('short_term_logs')
      .select('id, created_at, data')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(1);

    if (error) {
      console.error('Short-term query error:', error);
      return null;
    }

    if (!data || data.length === 0) return null;
    return data[0];
  } catch (err) {
    console.error('Error fetching short-term entry:', err);
    return null;
  }
}

/**
 * Fetches the most recent entry from long_term_logs.
 */
async function fetchLatestLongTermEntry() {
  try {
    const { data, error } = await supabase
      .from('long_term_logs')
      .select('id, recorded_at, avg_pressure')
      .order('recorded_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(1);

    if (error) {
      console.error('Long-term query error:', error);
      return null;
    }

    if (!data || data.length === 0) return null;
    return data[0];
  } catch (err) {
    console.error('Error fetching long-term entry:', err);
    return null;
  }
}

/**
 * Fetches all short-term entries newer than the provided created_at/id cursor.
 * Results are returned oldest-first so callers can rebuild in-memory caches in order.
 */
async function fetchShortTermEntriesSince(cursor) {
  try {
    return await fetchEntriesSince('short_term_logs', 'id, created_at, data', 'created_at', cursor);
  } catch (err) {
    console.error('Error fetching short-term entries since cursor:', err);
    return [];
  }
}

/**
 * Fetches all long-term entries newer than the provided recorded_at/id cursor.
 * Results are returned oldest-first so callers can rebuild in-memory caches in order.
 */
async function fetchLongTermEntriesSince(cursor) {
  try {
    return await fetchEntriesSince('long_term_logs', 'id, recorded_at, avg_pressure', 'recorded_at', cursor);
  } catch (err) {
    console.error('Error fetching long-term entries since cursor:', err);
    return [];
  }
}

/**
 * Backfills the CCS clamp temperature graphs from the last hour of short_term_logs.
 * Time window: 1h (matches the CCS ring buffer capacity of 1200 points @ 3s ≈ 1h).
 * @param {Object} graphA - CCS graph object for cathode A
 * @param {Object} graphB - CCS graph object for cathode B
 * @param {Object} graphC - CCS graph object for cathode C
 * @returns {string|null} The created_at of the last row, or null if no data
 */
async function backfillCCSGraphs(graphA, graphB, graphC) {
  try {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    let from = 0;
    let lastTimestamp = null;
    let totalPoints = 0;

    while (true) {
      const { data, error } = await supabase
        .from('short_term_logs')
        .select('id, created_at, data')
        .gte('created_at', oneHourAgo)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, from + PAGE_SIZE - 1);

      if (error) {
        console.error('Backfill CCS graphs error:', error);
        break;
      }
      if (!data || data.length === 0) break;

      for (const row of data) {
        const tSec = Math.floor(new Date(row.created_at).getTime() / 1000);
        addCCSPoint(graphA, tSec, row.data?.clamp_temperature_A ?? null);
        addCCSPoint(graphB, tSec, row.data?.clamp_temperature_B ?? null);
        addCCSPoint(graphC, tSec, row.data?.clamp_temperature_C ?? null);
      }

      totalPoints += data.length;
      lastTimestamp = data[data.length - 1].created_at;

      if (data.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }

    if (lastTimestamp === null) {
      console.log('No CCS data to backfill');
      return null;
    }
    console.log(`Backfilled CCS graphs with ${totalPoints} points`);
    return lastTimestamp;
  } catch (err) {
    console.error('Error backfilling CCS graphs:', err);
    return null;
  }
}

module.exports = {
  mapSupabaseDataToAppFormat,
  resetData,
  backfillShortTermGraph,
  backfillLongTermGraph,
  backfillCCSGraphs,
  fetchLatestShortTermEntry,
  fetchLatestLongTermEntry,
  fetchShortTermEntriesSince,
  fetchLongTermEntriesSince,
};
