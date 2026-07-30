const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

process.env.FOLDER_ID ??= 'test-folder';
process.env.API_KEY ??= 'test-api-key';
process.env.SUPABASE_API_URL ??= 'http://127.0.0.1:54321';
process.env.SUPABASE_API_KEY ??= 'test-supabase-key';

const supabaseTables = {
  short_term_logs: [],
  long_term_logs: [],
};
const supabaseQueryDelaysMs = {
  short_term_logs: 0,
  long_term_logs: 0,
};
const supabaseQueryCounts = {
  short_term_logs: 0,
  long_term_logs: 0,
};

function cloneRow(row) {
  if (!row || typeof row !== 'object') {
    return row;
  }

  return {
    ...row,
    data: row.data && typeof row.data === 'object'
      ? { ...row.data }
      : row.data,
  };
}

function resetSupabaseTables() {
  supabaseTables.short_term_logs = [];
  supabaseTables.long_term_logs = [];
}

function resetSupabaseQueryControls() {
  supabaseQueryDelaysMs.short_term_logs = 0;
  supabaseQueryDelaysMs.long_term_logs = 0;
  supabaseQueryCounts.short_term_logs = 0;
  supabaseQueryCounts.long_term_logs = 0;
}

function setSupabaseTableRows(tableName, rows) {
  supabaseTables[tableName] = rows.map(cloneRow);
}

function setSupabaseQueryDelay(tableName, delayMs) {
  supabaseQueryDelaysMs[tableName] = delayMs;
}

function getSupabaseQueryCount(tableName) {
  return supabaseQueryCounts[tableName] ?? 0;
}

function compareValues(left, right) {
  if (left === right) {
    return 0;
  }

  return left < right ? -1 : 1;
}

function applySupabaseOrder(rows, orderings, rangeFrom) {
  if (orderings.length === 0) {
    return rows.slice();
  }

  const pageIndex = Math.floor((rangeFrom ?? 0) / 1000);
  const unstableTieDirection = pageIndex % 2 === 0 ? 1 : -1;

  return rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      for (const { column, ascending } of orderings) {
        const comparison = compareValues(left.row[column], right.row[column]);
        if (comparison !== 0) {
          return ascending ? comparison : -comparison;
        }
      }

      if (orderings.length === 1) {
        return unstableTieDirection * (left.index - right.index);
      }

      return left.index - right.index;
    })
    .map(({ row }) => row);
}

function projectSupabaseRow(row, selectedColumns) {
  if (!selectedColumns || selectedColumns === '*') {
    return cloneRow(row);
  }

  const columns = selectedColumns
    .split(',')
    .map((column) => column.trim())
    .filter(Boolean);

  return Object.fromEntries(columns.map((column) => [column, cloneRow(row[column])]));
}

function matchesSupabaseFilters(row, filters) {
  return filters.every(({ operator, column, value }) => {
    if (operator === 'gt') {
      return row[column] > value;
    }

    if (operator === 'gte') {
      return row[column] >= value;
    }

    return true;
  });
}

function evaluateSupabaseQuery(queryState) {
  const {
    tableName,
    selectedColumns,
    orderings,
    filters,
    limitCount,
    rangeFrom,
    rangeTo,
    operation,
  } = queryState;
  const tableRows = supabaseTables[tableName] ?? [];

  if (operation === 'delete') {
    const deletedRows = [];
    const remainingRows = [];

    for (const row of tableRows) {
      if (matchesSupabaseFilters(row, filters)) {
        deletedRows.push(row);
      } else {
        remainingRows.push(row);
      }
    }

    supabaseTables[tableName] = remainingRows.map(cloneRow);
    return { data: deletedRows.map(cloneRow), error: null };
  }

  let rows = tableRows.filter((row) => matchesSupabaseFilters(row, filters));
  rows = applySupabaseOrder(rows, orderings, rangeFrom);

  if (typeof rangeFrom === 'number' && typeof rangeTo === 'number') {
    rows = rows.slice(rangeFrom, rangeTo + 1);
  } else if (typeof limitCount === 'number') {
    rows = rows.slice(0, limitCount);
  }

  return {
    data: rows.map((row) => projectSupabaseRow(row, selectedColumns)),
    error: null,
  };
}

function createSupabaseQueryBuilder(tableName) {
  const queryState = {
    tableName,
    selectedColumns: '*',
    orderings: [],
    filters: [],
    limitCount: null,
    rangeFrom: null,
    rangeTo: null,
    operation: 'select',
  };

  const builder = {
    select(columns) {
      queryState.selectedColumns = columns;
      return builder;
    },
    order(column, options = {}) {
      queryState.orderings.push({
        column,
        ascending: options.ascending !== false,
      });
      return builder;
    },
    limit(count) {
      queryState.limitCount = count;
      return builder;
    },
    range(from, to) {
      queryState.rangeFrom = from;
      queryState.rangeTo = to;
      return builder;
    },
    gte(column, value) {
      queryState.filters.push({ operator: 'gte', column, value });
      return builder;
    },
    gt(column, value) {
      queryState.filters.push({ operator: 'gt', column, value });
      return builder;
    },
    delete() {
      queryState.operation = 'delete';
      return builder;
    },
    then(resolve, reject) {
      supabaseQueryCounts[tableName] = (supabaseQueryCounts[tableName] ?? 0) + 1;

      const result = evaluateSupabaseQuery(queryState);
      const delayMs = supabaseQueryDelaysMs[tableName] ?? 0;

      if (delayMs > 0) {
        return new Promise((resultResolve) => setTimeout(resultResolve, delayMs, result))
          .then(resolve, reject);
      }

      return Promise.resolve(result).then(resolve, reject);
    },
  };

  return builder;
}

const originalLoad = Module._load;
Module._load = function mockExternalDependencies(request, parent, isMain) {
  if (request === 'dotenv') {
    return { config: () => ({}) };
  }

  if (request === '@supabase/supabase-js') {
    return {
      createClient: () => ({
        from: (tableName) => createSupabaseQueryBuilder(tableName),
      }),
    };
  }

  return originalLoad(request, parent, isMain);
};

const state = require('../services/state');
const { INACTIVE_THRESHOLD } = require('../config');
const registerRoutes = require('../routes');
const {
  getMachineStatusState,
  fetchJsonWithTimeout,
  normalizePressureSeriesForLogScale,
  getPaddedPressureLogRange,
  filterPressureLogGridSplits,
  getPressureTimeWindowBounds,
  clampPressureViewportRange,
  getCCSTimeWindowBounds,
  buildPressureViewportSample,
} = require('../views/dashboard');
const {
  createGraphObj,
  appendPressurePoint,
  clearPressureGraph,
  shortTermPressureGraph,
  longTermPressureGraph,
  ccsGraphA,
  ccsGraphB,
  ccsGraphC,
} = require('../services/graphs');
const {
  mapSupabaseDataToAppFormat,
  resetData,
  backfillShortTermGraph,
  backfillLongTermGraph,
  fetchShortTermEntriesSince,
  fetchLongTermEntriesSince,
} = require('../services/supabase');
const {
  applyShortTermEntries,
  applyLongTermEntries,
  fetchAndUpdateFile,
  pollLongTerm,
} = require('../services/polling');
const {
  FALLBACK_SNIPPET_LINES,
  MAX_SNIPPET_BYTES,
  MAX_SNIPPET_LINES,
  RECENT_LOG_WINDOW_MS,
  collectRecentLogSnippet,
  fetchDisplayFileContents,
  getMostRecentFile,
  listDriveTextFiles,
} = require('../services/gdrive');

function createLogger() {
  const logs = [];
  const warns = [];

  return {
    logs,
    warns,
    logger: {
      log: (...args) => logs.push(args.join(' ')),
      warn: (...args) => warns.push(args.join(' ')),
      error: () => {},
    },
  };
}

function createCCSGraph() {
  return { xVals: [], yVals: [] };
}

function addCCSPointForTest(graph, tSec, value) {
  graph.xVals.push(tSec);
  graph.yVals.push(value);
}

function buildShortTermEntries(count, options = {}) {
  const {
    startMs = Date.parse('2026-03-21T12:00:00.000Z'),
    intervalMs = 3_000,
    pressureFactory = (index) => `${1e-6 + index * 1e-7}`,
    pressure902bFactory = (index) => `${2e-6 + index * 1e-7}`,
    idFactory = (index) => `short-${String(index).padStart(6, '0')}`,
  } = options;

  return Array.from({ length: count }, (_, index) => ({
    id: idFactory(index),
    created_at: new Date(startMs + index * intervalMs).toISOString(),
    data: {
      pressure: pressureFactory(index),
      pressure_902b_mbar: pressure902bFactory(index),
      cathode: {
        A: { clamp_temperature: 100 + index },
        B: { clamp_temperature: 200 + index },
        C: { clamp_temperature: 300 + index },
      },
    },
  }));
}

function buildLongTermEntries(count, options = {}) {
  const {
    startMs = Date.parse('2026-03-21T12:00:00.000Z'),
    intervalMs = 60_000,
    pressureFactory = (index) => 1e-6 + index * 1e-7,
    idFactory = (index) => `long-${String(index).padStart(6, '0')}`,
  } = options;

  return Array.from({ length: count }, (_, index) => ({
    id: idFactory(index),
    recorded_at: new Date(startMs + index * intervalMs).toISOString(),
    avg_pressure: pressureFactory(index),
  }));
}

function resetPressureGraph(graph) {
  graph.fullXVals.length = 0;
  graph.fullYVals.length = 0;
  graph.displayXVals.length = 0;
  graph.displayYVals.length = 0;
  graph.fullPressure902bVals.length = 0;
  graph.displayPressure902bVals.length = 0;
  graph.lastUsedFactor = 1;
  graph.lastPermanentIndex = -1;
  graph.chartDataIntervalCount = 0;
  graph.chartDataIntervalDuration = 1;
  graph.nextPointIndex = 0;
}

