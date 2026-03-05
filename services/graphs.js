function createGraphObj(options = {}) {
  return {
    fullXVals: options.fullXVals || [],
    fullYVals: options.fullYVals || [],
    displayXVals: options.displayXVals || [],
    displayYVals: options.displayYVals || [],
    maxDataPoints: options.maxDataPoints ?? 1000,
    maxDisplayPoints: options.maxDisplayPoints ?? 256,
    lastUsedFactor: options.lastUsedFactor ?? 1,
    lastPermanentIndex: options.lastPermanentIndex ?? -1,
    chartDataIntervalCount: options.chartDataIntervalCount ?? 0,
    chartDataIntervalDuration: options.chartDataIntervalDuration ?? 1,
  };
}

const shortTermPressureGraph = createGraphObj({ maxDataPoints: 30000, maxDisplayPoints: 256 });
const longTermPressureGraph = createGraphObj({ maxDataPoints: 100000, maxDisplayPoints: 256 });

function updateDisplayData(graph) {
  const len = graph.fullXVals.length;

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
  updateDisplayData,
  shortTermPressureGraph,
  longTermPressureGraph,
  addCCSPoint,
  ccsGraphA,
  ccsGraphB,
  ccsGraphC,
};
