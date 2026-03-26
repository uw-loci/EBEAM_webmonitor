function createGraphObj(options = {}) {
  return {
    fullXVals: options.fullXVals || [],
    fullYVals: options.fullYVals || [],
    displayXVals: options.displayXVals || [],
    displayYVals: options.displayYVals || [],
    maxDataPoints: options.maxDataPoints ?? 1000,
    maxDisplayPoints: options.maxDisplayPoints ?? 256,
    sourceResolutionLabel: options.sourceResolutionLabel || 'source data',
    lastUsedFactor: options.lastUsedFactor ?? 1,
    lastPermanentIndex: options.lastPermanentIndex ?? -1,
    chartDataIntervalCount: options.chartDataIntervalCount ?? 0,
    chartDataIntervalDuration: options.chartDataIntervalDuration ?? 1,
  };
}

function resetPressureGraphDisplayState(graph) {
  graph.displayXVals.length = 0;
  graph.displayYVals.length = 0;
  graph.lastUsedFactor = 1;
  graph.lastPermanentIndex = -1;
  graph.chartDataIntervalCount = 0;
  graph.chartDataIntervalDuration = 1;
}

const shortTermPressureGraph = createGraphObj({
  maxDataPoints: 30000,
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

    for (let i = 0; i < len - 1; i += graph.lastUsedFactor) {
      graph.displayXVals.push(graph.fullXVals[i]);
      graph.displayYVals.push(graph.fullYVals[i]);
      graph.lastPermanentIndex = i;
    }

    graph.displayXVals.push(graph.fullXVals[len - 1]);
    graph.displayYVals.push(graph.fullYVals[len - 1]);

  } else {
    if (len - 1 === graph.lastPermanentIndex + graph.lastUsedFactor + 1) {
      graph.displayXVals.push(graph.fullXVals[len - 1]);
      graph.displayYVals.push(graph.fullYVals[len - 1]);
      graph.lastPermanentIndex = len - 2;

    } else {
      if (graph.displayXVals.length > 0) {
        graph.displayXVals[graph.displayXVals.length - 1] = graph.fullXVals[len - 1];
        graph.displayYVals[graph.displayYVals.length - 1] = graph.fullYVals[len - 1];
      } else {
        graph.displayXVals.push(graph.fullXVals[len - 1]);
        graph.displayYVals.push(graph.fullYVals[len - 1]);
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
    graph.lastPermanentIndex = len - 2;
    return;
  }

  for (let i = 0; i < len - 1; i += downsampleFactor) {
    graph.displayXVals.push(graph.fullXVals[i]);
    graph.displayYVals.push(graph.fullYVals[i]);
    graph.lastPermanentIndex = i;
  }

  graph.displayXVals.push(graph.fullXVals[len - 1]);
  graph.displayYVals.push(graph.fullYVals[len - 1]);
}

function appendPressurePoint(graph, tSec, pressure) {
  graph.fullXVals.push(tSec);
  graph.fullYVals.push(pressure);

  if (graph.fullXVals.length > graph.maxDataPoints) {
    graph.fullXVals = graph.fullXVals.slice(-graph.maxDataPoints);
    graph.fullYVals = graph.fullYVals.slice(-graph.maxDataPoints);
    rebuildDisplayData(graph);
    return;
  }

  updateDisplayData(graph);
}

function clearPressureGraph(graph) {
  graph.fullXVals.length = 0;
  graph.fullYVals.length = 0;
  resetPressureGraphDisplayState(graph);
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

function createCCSGraphObj() {
  return { xVals: [], yVals: [], maxPoints: CCS_MAX_POINTS };
}

function addCCSPoint(graph, tSec, temp) {
  graph.xVals.push(tSec);
  graph.yVals.push(temp ?? null);
  if (graph.xVals.length > graph.maxPoints) {
    graph.xVals.shift();
    graph.yVals.shift();
  }
}

const ccsGraphA = createCCSGraphObj();
const ccsGraphB = createCCSGraphObj();
const ccsGraphC = createCCSGraphObj();

module.exports = {
  createGraphObj,
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