function resetCCSGraph(graph) {
  graph.xVals.length = 0;
  graph.yVals.length = 0;
}

function assertPressureGraphDisplayIntegrity(graph) {
  assert.equal(
    graph.displayXVals.length,
    graph.displayYVals.length,
    'expected pressure display x/y arrays to stay aligned'
  );
  assert.equal(
    graph.fullXVals.length,
    graph.fullPressure902bVals.length,
    'expected raw pressure x/902B arrays to stay aligned'
  );
  assert.equal(
    graph.displayXVals.length,
    graph.displayPressure902bVals.length,
    'expected display pressure x/902B arrays to stay aligned'
  );
  assert.ok(
    graph.displayXVals.length <= graph.maxDisplayPoints,
    `expected display points to stay within cap, got ${graph.displayXVals.length}`
  );

  for (let index = 1; index < graph.displayXVals.length; index++) {
    assert.ok(
      graph.displayXVals[index] > graph.displayXVals[index - 1],
      `expected strictly increasing display x values at index ${index}`
    );
  }

  if (graph.fullXVals.length === 0) {
    assert.equal(graph.displayXVals.length, 0);
    return;
  }

  assert.equal(graph.displayXVals.at(-1), graph.fullXVals.at(-1));
  assert.equal(graph.displayYVals.at(-1), graph.fullYVals.at(-1));
  assert.equal(graph.displayPressure902bVals.at(-1), graph.fullPressure902bVals.at(-1));
}

function resetSingletonState() {
  state.lastShortTermCursor = null;
  state.lastLongTermCursor = null;
  state.webMonitorLastModified = null;
  state.displayLogLastModified = null;
  state.displayLogFileId = null;
  state.experimentRunning = false;
  state.data = {
    pressure: null,
    pressure_902b_mbar: null,
    pressureTimestamp: null,
    safetyOutputDataFlags: null,
    safetyInputDataFlags: null,
    safetyOutputStatusFlags: null,
    safetyInputStatusFlags: null,
    temperatures: null,
    vacuumBits: null,
    machine_status_temps: null,
    machine_status_pressure_1e_4: null,
    machine_status_interlocks: null,
    machine_status_hv_panel: null,
    machine_status_pressure_1e_6: null,
    machine_status_hvps_nominal: null,
    machine_status_bcon: null,
    machine_status_cathodes: null,
    machine_status_beams_ready: null,
    machine_status_beams_on: null,
    heaterCurrent_A: null,
    heaterCurrent_B: null,
    heaterCurrent_C: null,
    heaterVoltage_A: null,
    heaterVoltage_B: null,
    heaterVoltage_C: null,
    clamp_temperature_A: null,
    clamp_temperature_B: null,
    clamp_temperature_C: null,
    pos_1kv_set: null,
    pos_1kv_hv: null,
    pos_1kv_i: null,
    pos_1kv_output: null,
    neg_1kv_set: null,
    neg_1kv_hv: null,
    neg_1kv_i: null,
    neg_1kv_output: null,
    pos_20kv_set: null,
    pos_20kv_hv: null,
    pos_20kv_i: null,
    pos_20kv_output: null,
    pos_3kv_set: null,
    pos_3kv_hv: null,
    pos_3kv_i: null,
    pos_3kv_output: null,
  };
}

function createFakeApp() {
  const routes = [];

  return {
    routes,
    get(path, handler) {
      routes.push({ method: 'GET', path, handler });
    },
    post(path, handler) {
      routes.push({ method: 'POST', path, handler });
    },
  };
}

function createResponseRecorder() {
  return {
    statusCode: 200,
    payload: null,
    contentType: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    type(value) {
      this.contentType = value;
      return this;
    },
    json(body) {
      this.payload = body;
      return this;
    },
    send(body) {
      this.payload = body;
      return this;
    },
  };
}

beforeEach(() => {
  resetSupabaseTables();
  resetSupabaseQueryControls();
  resetSingletonState();
  resetPressureGraph(shortTermPressureGraph);
  resetPressureGraph(longTermPressureGraph);
  resetCCSGraph(ccsGraphA);
  resetCCSGraph(ccsGraphB);
  resetCCSGraph(ccsGraphC);
});

test('maps the 902B Supabase pressure into scalar state', () => {
  const mapped = mapSupabaseDataToAppFormat({
    pressure: '1.234e-6',
    pressure_902b_mbar: 5.678e-7,
  });

  assert.equal(mapped.pressure, '1.234e-6');
  assert.equal(mapped.pressure_902b_mbar, 5.678e-7);
});

test('Supabase mapping extracts every machine status milestone into a flat field', () => {
  const machineStatus = {
    STATUS_TEMPS: 'green',
    STATUS_PRESSURE_1E_4: 'red',
    STATUS_INTERLOCKS: 'gray',
    STATUS_HV_PANEL: 'green',
    STATUS_PRESSURE_1E_6: 'red',
    STATUS_HVPS_NOMINAL: 'green',
    STATUS_BCON: 'gray',
    STATUS_CATHODES: 'green',
    STATUS_BEAMS_READY: 'red',
    STATUS_BEAMS_ON: 'green',
  };

  const mapped = mapSupabaseDataToAppFormat({ machine_status: machineStatus });

  assert.deepEqual(
    {
      machine_status_temps: mapped.machine_status_temps,
      machine_status_pressure_1e_4: mapped.machine_status_pressure_1e_4,
      machine_status_interlocks: mapped.machine_status_interlocks,
      machine_status_hv_panel: mapped.machine_status_hv_panel,
      machine_status_pressure_1e_6: mapped.machine_status_pressure_1e_6,
      machine_status_hvps_nominal: mapped.machine_status_hvps_nominal,
      machine_status_bcon: mapped.machine_status_bcon,
      machine_status_cathodes: mapped.machine_status_cathodes,
      machine_status_beams_ready: mapped.machine_status_beams_ready,
      machine_status_beams_on: mapped.machine_status_beams_on,
    },
    {
      machine_status_temps: 'green',
      machine_status_pressure_1e_4: 'red',
      machine_status_interlocks: 'gray',
      machine_status_hv_panel: 'green',
      machine_status_pressure_1e_6: 'red',
      machine_status_hvps_nominal: 'green',
      machine_status_bcon: 'gray',
      machine_status_cathodes: 'green',
      machine_status_beams_ready: 'red',
      machine_status_beams_on: 'green',
    }
  );
  assert.equal(Object.hasOwn(mapped, 'machineStatus'), false);
  assert.equal(
    mapSupabaseDataToAppFormat({ machine_status: [] }).machine_status_temps,
    null
  );
});

test('resetData clears machine status with other inactive telemetry', () => {
  state.data.machine_status_temps = 'green';
  state.data.machine_status_beams_on = 'red';

  resetData();

  assert.equal(state.data.machine_status_temps, null);
  assert.equal(state.data.machine_status_beams_on, null);
});

test('machine status state validation falls back to gray', () => {
  assert.equal(getMachineStatusState('green', true), 'green');
  assert.equal(getMachineStatusState('red', true), 'red');
  assert.equal(getMachineStatusState('gray', true), 'gray');
  assert.equal(getMachineStatusState('blue', true), 'gray');
  assert.equal(getMachineStatusState('green', false), 'gray');
  assert.equal(getMachineStatusState(null, true), 'gray');
});

test('inactivity threshold is two minutes', () => {
  assert.equal(INACTIVE_THRESHOLD, 2 * 60 * 1000);
});

test('/data exposes backend activity and the latest machine status fields individually', () => {
  state.experimentRunning = true;
  state.data.machine_status_temps = 'green';
  state.data.machine_status_pressure_1e_4 = 'red';

  const app = createFakeApp();
  registerRoutes(app);
  const dataRoute = app.routes.find((route) => route.method === 'GET' && route.path === '/data');
  const response = createResponseRecorder();

  dataRoute.handler({}, response);

  assert.equal(response.payload.experimentRunning, true);
  assert.equal(response.payload.machine_status_temps, 'green');
  assert.equal(response.payload.machine_status_pressure_1e_4, 'red');
  assert.equal(Object.hasOwn(response.payload, 'machineStatus'), false);
});

test('applyShortTermEntries catches up every unseen short-term row in order', () => {
  const graph = createGraphObj({ maxDisplayPoints: 256 });
  const ccsA = createCCSGraph();
  const ccsB = createCCSGraph();
  const ccsC = createCCSGraph();
  const stateRef = { lastShortTermCursor: null };
  const entries = buildShortTermEntries(10);
  const { logger, logs, warns } = createLogger();

  const summary = applyShortTermEntries(entries, {
    stateRef,
    graph,
    ccsA,
    ccsB,
    ccsC,
    ccsPointAdder: addCCSPointForTest,
    logger,
  });

  assert.equal(summary.batchSize, 10);
  assert.equal(summary.appendedCount, 10);
  assert.equal(summary.skippedCount, 0);
  assert.equal(graph.fullXVals.length, 10);
  assert.deepEqual(
    graph.fullXVals,
    entries.map((entry) => Date.parse(entry.created_at) / 1000)
  );
  assert.deepEqual(
    graph.fullPressure902bVals,
    entries.map((entry) => Number.parseFloat(entry.data.pressure_902b_mbar))
  );
  assert.equal(graph.displayXVals.at(-1), Date.parse(entries.at(-1).created_at) / 1000);
  assert.deepEqual(stateRef.lastShortTermCursor, {
    timestamp: entries.at(-1).created_at,
    id: entries.at(-1).id,
  });
  assert.equal(ccsA.xVals.length, 10);
  assert.equal(ccsB.xVals.length, 10);
  assert.equal(ccsC.xVals.length, 10);
  assert.equal(warns.length, 0);
  assert.match(logs[0], /Short-term sync processed 10 rows/);
});

