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

  if (request === 'googleapis') {
    return {
      google: {
        drive: () => ({
          files: {
            list: async () => ({ data: { files: [] } }),
          },
        }),
      },
    };
  }

  return originalLoad(request, parent, isMain);
};

const state = require('../services/state');
const registerRoutes = require('../routes');
const {
  createGraphObj,
  updateDisplayData,
  shortTermPressureGraph,
  longTermPressureGraph,
  ccsGraphA,
  ccsGraphB,
  ccsGraphC,
} = require('../services/graphs');
const {
  fetchShortTermEntriesSince,
  fetchLongTermEntriesSince,
} = require('../services/supabase');
const {
  applyShortTermEntries,
  applyLongTermEntries,
  pollLongTerm,
} = require('../services/polling');

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
    idFactory = (index) => `short-${String(index).padStart(6, '0')}`,
  } = options;

  return Array.from({ length: count }, (_, index) => ({
    id: idFactory(index),
    created_at: new Date(startMs + index * intervalMs).toISOString(),
    data: {
      pressure: pressureFactory(index),
      clamp_temperature_A: 100 + index,
      clamp_temperature_B: 200 + index,
      clamp_temperature_C: 300 + index,
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
  graph.lastUsedFactor = 1;
  graph.lastPermanentIndex = -1;
  graph.chartDataIntervalCount = 0;
  graph.chartDataIntervalDuration = 1;
}

function resetCCSGraph(graph) {
  graph.xVals.length = 0;
  graph.yVals.length = 0;
}

function resetSingletonState() {
  state.lastShortTermCursor = null;
  state.lastLongTermCursor = null;
  state.webMonitorLastModified = null;
  state.displayLogLastModified = null;
  state.experimentRunning = false;
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
    clamp_temperature_C: null,
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
    status(code) {
      this.statusCode = code;
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
    graphUpdater: updateDisplayData,
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
    entries.map((entry) => Math.floor(Date.parse(entry.created_at) / 1000))
  );
  assert.equal(graph.displayXVals.at(-1), Math.floor(Date.parse(entries.at(-1).created_at) / 1000));
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

test('applyShortTermEntries skips malformed pressure rows but still advances the cursor', () => {
  const graph = createGraphObj({ maxDisplayPoints: 256 });
  const ccsA = createCCSGraph();
  const ccsB = createCCSGraph();
  const ccsC = createCCSGraph();
  const stateRef = { lastShortTermCursor: null };
  const entries = buildShortTermEntries(3, {
    pressureFactory: (index) => (index === 1 ? null : `${1e-6 + index * 1e-7}`),
  });
  const { logger, warns } = createLogger();

  const summary = applyShortTermEntries(entries, {
    stateRef,
    graph,
    graphUpdater: updateDisplayData,
    ccsA,
    ccsB,
    ccsC,
    ccsPointAdder: addCCSPointForTest,
    logger,
  });

  assert.equal(summary.batchSize, 3);
  assert.equal(summary.appendedCount, 2);
  assert.equal(summary.skippedCount, 1);
  assert.equal(graph.fullXVals.length, 2);
  assert.deepEqual(
    graph.fullXVals,
    [entries[0], entries[2]].map((entry) => Math.floor(Date.parse(entry.created_at) / 1000))
  );
  assert.deepEqual(stateRef.lastShortTermCursor, {
    timestamp: entries[2].created_at,
    id: entries[2].id,
  });
  assert.equal(ccsA.xVals.length, 3);
  assert.ok(warns.some((line) => line.includes('invalid pressure value')));
});

test('applyLongTermEntries drains missed long-term rows in order', () => {
  const graph = createGraphObj({ maxDisplayPoints: 256 });
  const stateRef = { lastLongTermCursor: null };
  const entries = buildLongTermEntries(6);
  const { logger, warns, logs } = createLogger();

  const summary = applyLongTermEntries(entries, {
    stateRef,
    graph,
    graphUpdater: updateDisplayData,
    logger,
  });

  assert.equal(summary.batchSize, 6);
  assert.equal(summary.appendedCount, 6);
  assert.equal(summary.skippedCount, 0);
  assert.equal(graph.fullXVals.length, 6);
  assert.deepEqual(
    graph.fullXVals,
    entries.map((entry) => Math.floor(Date.parse(entry.recorded_at) / 1000))
  );
  assert.equal(graph.displayXVals.at(-1), Math.floor(Date.parse(entries.at(-1).recorded_at) / 1000));
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
    graphUpdater: updateDisplayData,
    logger,
  });

  const summary = applyLongTermEntries(entries, {
    stateRef,
    graph,
    graphUpdater: updateDisplayData,
    logger,
  });

  assert.equal(summary.batchSize, 4);
  assert.equal(summary.appendedCount, 2);
  assert.equal(summary.skippedCount, 2);
  assert.equal(graph.fullXVals.length, 4);
  assert.deepEqual(
    graph.fullXVals,
    entries.map((entry) => Math.floor(Date.parse(entry.recorded_at) / 1000))
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
    entries.map((entry) => Math.floor(Date.parse(entry.recorded_at) / 1000))
  );
  assert.equal(firstResult?.appendedCount, 2);
  assert.equal(secondResult, null);
  assert.deepEqual(state.lastLongTermCursor, {
    timestamp: entries.at(-1).recorded_at,
    id: entries.at(-1).id,
  });
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

test('24-hour short-term data keeps a denser live display than the old 256-point cap', () => {
  const graph = createGraphObj({
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
    graphUpdater: updateDisplayData,
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

test('long-term data remains capped at the lower historical display density', () => {
  const graph = createGraphObj({
    maxDisplayPoints: 256,
    sourceResolutionLabel: '1-min averaged source data',
  });
  const stateRef = { lastLongTermCursor: null };
  const entries = buildLongTermEntries(1_440);
  const { logger } = createLogger();

  applyLongTermEntries(entries, {
    stateRef,
    graph,
    graphUpdater: updateDisplayData,
    logger,
  });

  assert.equal(graph.lastUsedFactor, 8);
  assert.ok(graph.displayXVals.length >= 180 && graph.displayXVals.length <= 181);
  assert.ok(graph.displayXVals.length <= 256);
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
    Math.floor(Date.parse(shortEntries.at(-1).created_at) / 1000)
  );
  assert.equal(
    response.payload.yVals.at(-1),
    Number.parseFloat(shortEntries.at(-1).data.pressure)
  );
  assert.equal(response.payload.rawPointCount, shortTermPressureGraph.fullXVals.length);
  assert.equal(response.payload.displayPointCount, shortTermPressureGraph.displayXVals.length);
  assert.equal(response.payload.downsampleFactor, shortTermPressureGraph.lastUsedFactor);
  assert.equal(response.payload.sourceResolutionLabel, shortTermPressureGraph.sourceResolutionLabel);
  assert.deepEqual(response.payload.xVals, shortTermPressureGraph.displayXVals);
  assert.deepEqual(response.payload.yVals, shortTermPressureGraph.displayYVals);

  const longResponse = createResponseRecorder();
  chartRoute.handler({ query: { view: 'long' } }, longResponse);

  assert.equal(longResponse.statusCode, 200);
  assert.equal(longResponse.payload.view, 'long');
  assert.equal(longResponse.payload.rawPointCount, longTermPressureGraph.fullXVals.length);
  assert.equal(longResponse.payload.displayPointCount, longTermPressureGraph.displayXVals.length);
  assert.equal(longResponse.payload.downsampleFactor, longTermPressureGraph.lastUsedFactor);
  assert.equal(longResponse.payload.sourceResolutionLabel, longTermPressureGraph.sourceResolutionLabel);
  assert.deepEqual(longResponse.payload.xVals, longTermPressureGraph.displayXVals);
  assert.deepEqual(longResponse.payload.yVals, longTermPressureGraph.displayYVals);
});
