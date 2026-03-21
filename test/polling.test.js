const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

process.env.FOLDER_ID ??= 'test-folder';
process.env.API_KEY ??= 'test-api-key';
process.env.SUPABASE_API_URL ??= 'http://127.0.0.1:54321';
process.env.SUPABASE_API_KEY ??= 'test-supabase-key';

const originalLoad = Module._load;
Module._load = function mockExternalDependencies(request, parent, isMain) {
  if (request === 'dotenv') {
    return { config: () => ({}) };
  }

  if (request === '@supabase/supabase-js') {
    return {
      createClient: () => ({
        from: () => {
          const builder = {
            select: () => builder,
            order: () => builder,
            limit: () => builder,
            range: () => builder,
            gte: () => builder,
            gt: () => builder,
            delete: () => builder,
            then: (resolve) => resolve({ data: [], error: null }),
          };

          return builder;
        },
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
const { applyShortTermEntries, applyLongTermEntries } = require('../services/polling');

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
  } = options;

  return Array.from({ length: count }, (_, index) => ({
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
  } = options;

  return Array.from({ length: count }, (_, index) => ({
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
  state.lastShortTermTimestamp = null;
  state.lastLongTermTimestamp = null;
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
  const stateRef = { lastShortTermTimestamp: null };
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
  assert.equal(stateRef.lastShortTermTimestamp, entries.at(-1).created_at);
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
  const stateRef = { lastShortTermTimestamp: null };
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
  assert.equal(stateRef.lastShortTermTimestamp, entries[2].created_at);
  assert.equal(ccsA.xVals.length, 3);
  assert.ok(warns.some((line) => line.includes('invalid pressure value')));
});

test('applyLongTermEntries drains missed long-term rows in order', () => {
  const graph = createGraphObj({ maxDisplayPoints: 256 });
  const stateRef = { lastLongTermTimestamp: null };
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
  assert.equal(stateRef.lastLongTermTimestamp, entries.at(-1).recorded_at);
  assert.equal(warns.length, 0);
  assert.match(logs[0], /Long-term sync processed 6 rows/);
});

test('chart-data short view returns the newest synced short-term point after catch-up', () => {
  const { logger } = createLogger();
  const entries = buildShortTermEntries(8);
  applyShortTermEntries(entries, { logger });

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
    Math.floor(Date.parse(entries.at(-1).created_at) / 1000)
  );
  assert.equal(
    response.payload.yVals.at(-1),
    Number.parseFloat(entries.at(-1).data.pressure)
  );
  assert.deepEqual(response.payload.xVals, shortTermPressureGraph.displayXVals);
  assert.deepEqual(response.payload.yVals, shortTermPressureGraph.displayYVals);
});