test('applyShortTermEntries retains aligned null gaps for independently invalid readings', () => {
  const graph = createGraphObj({ maxDisplayPoints: 256 });
  const ccsA = createCCSGraph();
  const ccsB = createCCSGraph();
  const ccsC = createCCSGraph();
  const stateRef = { lastShortTermCursor: null };
  const pressure972bValues = ['1e-6', null, 'bad', 0, -1];
  const pressure902bValues = [null, '2e-6', 'bad', 0, -1];
  const entries = buildShortTermEntries(5, {
    pressureFactory: (index) => pressure972bValues[index],
    pressure902bFactory: (index) => pressure902bValues[index],
  });
  const { logger, warns } = createLogger();

  const summary = applyShortTermEntries(entries, {
    stateRef,
    graph,
    ccsA,
    ccsB,
    ccsC,
    ccsPointAdder: addCCSPointForTest,
    logger,
  });

  assert.equal(summary.batchSize, 5);
  assert.equal(summary.appendedCount, 5);
  assert.equal(summary.skippedCount, 0);
  assert.equal(graph.fullXVals.length, 5);
  assert.deepEqual(
    graph.fullXVals,
    entries.map((entry) => Date.parse(entry.created_at) / 1000)
  );
  assert.deepEqual(graph.fullYVals, [1e-6, null, null, null, null]);
  assert.deepEqual(graph.fullPressure902bVals, [null, 2e-6, null, null, null]);
  assert.deepEqual(stateRef.lastShortTermCursor, {
    timestamp: entries.at(-1).created_at,
    id: entries.at(-1).id,
  });
  assert.equal(ccsA.xVals.length, 5);
  assert.equal(warns.length, 0);
  assertPressureGraphDisplayIntegrity(graph);
});

test('applyLongTermEntries drains missed long-term rows in order', () => {
  const graph = createGraphObj({ maxDisplayPoints: 256 });
  const stateRef = { lastLongTermCursor: null };
  const entries = buildLongTermEntries(6);
  const { logger, warns, logs } = createLogger();

  const summary = applyLongTermEntries(entries, {
    stateRef,
    graph,
    logger,
  });

  assert.equal(summary.batchSize, 6);
  assert.equal(summary.appendedCount, 6);
  assert.equal(summary.skippedCount, 0);
  assert.equal(graph.fullXVals.length, 6);
  assert.deepEqual(
    graph.fullXVals,
    entries.map((entry) => Date.parse(entry.recorded_at) / 1000)
  );
  assert.equal(graph.displayXVals.at(-1), Date.parse(entries.at(-1).recorded_at) / 1000);
  assert.deepEqual(stateRef.lastLongTermCursor, {
    timestamp: entries.at(-1).recorded_at,
    id: entries.at(-1).id,
  });
  assert.equal(warns.length, 0);
  assert.match(logs[0], /Long-term sync processed 6 rows/);
});

test('applyLongTermEntries ignores stale long-term rows that were already covered by the cursor', () => {
  const graph = createGraphObj({ maxDisplayPoints: 256 });
  const stateRef = { lastLongTermCursor: null };
  const entries = buildLongTermEntries(4);
  const { logger } = createLogger();

  applyLongTermEntries(entries.slice(0, 2), {
    stateRef,
    graph,
    logger,
  });

  const summary = applyLongTermEntries(entries, {
    stateRef,
    graph,
    logger,
  });

  assert.equal(summary.batchSize, 4);
  assert.equal(summary.appendedCount, 2);
  assert.equal(summary.skippedCount, 2);
  assert.equal(graph.fullXVals.length, 4);
  assert.deepEqual(
    graph.fullXVals,
    entries.map((entry) => Date.parse(entry.recorded_at) / 1000)
  );
  assert.deepEqual(stateRef.lastLongTermCursor, {
    timestamp: entries.at(-1).recorded_at,
    id: entries.at(-1).id,
  });
});

test('pollLongTerm skips overlapping runs instead of fetching the same batch twice', async () => {
  const entries = buildLongTermEntries(2);
  setSupabaseTableRows('long_term_logs', entries);
  setSupabaseQueryDelay('long_term_logs', 25);

  const [firstResult, secondResult] = await Promise.all([
    pollLongTerm(),
    pollLongTerm(),
  ]);

  assert.equal(getSupabaseQueryCount('long_term_logs'), 1);
  assert.equal(longTermPressureGraph.fullXVals.length, 2);
  assert.deepEqual(
    longTermPressureGraph.fullXVals,
    entries.map((entry) => Date.parse(entry.recorded_at) / 1000)
  );
  assert.equal(firstResult?.appendedCount, 2);
  assert.equal(secondResult, null);
  assert.deepEqual(state.lastLongTermCursor, {
    timestamp: entries.at(-1).recorded_at,
    id: entries.at(-1).id,
  });
});

test('fetchAndUpdateFile expires stale activity while a telemetry sync is still in progress', async () => {
  const freshEntries = buildShortTermEntries(1, {
    startMs: Date.now() - 3_000,
  });
  setSupabaseTableRows('short_term_logs', freshEntries);
  setSupabaseQueryDelay('short_term_logs', 25);

  state.experimentRunning = true;
  state.webMonitorLastModified = new Date(Date.now() - INACTIVE_THRESHOLD - 1);
  state.data.pressure = '1e-6';

  const inProgressSync = fetchAndUpdateFile();
  await fetchAndUpdateFile();

  assert.equal(state.experimentRunning, false);
  assert.equal(state.data.pressure, null);
  assert.equal(getSupabaseQueryCount('short_term_logs'), 1);

  await inProgressSync;
  assert.equal(state.experimentRunning, true);
});

test('fetchAndUpdateFile does not reactivate an update that became stale during telemetry sync', async () => {
  const freshEntries = buildShortTermEntries(1, {
    startMs: Date.now() - 3_000,
  });
  setSupabaseTableRows('short_term_logs', freshEntries);
  setSupabaseQueryDelay('short_term_logs', 25);

  const inProgressSync = fetchAndUpdateFile();
  while (getSupabaseQueryCount('short_term_logs') < 2) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }

  state.experimentRunning = true;
  state.webMonitorLastModified = new Date(Date.now() - INACTIVE_THRESHOLD - 1);
  state.data.pressure = '1e-6';

  await fetchAndUpdateFile();
  assert.equal(state.experimentRunning, false);
  assert.equal(state.data.pressure, null);

  await inProgressSync;
  assert.equal(state.experimentRunning, false);
  assert.equal(state.data.pressure, null);
});

test('fetchAndUpdateFile seeds the short-term cursor from a stale latest row without draining history', async () => {
  const staleEntries = buildShortTermEntries(5, {
    startMs: Date.now() - (25 * 60 * 60 * 1000) - (4 * 3_000),
  });
  setSupabaseTableRows('short_term_logs', staleEntries);

  state.lastShortTermCursor = await backfillShortTermGraph(shortTermPressureGraph);

  assert.equal(state.lastShortTermCursor, null);
  assert.equal(shortTermPressureGraph.fullXVals.length, 0);

  await fetchAndUpdateFile();

  assert.equal(getSupabaseQueryCount('short_term_logs'), 2);
  assert.equal(state.experimentRunning, false);
  assert.deepEqual(state.lastShortTermCursor, {
    timestamp: staleEntries.at(-1).created_at,
    id: staleEntries.at(-1).id,
  });
  assert.equal(state.webMonitorLastModified?.toISOString(), staleEntries.at(-1).created_at);
  assert.equal(shortTermPressureGraph.fullXVals.length, 0);
  assert.equal(shortTermPressureGraph.displayXVals.length, 0);
  assert.equal(ccsGraphA.xVals.length, 0);
  assert.equal(ccsGraphB.xVals.length, 0);
  assert.equal(ccsGraphC.xVals.length, 0);
  assert.equal(state.data.pressure, null);
});

test('fetchAndUpdateFile only catches up fresh rows after a stale baseline seeds the cursor', async () => {
  const staleEntries = buildShortTermEntries(5, {
    startMs: Date.now() - (25 * 60 * 60 * 1000) - (4 * 3_000),
  });
  setSupabaseTableRows('short_term_logs', staleEntries);

  state.lastShortTermCursor = await backfillShortTermGraph(shortTermPressureGraph);
  await fetchAndUpdateFile();

  assert.equal(getSupabaseQueryCount('short_term_logs'), 2);
  assert.deepEqual(state.lastShortTermCursor, {
    timestamp: staleEntries.at(-1).created_at,
    id: staleEntries.at(-1).id,
  });

  const freshEntries = buildShortTermEntries(3, {
    startMs: Date.now() - 9_000,
    idFactory: (index) => `fresh-${String(index).padStart(6, '0')}`,
  });
  setSupabaseTableRows('short_term_logs', [...staleEntries, ...freshEntries]);

  await fetchAndUpdateFile();

  assert.equal(getSupabaseQueryCount('short_term_logs'), 4);
  assert.equal(state.experimentRunning, true);
  assert.deepEqual(state.lastShortTermCursor, {
    timestamp: freshEntries.at(-1).created_at,
    id: freshEntries.at(-1).id,
  });
  assert.deepEqual(
    shortTermPressureGraph.fullXVals,
    freshEntries.map((entry) => Date.parse(entry.created_at) / 1000)
  );
  assert.deepEqual(
    shortTermPressureGraph.fullYVals,
    freshEntries.map((entry) => Number.parseFloat(entry.data.pressure))
  );
  assert.deepEqual(
    shortTermPressureGraph.fullPressure902bVals,
    freshEntries.map((entry) => Number.parseFloat(entry.data.pressure_902b_mbar))
  );
  assert.deepEqual(
    ccsGraphA.xVals,
    freshEntries.map((entry) => Math.floor(Date.parse(entry.created_at) / 1000))
  );
  assert.equal(ccsGraphB.xVals.length, freshEntries.length);
  assert.equal(ccsGraphC.xVals.length, freshEntries.length);
  assert.equal(state.data.pressure, freshEntries.at(-1).data.pressure);
  assert.equal(state.webMonitorLastModified?.toISOString(), freshEntries.at(-1).created_at);
});

