function createGraphObj(options = {}) {
  const maxDataPoints = options.maxDataPoints ?? 1000;
  const fullXVals = options.fullXVals || [];
  const graph = {
    fullXVals,
    fullYVals: options.fullYVals || [],
    fullPressure902bVals: options.fullPressure902bVals || [],
    displayXVals: options.displayXVals || [],
    displayYVals: options.displayYVals || [],
    displayPressure902bVals: options.displayPressure902bVals || [],
    maxDataPoints,
    maxTimeWindowSeconds: options.maxTimeWindowSeconds ?? null,
    // Drop a small batch when the raw cache fills instead of shifting and
    // rebuilding the arrays on every new point. Small test/custom graphs keep
    // exact one-at-a-time trimming; production-sized graphs trim about 2%.
    trimBatchSize: options.trimBatchSize ?? Math.max(1, Math.floor(maxDataPoints * 0.02)),
    maxDisplayPoints: options.maxDisplayPoints ?? 256,
    sourceResolutionLabel: options.sourceResolutionLabel || 'source data',
    lastUsedFactor: options.lastUsedFactor ?? 1,
    lastPermanentIndex: options.lastPermanentIndex ?? -1,
    chartDataIntervalCount: options.chartDataIntervalCount ?? 0,
    chartDataIntervalDuration: options.chartDataIntervalDuration ?? 1,
    nextPointIndex: options.nextPointIndex ?? fullXVals.length,
  };

  return graph;
}

function parsePressureForLogScale(value) {
  if (
    (typeof value !== 'number' && typeof value !== 'string') ||
    (typeof value === 'string' && value.trim() === '')
  ) {
    return null;
  }
  const pressure = Number(value);
  return Number.isFinite(pressure) && pressure > 0 ? pressure : null;
}

function resetPressureGraphDisplayState(graph) {
  graph.displayXVals.length = 0;
  graph.displayYVals.length = 0;
  graph.displayPressure902bVals.length = 0;
  graph.lastUsedFactor = 1;
  graph.lastPermanentIndex = -1;
  graph.chartDataIntervalCount = 0;
  graph.chartDataIntervalDuration = 1;
}

const shortTermPressureGraph = createGraphObj({
  maxDataPoints: 30000,
  maxTimeWindowSeconds: 24 * 60 * 60,
  maxDisplayPoints: 1024,
  sourceResolutionLabel: '~3s source data',
});
const longTermPressureGraph = createGraphObj({
  maxDataPoints: 100000,
  maxDisplayPoints: 256,
  sourceResolutionLabel: '1-min averaged source data',
});

function updateDisplayData(graph) {
  const len = graph.fullXVals.length;
  if (len === 0) {
    resetPressureGraphDisplayState(graph);
    return;
  }

  const predictedPoints = Math.ceil((len - 1) / graph.lastUsedFactor) + 1;

  if (predictedPoints > graph.maxDisplayPoints) {
    graph.lastUsedFactor *= 2;
    graph.lastPermanentIndex = -1;
    graph.displayXVals.length = 0;
    graph.displayYVals.length = 0;
    graph.displayPressure902bVals.length = 0;

    for (let i = 0; i < len - 1; i += graph.lastUsedFactor) {
      graph.displayXVals.push(graph.fullXVals[i]);
      graph.displayYVals.push(graph.fullYVals[i]);
      graph.displayPressure902bVals.push(graph.fullPressure902bVals[i]);
      graph.lastPermanentIndex = i;
    }

    graph.displayXVals.push(graph.fullXVals[len - 1]);
    graph.displayYVals.push(graph.fullYVals[len - 1]);
    graph.displayPressure902bVals.push(graph.fullPressure902bVals[len - 1]);

  } else {
    if (len - 1 === graph.lastPermanentIndex + graph.lastUsedFactor + 1) {
      graph.displayXVals.push(graph.fullXVals[len - 1]);
      graph.displayYVals.push(graph.fullYVals[len - 1]);
      graph.displayPressure902bVals.push(graph.fullPressure902bVals[len - 1]);
      graph.lastPermanentIndex = len - 2;

    } else {
      if (graph.displayXVals.length > 0) {
        graph.displayXVals[graph.displayXVals.length - 1] = graph.fullXVals[len - 1];
        graph.displayYVals[graph.displayYVals.length - 1] = graph.fullYVals[len - 1];
        graph.displayPressure902bVals[graph.displayPressure902bVals.length - 1] =
          graph.fullPressure902bVals[len - 1];
      } else {
        graph.displayXVals.push(graph.fullXVals[len - 1]);
        graph.displayYVals.push(graph.fullYVals[len - 1]);
        graph.displayPressure902bVals.push(graph.fullPressure902bVals[len - 1]);
      }
    }
  }
}

