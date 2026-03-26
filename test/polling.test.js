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
  appendPressurePoint,
  shortTermPressureGraph,
  longTermPressureGraph,
  ccsGraphA,
  ccsGraphB,
  ccsGraphC,
} = require('../services/graphs');
const {
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

function assertPressureGraphDisplayIntegrity(graph) {
  assert.equal(
    graph.displayXVals.length,
    graph.displayYVals.length,
    'expected pressure display x/y arrays to stay aligned'
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
    freshEntries.map((entry) => Math.floor(Date.parse(entry.created_at) / 1000))
  );
  assert.deepEqual(
    shortTermPressureGraph.fullYVals,
    freshEntries.map((entry) => Number.parseFloat(entry.data.pressure))
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
    entries.slice(-5).map((entry) => Math.floor(Date.parse(entry.recorded_at) / 1000))
  );
  assert.equal(graph.displayXVals.at(-1), Math.floor(Date.parse(entries.at(-1).recorded_at) / 1000));
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
    entries.slice(-5).map((entry) => Math.floor(Date.parse(entry.created_at) / 1000))
  );
  assert.equal(graph.displayXVals.at(-1), Math.floor(Date.parse(entries.at(-1).created_at) / 1000));
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

  for (let index = 0; index < 12; index++) {
    appendPressurePoint(graph, 1_000 + index, index);

    assert.strictEqual(graph.fullXVals, fullXRef);
    assert.strictEqual(graph.fullYVals, fullYRef);
    assert.ok(graph.fullXVals.length <= graph.maxDataPoints);
    assertPressureGraphDisplayIntegrity(graph);
  }

  assert.deepEqual(graph.fullXVals, [1007, 1008, 1009, 1010, 1011]);
  assert.deepEqual(graph.fullYVals, [7, 8, 9, 10, 11]);
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
    entries.slice(-5).map((entry) => Math.floor(Date.parse(entry.recorded_at) / 1000))
  );
  assert.equal(graph.displayXVals.at(-1), Math.floor(Date.parse(entries.at(-1).recorded_at) / 1000));
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

test('dashboard HTML uses the recent-log viewer and does not force refresh on open', async () => {
  const app = createFakeApp();
  registerRoutes(app);

  const dashboardRoute = app.routes.find((route) => route.method === 'GET' && route.path === '/');
  assert.ok(dashboardRoute, 'expected / route to be registered');

  const response = createResponseRecorder();
  await dashboardRoute.handler({}, response);

  assert.equal(response.statusCode, 200);
  assert.match(response.payload, /Recent Log \(last 30 min\)/);
  assert.match(response.payload, /Show Recent Log/);
  assert.match(response.payload, /class="log-viewer-header"/);
  assert.match(response.payload, /class="btn-toggle log-toggle-button"/);
  assert.match(response.payload, /class="btn-toggle pressure-toggle-button"/);
  assert.match(response.payload, /chartEl\.getBoundingClientRect\(\)\.width/);
  assert.match(response.payload, /overflow:\s*hidden;/);
  assert.match(response.payload, /fetch\('\/raw'\)/);
  assert.doesNotMatch(response.payload, /fetch\('\/refresh-display'\)/);
  assert.doesNotMatch(response.payload, /margin-top:\s*-3\.5em/);
  assert.doesNotMatch(response.payload, /float:\s*right/);
});