test('collectRecentLogSnippet keeps the newest timestamped window newest-first', () => {
  const lines = [
    '2026-03-26 07:20:00 old event',
    '2026-03-26 07:31:00 keep earliest',
    'detail line for the 07:31 event',
    '2026-03-26 07:45:00 keep later',
    '2026-03-26 08:00:00 newest event',
  ];

  const snippet = collectRecentLogSnippet(lines, {
    recentWindowMs: RECENT_LOG_WINDOW_MS,
  });

  assert.deepEqual(snippet.lines, [
    '2026-03-26 08:00:00 newest event',
    '2026-03-26 07:45:00 keep later',
    'detail line for the 07:31 event',
    '2026-03-26 07:31:00 keep earliest',
  ]);
  assert.equal(snippet.lineCount, 4);
  assert.equal(snippet.newestTimestampMs, Date.parse('2026-03-26T08:00:00'));
});

test('collectRecentLogSnippet falls back to the last 5000 lines without timestamps', () => {
  const totalLines = FALLBACK_SNIPPET_LINES + 25;
  const lines = Array.from({ length: totalLines }, (_, index) => `line ${index}`);

  const snippet = collectRecentLogSnippet(lines);

  assert.equal(snippet.lineCount, FALLBACK_SNIPPET_LINES);
  assert.equal(snippet.lines[0], `line ${totalLines - 1}`);
  assert.equal(snippet.lines.at(-1), 'line 25');
  assert.equal(snippet.newestTimestampMs, null);
  assert.ok(snippet.lineCount <= MAX_SNIPPET_LINES);
});

test('collectRecentLogSnippet respects the byte cap for large unparseable logs', () => {
  const largePayload = 'x'.repeat(2_048);
  const lines = Array.from({ length: 2_000 }, (_, index) => `line-${index} ${largePayload}`);

  const snippet = collectRecentLogSnippet(lines);

  assert.ok(snippet.lineCount < FALLBACK_SNIPPET_LINES);
  assert.ok(snippet.lineCount <= MAX_SNIPPET_LINES);
  assert.ok(snippet.byteLength <= MAX_SNIPPET_BYTES);
});

test('listDriveTextFiles builds the expected Google Drive REST query', async () => {
  let requestedUrl = null;

  const files = await listDriveTextFiles({
    folderId: 'folder-123',
    apiKey: 'api-key-456',
    requestJsonFn: async (url) => {
      requestedUrl = url;
      return {
        files: [
          { id: 'file-1', name: 'log_latest.txt', modifiedTime: '2026-03-26T08:30:00.000Z' },
        ],
      };
    },
  });

  const url = new URL(requestedUrl);
  assert.equal(`${url.origin}${url.pathname}`, 'https://www.googleapis.com/drive/v3/files');
  assert.equal(url.searchParams.get('key'), 'api-key-456');
  assert.equal(url.searchParams.get('q'), "'folder-123' in parents and mimeType='text/plain'");
  assert.equal(url.searchParams.get('orderBy'), 'modifiedTime desc');
  assert.equal(url.searchParams.get('pageSize'), '5');
  assert.equal(url.searchParams.get('fields'), 'files(id,name,modifiedTime)');
  assert.deepEqual(files, [
    { id: 'file-1', name: 'log_latest.txt', modifiedTime: '2026-03-26T08:30:00.000Z' },
  ]);
});

test('getMostRecentFile selects the newest log-prefixed text file', async () => {
  const result = await getMostRecentFile({
    logger: { log: () => {}, error: () => {} },
    listDriveTextFilesFn: async () => [
      { id: 'file-a', name: 'notes.txt', modifiedTime: '2026-03-26T08:31:00.000Z' },
      { id: 'file-b', name: 'log_recent.txt', modifiedTime: '2026-03-26T08:30:00.000Z' },
      { id: 'file-c', name: 'log_older.txt', modifiedTime: '2026-03-26T08:00:00.000Z' },
    ],
  });

  assert.deepEqual(result, {
    displayFile: {
      id: 'file-b',
      name: 'log_recent.txt',
      modifiedTime: '2026-03-26T08:30:00.000Z',
    },
  });
});

test('getMostRecentFile returns null when the Drive list request fails', async () => {
  const result = await getMostRecentFile({
    logger: { log: () => {}, error: () => {} },
    listDriveTextFilesFn: async () => {
      throw new Error('network unavailable');
    },
  });

  assert.deepEqual(result, { displayFile: null });
});

test('fetchDisplayFileContents skips downloading an unchanged Drive file', async () => {
  const { logger, logs } = createLogger();
  state.displayLogFileId = 'file-1';
  state.displayLogLastModified = '2026-03-26T08:00:00.000Z';
  let fetchCallCount = 0;
  let writeCallCount = 0;

  const result = await fetchDisplayFileContents({
    logger,
    stateRef: state,
    getMostRecentFileFn: async () => ({
      displayFile: {
        id: 'file-1',
        modifiedTime: '2026-03-26T08:00:00.000Z',
      },
    }),
    fetchRecentLogSnippetFn: async () => {
      fetchCallCount++;
      return { lines: ['newest line'] };
    },
    writeToFileFn: async () => {
      writeCallCount++;
      return true;
    },
  });

  assert.equal(result, true);
  assert.equal(fetchCallCount, 0);
  assert.equal(writeCallCount, 0);
  assert.ok(logs.some((line) => line.includes('Display log unchanged')));
});

test('fetchDisplayFileContents writes a recent snippet and stores the file metadata', async () => {
  const { logger } = createLogger();
  const stateRef = {
    displayLogFileId: null,
    displayLogLastModified: null,
  };
  let writtenLines = null;

  const result = await fetchDisplayFileContents({
    logger,
    stateRef,
    getMostRecentFileFn: async () => ({
      displayFile: {
        id: 'file-2',
        modifiedTime: '2026-03-26T08:30:00.000Z',
      },
    }),
    fetchRecentLogSnippetFn: async () => ({
      lines: ['newest event', 'older event'],
    }),
    writeToFileFn: async (lines) => {
      writtenLines = [...lines];
      return true;
    },
  });

  assert.equal(result, true);
  assert.deepEqual(writtenLines, ['newest event', 'older event']);
  assert.equal(stateRef.displayLogFileId, 'file-2');
  assert.equal(stateRef.displayLogLastModified, '2026-03-26T08:30:00.000Z');
});

test('fetchShortTermEntriesSince paginates tied timestamps deterministically across pages', async () => {
  const entries = buildShortTermEntries(1_005);
  const boundaryTimestamp = entries[998].created_at;

  for (const index of [999, 1000, 1001, 1002]) {
    entries[index].created_at = boundaryTimestamp;
  }

  setSupabaseTableRows('short_term_logs', entries);

  const fetched = await fetchShortTermEntriesSince(null);

  assert.equal(fetched.length, entries.length);
  assert.equal(new Set(fetched.map((entry) => entry.id)).size, entries.length);
  assert.deepEqual(
    fetched.map((entry) => entry.id),
    entries.map((entry) => entry.id)
  );
});

test('fetchShortTermEntriesSince resumes within a tied timestamp using the id cursor', async () => {
  const entries = buildShortTermEntries(1_005);
  const boundaryTimestamp = entries[998].created_at;

  for (const index of [999, 1000, 1001, 1002]) {
    entries[index].created_at = boundaryTimestamp;
  }

  setSupabaseTableRows('short_term_logs', entries);

  const fetched = await fetchShortTermEntriesSince({
    timestamp: boundaryTimestamp,
    id: entries[998].id,
  });

  assert.deepEqual(
    fetched.map((entry) => entry.id),
    entries.slice(999).map((entry) => entry.id)
  );
});

test('fetchLongTermEntriesSince paginates tied timestamps deterministically across pages', async () => {
  const entries = buildLongTermEntries(1_005);
  const boundaryTimestamp = entries[998].recorded_at;

  for (const index of [999, 1000, 1001, 1002]) {
    entries[index].recorded_at = boundaryTimestamp;
  }

  setSupabaseTableRows('long_term_logs', entries);

  const fetched = await fetchLongTermEntriesSince(null);

  assert.equal(fetched.length, entries.length);
  assert.equal(new Set(fetched.map((entry) => entry.id)).size, entries.length);
  assert.deepEqual(
    fetched.map((entry) => entry.id),
    entries.map((entry) => entry.id)
  );
});

test('fetchLongTermEntriesSince resumes within a tied timestamp using the id cursor', async () => {
  const entries = buildLongTermEntries(1_005);
  const boundaryTimestamp = entries[998].recorded_at;

  for (const index of [999, 1000, 1001, 1002]) {
    entries[index].recorded_at = boundaryTimestamp;
  }

  setSupabaseTableRows('long_term_logs', entries);

  const fetched = await fetchLongTermEntriesSince({
    timestamp: boundaryTimestamp,
    id: entries[998].id,
  });

  assert.deepEqual(
    fetched.map((entry) => entry.id),
    entries.slice(999).map((entry) => entry.id)
  );
});