function rebuildDisplayData(graph) {
  const len = graph.fullXVals.length;
  resetPressureGraphDisplayState(graph);

  if (len === 0) {
    return;
  }

  let downsampleFactor = 1;
  let predictedPoints = len;

  while (predictedPoints > graph.maxDisplayPoints) {
    downsampleFactor *= 2;
    predictedPoints = Math.ceil((len - 1) / downsampleFactor) + 1;
  }

  graph.lastUsedFactor = downsampleFactor;

  if (downsampleFactor === 1) {
    graph.displayXVals.push(...graph.fullXVals);
    graph.displayYVals.push(...graph.fullYVals);
    graph.displayPressure902bVals.push(...graph.fullPressure902bVals);
    graph.lastPermanentIndex = len - 2;
    return;
  }

  for (let i = 0; i < len - 1; i += downsampleFactor) {
    graph.displayXVals.push(graph.fullXVals[i]);
    graph.displayYVals.push(graph.fullYVals[i]);
    graph.displayPressure902bVals.push(graph.fullPressure902bVals[i]);
    graph.lastPermanentIndex = i;
  }

  graph.displayXVals.push(graph.fullXVals[len - 1]);
  graph.displayYVals.push(graph.fullYVals[len - 1]);
  graph.displayPressure902bVals.push(graph.fullPressure902bVals[len - 1]);
}

function appendPressurePoint(graph, tSec, pressure972b, pressure902b = null) {
  const timestamp = Number(tSec);
  const previousTimestamp = graph.fullXVals.at(-1);

  // uPlot's aligned time-series format requires finite, strictly increasing,
  // unique X values. Supabase rows may legitimately share a database
  // timestamp, but passing those duplicates through can make uPlot's time-axis
  // allocation fail and take down the browser tab. Keep the first graph point
  // for a timestamp; scalar dashboard state still advances to the latest row.
  if (
    !Number.isFinite(timestamp) ||
    (Number.isFinite(previousTimestamp) && timestamp <= previousTimestamp)
  ) {
    return false;
  }

  graph.fullXVals.push(timestamp);
  graph.fullYVals.push(pressure972b ?? null);
  graph.fullPressure902bVals.push(pressure902b ?? null);
  graph.nextPointIndex++;

  const cutoffTimeSec = graph.maxTimeWindowSeconds
    ? tSec - graph.maxTimeWindowSeconds
    : null;
  let requiredTrimCount = Math.max(0, graph.fullXVals.length - graph.maxDataPoints);

  while (
    cutoffTimeSec !== null &&
    requiredTrimCount < graph.fullXVals.length &&
    graph.fullXVals[requiredTrimCount] < cutoffTimeSec
  ) {
    requiredTrimCount++;
  }

  if (requiredTrimCount > 0) {
    const trimCount = Math.min(
      graph.fullXVals.length,
      Math.max(requiredTrimCount, graph.trimBatchSize ?? 1)
    );
    graph.fullXVals.splice(0, trimCount);
    graph.fullYVals.splice(0, trimCount);
    graph.fullPressure902bVals.splice(0, trimCount);
    rebuildDisplayData(graph);
    return true;
  }

  updateDisplayData(graph);
  return true;
}

function clearPressureGraph(graph) {
  graph.fullXVals.length = 0;
  graph.fullYVals.length = 0;
  graph.fullPressure902bVals.length = 0;
  resetPressureGraphDisplayState(graph);
  graph.nextPointIndex = 0;
}

function getGraphMetadata(graph) {
  return {
    rawPointCount: graph.fullXVals.length,
    displayPointCount: graph.displayXVals.length,
    downsampleFactor: Math.max(1, graph.lastUsedFactor ?? 1),
    sourceResolutionLabel: graph.sourceResolutionLabel || 'source data',
  };
}

const CCS_MAX_POINTS = 1200; // ~1 hour at 3s polling
const CCS_TRIM_BATCH_SIZE = 60;

function createCCSGraphObj() {
  return {
    xVals: [],
    yVals: [],
    maxPoints: CCS_MAX_POINTS,
    trimBatchSize: CCS_TRIM_BATCH_SIZE,
  };
}

function addCCSPoint(graph, tSec, temp) {
  graph.xVals.push(tSec);
  graph.yVals.push(temp ?? null);
  if (graph.xVals.length > graph.maxPoints) {
    const overflowCount = graph.xVals.length - graph.maxPoints;
    const trimCount = Math.min(
      graph.xVals.length,
      Math.max(overflowCount, graph.trimBatchSize ?? 1)
    );
    graph.xVals.splice(0, trimCount);
    graph.yVals.splice(0, trimCount);
  }
}

const ccsGraphA = createCCSGraphObj();
const ccsGraphB = createCCSGraphObj();
const ccsGraphC = createCCSGraphObj();

module.exports = {
  createGraphObj,
  parsePressureForLogScale,
  resetPressureGraphDisplayState,
  updateDisplayData,
  rebuildDisplayData,
  appendPressurePoint,
  clearPressureGraph,
  getGraphMetadata,
  shortTermPressureGraph,
  longTermPressureGraph,
  addCCSPoint,
  ccsGraphA,
  ccsGraphB,
  ccsGraphC,
};
