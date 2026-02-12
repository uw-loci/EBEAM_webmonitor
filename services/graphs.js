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

const pressureGraph = createGraphObj();
const sampleGraph = createGraphObj();

function addSampleChartDataPoint() {
  const nowMs = Date.now();
  const tSec = Math.floor(nowMs / 1000);
  const y = Math.sin(tSec / 10);

  sampleGraph.fullXVals.push(tSec);
  sampleGraph.fullYVals.push(y);

  updateDisplayData(sampleGraph);
}

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

module.exports = {
  createGraphObj,
  updateDisplayData,
  addSampleChartDataPoint,
  pressureGraph,
  sampleGraph,
};