test('backfillShortTermGraph aligns fractional 972B and 902B values including null gaps', async () => {
  const graph = createGraphObj({
    maxDataPoints: 30_000,
    maxTimeWindowSeconds: 24 * 60 * 60,
    maxDisplayPoints: 1024,
  });
  const entries = buildShortTermEntries(3, {
    startMs: Date.now() - 10_000 + 123,
    pressureFactory: (index) => [null, '1.5e-6', 'bad'][index],
    pressure902bFactory: (index) => ['2.5e-6', null, 'bad'][index],
  });
  setSupabaseTableRows('short_term_logs', entries);

  const lastCursor = await backfillShortTermGraph(graph);

  assert.deepEqual(lastCursor, {
    timestamp: entries.at(-1).created_at,
    id: entries.at(-1).id,
  });
  assert.deepEqual(
    graph.fullXVals,
    entries.map((entry) => Date.parse(entry.created_at) / 1000)
  );
  assert.ok(graph.fullXVals.some((timestamp) => !Number.isInteger(timestamp)));
  assert.deepEqual(graph.fullYVals, [null, 1.5e-6, null]);
  assert.deepEqual(graph.fullPressure902bVals, [2.5e-6, null, null]);
  assertPressureGraphDisplayIntegrity(graph);
});

test('backfillLongTermGraph retains the newest points within the configured cap', async () => {
  const graph = createGraphObj({
    maxDataPoints: 5,
    maxDisplayPoints: 4,
    sourceResolutionLabel: '1-min averaged source data',
  });
  const entries = buildLongTermEntries(8);
  setSupabaseTableRows('long_term_logs', entries);

  const lastCursor = await backfillLongTermGraph(graph);

  assert.deepEqual(lastCursor, {
    timestamp: entries.at(-1).recorded_at,
    id: entries.at(-1).id,
  });
  assert.equal(graph.fullXVals.length, 5);
  assert.deepEqual(
    graph.fullXVals,
    entries.slice(-5).map((entry) => Date.parse(entry.recorded_at) / 1000)
  );
  assert.equal(graph.displayXVals.at(-1), Date.parse(entries.at(-1).recorded_at) / 1000);
});

test('24-hour short-term data keeps a denser live display than the old 256-point cap', () => {
  const graph = createGraphObj({
    maxDataPoints: 30_000,
    maxDisplayPoints: 1024,
    sourceResolutionLabel: '~3s source data',
  });
  const ccsA = createCCSGraph();
  const ccsB = createCCSGraph();
  const ccsC = createCCSGraph();
  const stateRef = { lastShortTermCursor: null };
  const entries = buildShortTermEntries(28_800);
  const { logger } = createLogger();

  applyShortTermEntries(entries, {
    stateRef,
    graph,
    ccsA,
    ccsB,
    ccsC,
    ccsPointAdder: addCCSPointForTest,
    logger,
  });

  assert.equal(graph.lastUsedFactor, 32);
  assert.ok(graph.displayXVals.length > 850, `expected a denser live display, got ${graph.displayXVals.length}`);
  assert.ok(graph.displayXVals.length <= 1024);
});

test('applyShortTermEntries caps raw points at maxDataPoints and keeps the newest rows', () => {
  const graph = createGraphObj({
    maxDataPoints: 5,
    maxDisplayPoints: 4,
    sourceResolutionLabel: '~3s source data',
  });
  const ccsA = createCCSGraph();
  const ccsB = createCCSGraph();
  const ccsC = createCCSGraph();
  const stateRef = { lastShortTermCursor: null };
  const entries = buildShortTermEntries(8);
  const { logger } = createLogger();

  applyShortTermEntries(entries, {
    stateRef,
    graph,
    ccsA,
    ccsB,
    ccsC,
    ccsPointAdder: addCCSPointForTest,
    logger,
  });

  assert.equal(graph.fullXVals.length, 5);
  assert.deepEqual(
    graph.fullXVals,
    entries.slice(-5).map((entry) => Date.parse(entry.created_at) / 1000)
  );
  assert.equal(graph.displayXVals.at(-1), Date.parse(entries.at(-1).created_at) / 1000);
  assertPressureGraphDisplayIntegrity(graph);
});

test('appendPressurePoint trims raw points outside the configured time window', () => {
  const graph = createGraphObj({
    maxDataPoints: 100,
    maxTimeWindowSeconds: 10,
    maxDisplayPoints: 4,
    sourceResolutionLabel: '~3s source data',
  });

  [0, 5, 10, 15, 20].forEach((tSec, index) => {
    appendPressurePoint(graph, tSec, index, index + 10);
  });

  assert.deepEqual(graph.fullXVals, [10, 15, 20]);
  assert.deepEqual(graph.fullYVals, [2, 3, 4]);
  assert.deepEqual(graph.fullPressure902bVals, [12, 13, 14]);
  assert.equal(graph.nextPointIndex, 5);
  assertPressureGraphDisplayIntegrity(graph);
});

test('appendPressurePoint preserves graph array references and display invariants after repeated cap trims', () => {
  const graph = createGraphObj({
    maxDataPoints: 5,
    maxDisplayPoints: 4,
    sourceResolutionLabel: '~3s source data',
  });
  const fullXRef = graph.fullXVals;
  const fullYRef = graph.fullYVals;
  const full902bRef = graph.fullPressure902bVals;

  for (let index = 0; index < 12; index++) {
    appendPressurePoint(graph, 1_000 + index, index, index + 100);

    assert.strictEqual(graph.fullXVals, fullXRef);
    assert.strictEqual(graph.fullYVals, fullYRef);
    assert.strictEqual(graph.fullPressure902bVals, full902bRef);
    assert.ok(graph.fullXVals.length <= graph.maxDataPoints);
    assertPressureGraphDisplayIntegrity(graph);
  }

  assert.deepEqual(graph.fullXVals, [1007, 1008, 1009, 1010, 1011]);
  assert.deepEqual(graph.fullYVals, [7, 8, 9, 10, 11]);
  assert.deepEqual(graph.fullPressure902bVals, [107, 108, 109, 110, 111]);
  assert.equal(graph.nextPointIndex, 12);
});

test('clearPressureGraph clears both aligned pressure series', () => {
  const graph = createGraphObj();
  appendPressurePoint(graph, 1, 1e-6, 2e-6);

  clearPressureGraph(graph);

  assert.deepEqual(graph.fullXVals, []);
  assert.deepEqual(graph.fullYVals, []);
  assert.deepEqual(graph.fullPressure902bVals, []);
  assert.deepEqual(graph.displayXVals, []);
  assert.deepEqual(graph.displayYVals, []);
  assert.deepEqual(graph.displayPressure902bVals, []);
  assert.equal(graph.nextPointIndex, 0);
});

test('long-term data remains capped at the lower historical display density', () => {
  const graph = createGraphObj({
    maxDataPoints: 100_000,
    maxDisplayPoints: 256,
    sourceResolutionLabel: '1-min averaged source data',
  });
  const stateRef = { lastLongTermCursor: null };
  const entries = buildLongTermEntries(1_440);
  const { logger } = createLogger();

  applyLongTermEntries(entries, {
    stateRef,
    graph,
    logger,
  });

  assert.equal(graph.lastUsedFactor, 8);
  assert.ok(graph.displayXVals.length >= 180 && graph.displayXVals.length <= 181);
  assert.ok(graph.displayXVals.length <= 256);
});

test('applyLongTermEntries caps raw points at maxDataPoints and keeps the newest rows', () => {
  const graph = createGraphObj({
    maxDataPoints: 5,
    maxDisplayPoints: 4,
    sourceResolutionLabel: '1-min averaged source data',
  });
  const stateRef = { lastLongTermCursor: null };
  const entries = buildLongTermEntries(8);
  const { logger } = createLogger();

  applyLongTermEntries(entries, {
    stateRef,
    graph,
    logger,
  });

  assert.equal(graph.fullXVals.length, 5);
  assert.deepEqual(
    graph.fullXVals,
    entries.slice(-5).map((entry) => Date.parse(entry.recorded_at) / 1000)
  );
  assert.equal(graph.displayXVals.at(-1), Date.parse(entries.at(-1).recorded_at) / 1000);
  assertPressureGraphDisplayIntegrity(graph);
});

test('chart-data returns density metadata for both short and long views', () => {
  const { logger } = createLogger();
  const shortEntries = buildShortTermEntries(8);
  const longEntries = buildLongTermEntries(6);
  applyShortTermEntries(shortEntries, { logger });
  applyLongTermEntries(longEntries, { logger });

  const app = createFakeApp();
  registerRoutes(app);

  const chartRoute = app.routes.find((route) => route.method === 'GET' && route.path === '/chart-data');
  assert.ok(chartRoute, 'expected /chart-data route to be registered');

  const response = createResponseRecorder();
  chartRoute.handler({ query: { view: 'short' } }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.view, 'short');
  assert.equal(
    response.payload.xVals.at(-1),
    Date.parse(shortEntries.at(-1).created_at) / 1000
  );
  assert.equal(
    response.payload.pressure972bVals.at(-1),
    Number.parseFloat(shortEntries.at(-1).data.pressure)
  );
  assert.equal(
    response.payload.pressure902bVals.at(-1),
    Number.parseFloat(shortEntries.at(-1).data.pressure_902b_mbar)
  );
  assert.equal(response.payload.rawPointCount, shortTermPressureGraph.fullXVals.length);
  assert.equal(response.payload.displayPointCount, shortTermPressureGraph.displayXVals.length);
  assert.equal(response.payload.downsampleFactor, shortTermPressureGraph.lastUsedFactor);
  assert.equal(response.payload.sourceResolutionLabel, shortTermPressureGraph.sourceResolutionLabel);
  assert.deepEqual(response.payload.xVals, shortTermPressureGraph.displayXVals);
  assert.deepEqual(response.payload.pressure972bVals, shortTermPressureGraph.displayYVals);
  assert.deepEqual(
    response.payload.pressure902bVals,
    shortTermPressureGraph.displayPressure902bVals
  );
  assert.equal('yVals' in response.payload, false);

  const snapshotResponse = createResponseRecorder();
  chartRoute.handler({ query: { view: 'short', raw: '1' } }, snapshotResponse);
  assert.equal(snapshotResponse.payload.resetRequired, false);
  assert.deepEqual(snapshotResponse.payload.xVals, shortTermPressureGraph.fullXVals);
  assert.deepEqual(snapshotResponse.payload.pressure972bVals, shortTermPressureGraph.fullYVals);
  assert.deepEqual(
    snapshotResponse.payload.pressure902bVals,
    shortTermPressureGraph.fullPressure902bVals
  );

  const lastTimestamp = shortTermPressureGraph.fullXVals.at(-1);
  const snapshotCursor = snapshotResponse.payload.cursor;
  appendPressurePoint(shortTermPressureGraph, lastTimestamp, 42, 84);

  const deltaResponse = createResponseRecorder();
  chartRoute.handler({
    query: {
      view: 'short',
      raw: '1',
      cursor: String(snapshotCursor),
    },
  }, deltaResponse);
  assert.equal(deltaResponse.payload.resetRequired, false);
  assert.deepEqual(deltaResponse.payload.xVals, [lastTimestamp]);
  assert.deepEqual(deltaResponse.payload.pressure972bVals, [42]);
  assert.deepEqual(deltaResponse.payload.pressure902bVals, [84]);

  const longResponse = createResponseRecorder();
  chartRoute.handler({ query: { view: 'long' } }, longResponse);

  assert.equal(longResponse.statusCode, 200);
  assert.equal(longResponse.payload.view, 'long');
  assert.equal(longResponse.payload.rawPointCount, longTermPressureGraph.fullXVals.length);
  assert.equal(longResponse.payload.displayPointCount, longTermPressureGraph.displayXVals.length);
  assert.equal(longResponse.payload.downsampleFactor, longTermPressureGraph.lastUsedFactor);
  assert.equal(longResponse.payload.sourceResolutionLabel, longTermPressureGraph.sourceResolutionLabel);
  assert.deepEqual(longResponse.payload.xVals, longTermPressureGraph.displayXVals);
  assert.deepEqual(longResponse.payload.pressure972bVals, longTermPressureGraph.displayYVals);
  assert.equal('pressure902bVals' in longResponse.payload, false);
  assert.equal('yVals' in longResponse.payload, false);
});

test('/data exposes the latest 902B pressure', () => {
  state.data.pressure_902b_mbar = 5.678e-7;
  const app = createFakeApp();
  registerRoutes(app);

  const dataRoute = app.routes.find((route) => route.method === 'GET' && route.path === '/data');
  const response = createResponseRecorder();
  dataRoute.handler({}, response);

  assert.equal(response.payload.pressure_902b_mbar, 5.678e-7);
});

test('dashboard HTML uses the recent-log viewer, pressure readings, and source-precision CCS temperatures', async () => {
  state.experimentRunning = true;
  state.data.pressure = 1.234e-6;
  state.data.pressure_902b_mbar = 5.678e-7;
  const app = createFakeApp();
  registerRoutes(app);

  state.experimentRunning = true;
  state.data.clamp_temperature_A = 123.456;
  state.data.clamp_temperature_B = '234.567';
  state.data.clamp_temperature_C = 345;

  const dashboardRoute = app.routes.find((route) => route.method === 'GET' && route.path === '/');
  assert.ok(dashboardRoute, 'expected / route to be registered');

  const response = createResponseRecorder();
  await dashboardRoute.handler({}, response);

  assert.equal(response.statusCode, 200);
  assert.match(response.payload, /Recent Log \(last 30 min\)/);
  assert.match(response.payload, /id="pressure972b">972B: 1\.23e-6 mbar<\/span>\s*<span id="pressure902b" style="color:#818cf8;">902B: 5\.68e-7 mbar/);
  assert.match(response.payload, /class="vacuum-indicators-header"/);
  assert.match(response.payload, /id="pressureReadings" class="vacuum-pressure-readings"/);
  assert.match(
    response.payload,
    /@media \(max-width: 992px\)[\s\S]*?\.vacuum-indicators-header \{\s*grid-template-columns: 1fr;[\s\S]*?border-bottom: none;[\s\S]*?\.vacuum-indicators-heading \{[\s\S]*?border-bottom: 1px solid var\(--border-subtle\);[\s\S]*?\.vacuum-pressure-readings \{\s*justify-self: center;/
  );
  assert.match(
    response.payload,
    /@media \(max-width: 600px\)[\s\S]*?\.vacuum-pressure-readings \{\s*flex-direction: column;/
  );
  assert.match(response.payload, /title: 'Cathode C — Clamp Temperature',[\s\S]*?stroke: '#fca5a5'/);
  assert.match(response.payload, /function setCCSChartTimeWindow\(chart, nowSec = ccsViewportNow\)/);
  assert.match(response.payload, /chart\.setScale\('x', \{ min, max \}\)/);
  assert.match(response.payload, /chartEl\.ondblclick = \(\) => \{\s*setCCSChartTimeWindow\(uplot\);/);
  assert.match(response.payload, /finally \{\s*updateCCSChartTimeWindows\(ccsViewportNow\);/);
  assert.doesNotMatch(response.payload, /972B:[^<]*\|[^<]*902B:/);
  assert.match(response.payload, /return '-- mbar';/);
  assert.match(
    response.payload,
    /Number\.isFinite\(numericValue\) && numericValue > 0\s*\? numericValue\.toExponential\(2\) \+ ' mbar'/
  );
  assert.match(response.payload, /'972B: ' \+ formatPressureValue\(data\.pressure, experimentRunning\)/);
  assert.match(response.payload, /formatPressureValue\(data\.pressure_902b_mbar, experimentRunning\)/);
  assert.match(response.payload, /Show Recent Log/);
  assert.match(response.payload, /class="log-viewer-header"/);
  assert.match(response.payload, /class="btn-toggle log-toggle-button"/);
  assert.match(response.payload, /class="btn-toggle pressure-toggle-button"/);
  assert.match(response.payload, /Clamp Temperature: 123\.5 C/);
  assert.match(response.payload, /Clamp Temperature: 234\.6 C/);
  assert.match(response.payload, /Clamp Temperature: 345\.0 C/);
  assert.match(
    response.payload,
    /Number\(data\.clamp_temperature_A\)\.toFixed\(1\) \+ "°C"/
  );
  assert.match(
    response.payload,
    /Number\(v\)\.toFixed\(1\) \+ " °C"/
  );
  assert.match(
    response.payload,
    /v\.toFixed\(1\) : ""/
  );
  assert.doesNotMatch(response.payload, /Math\.round\(Number\(data\.clamp_temperature/);
  assert.match(response.payload, /chartEl\.getBoundingClientRect\(\)\.width/);
  assert.match(response.payload, /distr:\s*3,\s*log:\s*10,/);
  assert.match(response.payload, /getPaddedPressureLogRange\(uPlot\.rangeLog, dataMin, dataMax\)/);
  assert.match(response.payload, /Pressure \(mbar, log10\)/);
  assert.match(
    response.payload,
    /Number\.isFinite\(v\) \? v\.toExponential\(2\) : ''/
  );
  assert.match(response.payload, /label: '972B pressure \(mbar\)'[\s\S]*?return v\.toExponential\(2\);[\s\S]*?stroke: '#38bdf8'/);
  assert.match(response.payload, /label: '902B pressure \(mbar\)'[\s\S]*?return v\.toExponential\(2\);[\s\S]*?stroke: '#818cf8'/);
  assert.doesNotMatch(response.payload, /dash:/);
  assert.match(
    response.payload,
    /normalizePressureSeriesForLogScale\(sample\.pressure972bVals\)/
  );
  assert.match(
    response.payload,
    /normalizePressureSeriesForLogScale\(sample\.pressure902bVals\)/
  );
  assert.match(response.payload, /chartData\.pressure972bVals/);
  assert.match(response.payload, /chartData\.pressure902bVals/);
  assert.match(response.payload, /requestAnimationFrame/);
  assert.match(response.payload, /&raw=1&cursor=/);
  assert.match(response.payload, /nextCacheStartIndex - pressureRawIndexOffset/);
  assert.match(response.payload, /if \(pressureRawRefreshInFlight\) return null;/);
  assert.match(response.payload, /const REQUEST_TIMEOUT_MS = 10000;/);
  assert.match(response.payload, /const PRESSURE_SNAPSHOT_TIMEOUT_MS = 30000;/);
  assert.match(response.payload, /fetchJsonWithTimeout\(url\)/);
  assert.match(response.payload, /const requestedView = currentPressureView;/);
  assert.match(response.payload, /const requestedCursor = pressureRawCursor;/);
  assert.match(
    response.payload,
    /requestedView !== currentPressureView \|\| requestedCursor !== pressureRawCursor/
  );
  assert.match(response.payload, /finally \{\s*pressureRawRefreshInFlight = false;/);
  assert.match(response.payload, /const generation = \+\+pressureSnapshotGeneration;/);
  assert.match(
    response.payload,
    /generation !== pressureSnapshotGeneration \|\|\s*view !== currentPressureView \|\|\s*chartData\.view !== view/
  );
  assert.match(response.payload, /replacePressureRawData\(chartData\);\s*return view;/);
  assert.match(response.payload, /appendPressureRawData\(chartData\);\s*return requestedView;/);
  assert.match(response.payload, /const refreshedView = await refreshPressureRawData\(\);/);
  assert.match(
    response.payload,
    /if \(refreshedView === 'long'\) lastLongTermPollAt = Date\.now\(\);/
  );
  assert.doesNotMatch(
    response.payload,
    /if \(currentPressureView === 'long'\) lastLongTermPollAt = Date\.now\(\);/
  );
  assert.match(response.payload, /async function pollDashboard\(\)/);
  assert.match(response.payload, /fetchJsonWithTimeout\('\/data'\)/);
  assert.match(response.payload, /fetchJsonWithTimeout\('\/ccs-chart-data'\)/);
  assert.match(response.payload, /setTimeout\(pollDashboard, 3000\)/);
  assert.doesNotMatch(response.payload, /setInterval\(async/);
  assert.match(response.payload, /id="pressure-time-range"/);
  assert.match(response.payload, /<option value="1">Last 1h<\/option>/);
  assert.match(response.payload, /<option value="24" selected>Last 24h<\/option>/);
  assert.match(response.payload, /id="pressure-zoom-mode"[^>]*aria-pressed="true"/);
  assert.match(response.payload, /id="pressure-pan-mode"[^>]*aria-pressed="false"/);
  assert.match(response.payload, /id="pressure-reset-view"/);
  assert.match(response.payload, /createPressureInteractionPlugin\(\{/);
  assert.match(response.payload, /clampPressureViewportRange\(/);
  assert.match(response.payload, /#chart-root-3 \.u-select \{\s*display: none;/);
  assert.match(response.payload, /#chart-root-3\.is-zoom-selecting \.u-select \{\s*display: block;/);
  assert.match(response.payload, /uplotRef\.setSelect\(\{ left, top: 0, width, height: rect\.height \}, false\)/);
  assert.match(response.payload, /uplotRef\.posToVal\(left, 'x'\)/);
  assert.match(response.payload, /focus:\s*\{\s*prox:\s*-1\s*\}/);
  assert.match(response.payload, /points:\s*\{\s*size:\s*8,/);
  assert.match(response.payload, /filter:\s*filterPressureLogGridSplits/);
  assert.match(
    response.payload,
    /pressureChart\.setData\(\s*\[sample\.xVals, normalizedPressure972bVals, normalizedPressure902bVals\]/
  );
  assert.match(response.payload, /pressureChart\.setSeries\(2, \{ show: false \}\)/);
  assert.match(response.payload, /pressureViewportNow = Number\.isFinite\(serverNowMs\)/);
  assert.match(
    response.payload,
    /getPressureTimeWindowBounds\(\s*pressureRawDataX,\s*selectedLiveHours,\s*pressureViewportNow/
  );
  assert.match(response.payload, /pressureViewportKind = 'custom'/);
  assert.match(response.payload, /pressureChart\.setScale\('y', \{ min: null, max: null \}\)/);
  assert.match(response.payload, /overflow:\s*hidden;/);
  assert.match(response.payload, /fetch\('\/raw'\)/);
  assert.doesNotMatch(response.payload, /fetch\('\/refresh-display'\)/);
  assert.doesNotMatch(response.payload, /margin-top:\s*-3\.5em/);
  assert.doesNotMatch(response.payload, /float:\s*right/);

  const inlineScripts = Array.from(
    response.payload.matchAll(/<script>([\s\S]*?)<\/script>/g),
    (match) => match[1]
  );
  assert.ok(inlineScripts.length > 0);
  inlineScripts.forEach((source) => assert.doesNotThrow(() => new Function(source)));
});

test('fetchJsonWithTimeout returns parsed data and passes an abort signal', async () => {
  let requestSignal;
  const chartData = await fetchJsonWithTimeout('/chart-data', 5, async (_url, options) => {
    requestSignal = options.signal;
    return { ok: true, json: async () => ({ cursor: 12 }) };
  });

  assert.deepEqual(chartData, { cursor: 12 });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(requestSignal.aborted, false);
});

test('fetchJsonWithTimeout aborts a hung request and reports a timeout', async () => {
  let requestSignal;
  const hungFetch = (_url, options) => new Promise((_resolve, reject) => {
    requestSignal = options.signal;
    requestSignal.addEventListener('abort', () => {
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    }, { once: true });
  });

  await assert.rejects(
    fetchJsonWithTimeout('/chart-data', 5, hungFetch),
    /Request timed out/
  );
  assert.equal(requestSignal.aborted, true);
});

test('fetchJsonWithTimeout preserves HTTP failures', async () => {
  await assert.rejects(
    fetchJsonWithTimeout('/chart-data', 50, async () => ({ ok: false, status: 503 })),
    /Request failed: 503/
  );
});

test('dashboard HTML renders the live Experiment Progress chevron card above Interlocks', async () => {
  state.experimentRunning = true;
  state.data.machine_status_temps = 'green';
  state.data.machine_status_pressure_1e_4 = 'red';

  const app = createFakeApp();
  registerRoutes(app);
  const dashboardRoute = app.routes.find((route) => route.method === 'GET' && route.path === '/');
  const response = createResponseRecorder();

  await dashboardRoute.handler({}, response);

  const progressIndex = response.payload.indexOf('Experiment Progress');
  const interlocksIndex = response.payload.indexOf('<!-- Interlocks Section -->');
  assert.ok(progressIndex >= 0);
  assert.ok(progressIndex < interlocksIndex);
  assert.equal(
    (
      response.payload.match(
        /data-machine-status-key="machine_status_[^"]+"\s+data-machine-status-label=/g
      ) || []
    ).length,
    10
  );
  assert.match(
    response.payload,
    /machine-status-green"[\s\S]*data-machine-status-key="machine_status_temps"/
  );
  assert.match(response.payload, />PMON<\/span>[\s\S]*>Temperatures OK<\/span>/);
  assert.match(response.payload, />HVolt Power<\/span>[\s\S]*>Supplies Nominal<\/span>/);
  assert.doesNotMatch(response.payload, />HV Power<\/span>/);
  assert.match(
    response.payload,
    /machine-status-red"[\s\S]*data-machine-status-key="machine_status_pressure_1e_4"/
  );
  assert.match(
    response.payload,
    /class="experiment-progress-chevron"[\s\S]*<polygon points=/
  );
  assert.match(
    response.payload,
    /\.experiment-progress-milestone-shell\s*\{[^}]*flex:\s*0 0 var\(--progress-chevron-width,\s*100px\);[^}]*min-width:\s*100px;[^}]*min-height:\s*38px;/
  );
  assert.match(
    response.payload,
    /\.experiment-progress-track\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*width:\s*100%;[^}]*row-gap:\s*8px;/
  );
  assert.match(response.payload, /const minimumProgressChevronWidth = 100;/);
  assert.match(response.payload, /const progressChevronOverlap = 8;/);
  assert.match(
    response.payload,
    /function getMinimumExperimentProgressRowWidth\(chevronCount\) \{[\s\S]*return chevronCount \* minimumProgressChevronWidth;[\s\S]*\}/
  );
  assert.doesNotMatch(
    response.payload,
    /function getMinimumExperimentProgressRowWidth\(chevronCount\) \{[^}]*progressChevronOverlap/
  );
  assert.match(response.payload, /availableWidth > getMinimumExperimentProgressRowWidth\(10\)/);
  assert.match(response.payload, /availableWidth > getMinimumExperimentProgressRowWidth\(5\)/);
  assert.match(response.payload, /availableWidth > getMinimumExperimentProgressRowWidth\(4\)/);
  assert.match(response.payload, /availableWidth > getMinimumExperimentProgressRowWidth\(3\)/);
  assert.match(response.payload, /availableWidth > getMinimumExperimentProgressRowWidth\(2\)/);
  assert.match(response.payload, /return \[1, 1, 1, 1, 1, 1, 1, 1, 1, 1\];/);
  assert.match(response.payload, /\.experiment-progress-row\s*\{[^}]*justify-content:\s*center;/);
  assert.match(response.payload, /new ResizeObserver\(layoutExperimentProgress\)/);
  assert.match(
    response.payload,
    /milestone === progressMilestones\[0\][\s\S]*\? firstChevronPoints[\s\S]*: joinedChevronPoints/
  );
  assert.match(
    response.payload,
    /\.experiment-progress-milestone\s*\{[^}]*font-weight:\s*500;/
  );
  assert.match(response.payload, /\.dashboard-title\s*\{[^}]*font-weight:\s*700;/);
  assert.match(
    response.payload,
    /\.experiment-progress-chevron polygon\s*\{[\s\S]*fill:\s*var\(--milestone-fill\);[\s\S]*stroke:\s*var\(--milestone-border\);[\s\S]*stroke-width:\s*2px;/
  );
  assert.match(response.payload, /\.machine-status-gray\s*\{[\s\S]*--milestone-fill:\s*rgba\(148,\s*163,\s*184,\s*0\.08\);/);
  assert.match(response.payload, /\.machine-status-green\s*\{[\s\S]*--milestone-border:\s*var\(--success\);[\s\S]*--milestone-fill:\s*rgba\(34,\s*197,\s*94,\s*0\.15\);[\s\S]*color:\s*white;/);
  assert.match(response.payload, /\.machine-status-red\s*\{[\s\S]*--milestone-border:\s*var\(--danger\);[\s\S]*--milestone-fill:\s*rgba\(239,\s*68,\s*68,\s*0\.15\);[\s\S]*color:\s*white;/);
  assert.match(
    response.payload,
    /\.experiment-progress-chevron polygon\s*\{[\s\S]*filter:\s*drop-shadow\(0 0 6px var\(--milestone-glow\)\);/
  );
  assert.match(response.payload, /text-shadow:\s*0 0 3px var\(--milestone-text-glow\);/);
  assert.match(response.payload, /\.machine-status-green\s*\{[\s\S]*--milestone-text-glow:\s*rgba\(34,\s*197,\s*94,\s*0\.35\);/);
  assert.match(response.payload, /\.machine-status-red\s*\{[\s\S]*--milestone-text-glow:\s*rgba\(239,\s*68,\s*68,\s*0\.35\);/);
  assert.doesNotMatch(response.payload, /\.experiment-progress-milestone-shell\s*\{[^}]*filter:/);
  assert.match(response.payload, /const experimentRunning = data\.experimentRunning === true;/);
  assert.doesNotMatch(response.payload, /const THRESHOLD = 2 \* 60 \* 1000;/);
  assert.doesNotMatch(response.payload, /now - dateObject1/);
  assert.match(response.payload, /statusDiv\.classList\.toggle\('neon-success', experimentRunning\)/);
  assert.match(response.payload, /updateExperimentProgress\(data, experimentRunning\)/);
  assert.match(response.payload, /experimentRunning \? data\.sicColors\[i\] : 'grey'/);
  assert.match(response.payload, /experimentRunning \? data\.vacuumColors\[i\] : 'grey'/);
  assert.match(response.payload, /data\.heaterCurrent_A[\s\S]*&& experimentRunning\s*\?/);
  assert.match(
    response.payload,
    /updatePowerSupplyOutput\('powerSupplyOutputPos1', data\.pos_1kv_output, experimentRunning\)/
  );
});

test('normalizePressureSeriesForLogScale keeps positive finite pressures and gaps invalid values', () => {
  const pressures = [1200, 1, 1e-3, 1e-6, 0, -1, null, Number.NaN, Infinity, -Infinity];

  assert.deepEqual(
    normalizePressureSeriesForLogScale(pressures),
    [1200, 1, 1e-3, 1e-6, null, null, null, null, null, null]
  );
  assert.deepEqual(normalizePressureSeriesForLogScale(null), []);
});

test('getPaddedPressureLogRange leaves at least half a decade below positive data', () => {
  const calls = [];
  const rangeLog = (dataMin, dataMax, base, fullMags) => {
    calls.push([dataMin, dataMax, base, fullMags]);
    return [dataMin, dataMax];
  };

  for (const [dataMin, dataMax] of [
    [1200, 1200],
    [1, 1],
    [1e-3, 1e-3],
    [1e-6, 1e-6],
    [1e-6, 1200],
  ]) {
    const [rangeMin, rangeMax] = getPaddedPressureLogRange(rangeLog, dataMin, dataMax);
    assert.ok(rangeMin <= dataMin / Math.sqrt(10));
    assert.equal(rangeMax, dataMax);
  }

  assert.deepEqual(calls, [
    [1200, 1200, 10, false],
    [1, 1, 10, false],
    [1e-3, 1e-3, 10, false],
    [1e-6, 1e-6, 10, false],
    [1e-6, 1200, 10, false],
  ]);
  assert.deepEqual(getPaddedPressureLogRange(rangeLog, null, null), [null, null]);
  assert.deepEqual(getPaddedPressureLogRange(rangeLog, undefined, undefined), [undefined, undefined]);
  assert.deepEqual(getPaddedPressureLogRange(rangeLog, 0, 1), [0, 1]);
  assert.deepEqual(getPaddedPressureLogRange(rangeLog, -1, 1), [-1, 1]);
});

test('filterPressureLogGridSplits keeps at most ten exact preferred-mantissa grid lines', () => {
  const splits = [
    1e-6, 2e-6, 3e-6, 4e-6, 5e-6, 6e-6, 7e-6, 8e-6, 9e-6,
    1e-3, 2e-3, 3e-3, 4e-3, 5e-3, 6e-3, 7e-3, 8e-3, 9e-3,
    1, 2, 3, 4, 5, 6, 7, 8, 9,
    10, 20, 30, 40, 50, 60, 70, 80, 90,
  ];

  const filtered = filterPressureLogGridSplits(null, splits).filter(Number.isFinite);
  assert.equal(filtered.length, 10);
  assert.equal(filtered[0], 1e-6);
  assert.equal(filtered.at(-1), 90);
  assert.ok([1e-6, 1e-3, 1, 10].every((value) => filtered.includes(value)));
  assert.ok(filtered.every((value) => {
    const magnitude = 10 ** Math.floor(Math.log10(value));
    const mantissa = value / magnitude;
    return [1, 2, 3, 5, 7, 9].some((allowed) => (
      Math.abs(mantissa - allowed) < Number.EPSILON * 10
    ));
  }));
  assert.deepEqual(
    filterPressureLogGridSplits(
      null,
      [1.01e-6, 2.02e-6, 3.04e-6, 4.04e-6, 5.05e-6, 6.06e-6, 7.07e-6, 8.08e-6, 9.09e-6]
    ),
    [1e-6, 2e-6, 3e-6, null, 5e-6, null, 7e-6, null, 9e-6]
  );
  assert.deepEqual(
    filterPressureLogGridSplits(null, [1, 2, 3, 4, 5, 6, 7, 8, 9]),
    [1, 2, 3, null, 5, null, 7, null, 9]
  );
  assert.deepEqual(
    filterPressureLogGridSplits({ valToPos: (value) => value * 5 }, [1, 3, 5, 7, 9]),
    [1, null, 5, null, 9]
  );
  assert.deepEqual(
    filterPressureLogGridSplits({ valToPos: (value) => value === 0.09 ? 0 : 8 }, [0.09, 0.1]),
    [null, 0.1]
  );
  assert.deepEqual(filterPressureLogGridSplits(null, [0, -1, Number.NaN, Infinity]), [null, null, null, null]);
  assert.deepEqual(filterPressureLogGridSplits(null, null), []);
});

test('getPressureTimeWindowBounds can advance live and historical right edges to now', () => {
  const newest = 1_800_000_000;
  const oldest = newest - (24 * 60 * 60);
  const xVals = [oldest, newest - 30, newest];
  const now = newest + 120;

  for (const hours of [1, 3, 6, 12, 24]) {
    assert.deepEqual(
      getPressureTimeWindowBounds(xVals, hours, now),
      [Math.max(oldest, now - (hours * 60 * 60)), now]
    );
  }

  assert.deepEqual(getPressureTimeWindowBounds(xVals, null, now), [oldest, now]);
  assert.deepEqual(getPressureTimeWindowBounds(xVals, null), [oldest, newest]);
  assert.deepEqual(getPressureTimeWindowBounds([null, oldest, newest, null], 1), [newest - 3600, newest]);
  assert.deepEqual(getPressureTimeWindowBounds([], 1), [null, null]);
  assert.deepEqual(getPressureTimeWindowBounds([], 1, now), [now - 3600, now]);
  assert.deepEqual(getPressureTimeWindowBounds([null, Number.NaN], 1), [null, null]);
});

test('clampPressureViewportRange enforces a ten-second minimum around the requested center', () => {
  assert.deepEqual(clampPressureViewportRange(0, 100, 40, 42, 3), [36, 46]);
  assert.deepEqual(clampPressureViewportRange(0, 100, 20, 40, 3), [20, 40]);
  assert.deepEqual(clampPressureViewportRange(0, 100, -1, 1, 3), [0, 10]);
  assert.deepEqual(clampPressureViewportRange(0, 100, 99, 101, 3), [90, 100]);
});

test('clampPressureViewportRange preserves larger source-cadence and short-data limits', () => {
  assert.deepEqual(clampPressureViewportRange(0, 100, 40, 42, 60), [11, 71]);
  assert.deepEqual(clampPressureViewportRange(0, 5, 2, 3, 3), [-5, 5]);
  assert.equal(clampPressureViewportRange(null, 100, 40, 42, 3), null);
  assert.equal(clampPressureViewportRange(0, 100, 42, 40, 3), null);
});

test('getCCSTimeWindowBounds returns the hour ending at now', () => {
  assert.deepEqual(getCCSTimeWindowBounds(1_800_000_000), [1_799_996_400, 1_800_000_000]);
});

test('buildPressureViewportSample keeps power-of-two sampling stable as the cache advances', () => {
  const xVals = Array.from({ length: 17 }, (_value, index) => index);
  const pressure972bVals = xVals.map((value) => value * 10);
  const pressure902bVals = xVals.map((value) => value * 100);
  const initial = buildPressureViewportSample(
    xVals.slice(0, 16),
    pressure972bVals.slice(0, 16),
    pressure902bVals.slice(0, 16),
    0,
    15,
    5,
    0
  );
  const advanced = buildPressureViewportSample(
    xVals.slice(1),
    pressure972bVals.slice(1),
    pressure902bVals.slice(1),
    1,
    16,
    5,
    1
  );

  assert.equal(initial.downsampleFactor, 4);
  assert.equal(advanced.downsampleFactor, 4);
  assert.deepEqual(initial.xVals, [0, 4, 8, 12, 15]);
  assert.deepEqual(initial.pressure972bVals, [0, 40, 80, 120, 150]);
  assert.deepEqual(initial.pressure902bVals, [0, 400, 800, 1200, 1500]);
  assert.deepEqual(advanced.xVals, [4, 8, 12, 16]);
});

test('advancing now through empty graph space does not change sampled points', () => {
  const xVals = Array.from({ length: 16 }, (_value, index) => 100 + index);
  const pressure972bVals = xVals.map((value) => value * 10);
  const pressure902bVals = xVals.map((value) => value * 100);

  const first = buildPressureViewportSample(
    xVals,
    pressure972bVals,
    pressure902bVals,
    0,
    120,
    5,
    0
  );
  const later = buildPressureViewportSample(
    xVals,
    pressure972bVals,
    pressure902bVals,
    0,
    180,
    5,
    0
  );

  assert.deepEqual(later, first);
});
