const { getGraphMetadata } = require('../services/graphs');

const REQUEST_TIMEOUT_MS = 10_000;
const PRESSURE_SNAPSHOT_TIMEOUT_MS = 30_000;

async function fetchJsonWithTimeout(
  url,
  timeoutMs = REQUEST_TIMEOUT_MS,
  fetchImpl = fetch
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    if (!response.ok) throw new Error('Request failed: ' + response.status);
    return await response.json();
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Request timed out');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizePressureSeriesForLogScale(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  return values.map((value) => (
    Number.isFinite(value) && value > 0 ? value : null
  ));
}

function getPaddedPressureLogRange(rangeLog, dataMin, dataMax) {
  if (
    typeof rangeLog !== 'function' ||
    !Number.isFinite(dataMin) ||
    !Number.isFinite(dataMax) ||
    dataMin <= 0 ||
    dataMax <= 0
  ) {
    return [dataMin, dataMax];
  }

  const [autoMin, autoMax] = rangeLog(dataMin, dataMax, 10, false);
  const paddedMin = dataMin / Math.sqrt(10);

  return [
    Number.isFinite(autoMin) ? Math.min(autoMin, paddedMin) : paddedMin,
    Number.isFinite(autoMax) ? Math.max(autoMax, dataMax) : dataMax,
  ];
}

function filterPressureLogGridSplits(_uplot, splits) {
  if (!Array.isArray(splits)) {
    return [];
  }

  const allowedMantissas = new Set([1, 2, 3, 5, 7, 9, 10]);
  const exactSplits = splits.map((value) => {
    if (!Number.isFinite(value) || value <= 0) return null;
    const exponent = Math.floor(Math.log10(value));
    const magnitude = 10 ** exponent;
    const mantissa = Math.round(value / magnitude);
    return allowedMantissas.has(mantissa)
      ? Number(`${mantissa}e${exponent}`)
      : null;
  });
  const candidateIndexes = [];
  const decadeIndexes = [];
  const seenValues = new Set();
  exactSplits.forEach((value, index) => {
    if (!Number.isFinite(value) || seenValues.has(value)) return;
    seenValues.add(value);
    const magnitude = 10 ** Math.floor(Math.log10(value));
    const mantissa = Math.round(value / magnitude);
    candidateIndexes.push(index);
    if (mantissa === 1) decadeIndexes.push(index);
  });

  const maxSplits = 10;
  const pickEvenly = (indexes, count) => Array.from({ length: count }, (_value, index) => (
    indexes[Math.round(index * (indexes.length - 1) / Math.max(1, count - 1))]
  ));
  let visibleIndexes = new Set(
    decadeIndexes.length >= maxSplits
      ? pickEvenly(decadeIndexes, maxSplits)
      : decadeIndexes.concat(pickEvenly(
          candidateIndexes.filter((index) => !decadeIndexes.includes(index)),
          Math.min(maxSplits - decadeIndexes.length, candidateIndexes.length - decadeIndexes.length)
        ))
  );

  if (_uplot && typeof _uplot.valToPos === 'function') {
    const minLabelSpacing = 16;
    const positionedIndexes = Array.from(visibleIndexes, (index) => ({
      index,
      position: _uplot.valToPos(exactSplits[index], 'y'),
      isDecade: decadeIndexes.includes(index),
    })).filter(({ position }) => Number.isFinite(position)).sort((a, b) => a.position - b.position);
    const nonOverlapping = [];

    positionedIndexes.forEach((candidate) => {
      const previous = nonOverlapping.at(-1);
      if (!previous || candidate.position - previous.position >= minLabelSpacing) {
        nonOverlapping.push(candidate);
      } else if (candidate.isDecade && !previous.isDecade) {
        const beforePrevious = nonOverlapping.at(-2);
        if (!beforePrevious || candidate.position - beforePrevious.position >= minLabelSpacing) {
          nonOverlapping[nonOverlapping.length - 1] = candidate;
        }
      }
    });

    visibleIndexes = new Set(nonOverlapping.map(({ index }) => index));
  }

  return exactSplits.map((value, index) => visibleIndexes.has(index) ? value : null);
}

function getPressureTimeWindowBounds(xVals, hours, nowSec = null) {
  const currentTime = Number.isFinite(nowSec) ? nowSec : null;
  if (!Array.isArray(xVals) || xVals.length === 0) {
    return Number.isFinite(hours) && hours > 0 && currentTime !== null
      ? [currentTime - hours * 60 * 60, currentTime]
      : [null, null];
  }

  const firstValue = xVals.find(Number.isFinite);
  const lastValue = xVals.findLast(Number.isFinite);
  if (!Number.isFinite(firstValue) || !Number.isFinite(lastValue)) {
    return [null, null];
  }

  const rightEdge = currentTime === null ? lastValue : Math.max(lastValue, currentTime);
  if (!Number.isFinite(hours) || hours <= 0) {
    return [firstValue, rightEdge];
  }

  return [Math.max(firstValue, rightEdge - hours * 60 * 60), rightEdge];
}

function clampPressureViewportRange(
  dataMin,
  dataMax,
  requestedMin,
  requestedMax,
  sourceMinimumSpan = 1
) {
  if (
    !Number.isFinite(dataMin) ||
    !Number.isFinite(dataMax) ||
    dataMax <= dataMin ||
    !Number.isFinite(requestedMin) ||
    !Number.isFinite(requestedMax) ||
    requestedMax <= requestedMin
  ) {
    return null;
  }

  const minimumSpan = Math.max(
    10,
    Number.isFinite(sourceMinimumSpan) && sourceMinimumSpan > 0
      ? sourceMinimumSpan
      : 1
  );
  const boundedMin = Math.min(dataMin, dataMax - minimumSpan);
  const boundedMax = dataMax;
  const fullSpan = boundedMax - boundedMin;
  const requestedSpan = requestedMax - requestedMin;
  const span = Math.max(minimumSpan, Math.min(fullSpan, requestedSpan));

  if (span >= fullSpan) return [boundedMin, boundedMax];

  const center = requestedMin + requestedSpan / 2;
  let min = center - span / 2;
  let max = center + span / 2;
  if (min < boundedMin) {
    min = boundedMin;
    max = boundedMin + span;
  }
  if (max > boundedMax) {
    max = boundedMax;
    min = boundedMax - span;
  }
  return [min, max];
}

function getCCSTimeWindowBounds(nowSec) {
  const rightEdge = Number.isFinite(nowSec) ? nowSec : Date.now() / 1000;
  return [rightEdge - 60 * 60, rightEdge];
}

function buildPressureViewportSample(
  xVals,
  pressure972bVals,
  pressure902bVals,
  min,
  max,
  maxDisplayPoints = 1000,
  indexOffset = 0
) {
  const empty = {
    xVals: [],
    pressure972bVals: [],
    pressure902bVals: [],
    rawPointCount: 0,
    displayPointCount: 0,
    downsampleFactor: 1,
  };
  if (!xVals.length || !Number.isFinite(min) || !Number.isFinite(max)) return empty;

  const findBound = (target, upper) => {
    let low = 0;
    let high = xVals.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (xVals[middle] < target || (upper && xVals[middle] === target)) low = middle + 1;
      else high = middle;
    }
    return low;
  };

  const start = findBound(min, false);
  const end = findBound(max, true);
  const rawPointCount = end - start;
  if (rawPointCount <= 0) return empty;

  let downsampleFactor = 1;
  while (Math.ceil((rawPointCount - 1) / downsampleFactor) + 1 > maxDisplayPoints) {
    downsampleFactor *= 2;
  }

  const remainder = (indexOffset + start) % downsampleFactor;
  const firstSampleIndex = start + ((downsampleFactor - remainder) % downsampleFactor);
  const sampledXVals = [];
  const sampledPressure972bVals = [];
  const sampledPressure902bVals = [];
  for (let index = firstSampleIndex; index < end - 1; index += downsampleFactor) {
    sampledXVals.push(xVals[index]);
    sampledPressure972bVals.push(pressure972bVals[index]);
    sampledPressure902bVals.push(pressure902bVals[index]);
  }
  sampledXVals.push(xVals[end - 1]);
  sampledPressure972bVals.push(pressure972bVals[end - 1]);
  sampledPressure902bVals.push(pressure902bVals[end - 1]);

  return {
    xVals: sampledXVals,
    pressure972bVals: sampledPressure972bVals,
    pressure902bVals: sampledPressure902bVals,
    rawPointCount,
    displayPointCount: sampledXVals.length,
    downsampleFactor,
  };
}

/**
 * Renders the full HTML dashboard page.
 *
 * @param {Object} opts
 * @param {Object} opts.data            - Current experimental data
 * @param {Object} opts.state           - Shared app state
 * @param {number[]} opts.sicColors     - 11-element array of interlock colors
 * @param {string[]} opts.vacColors     - 8-element array of vacuum indicator colors
 * @param {Object} opts.shortTermPressureGraph - Short-term pressure chart graph object
 * @param {Object} opts.longTermPressureGraph - Long-term pressure chart graph object
 * @param {Object} opts.ccsGraphA - CCS clamp temperature graph for cathode A
 * @param {Object} opts.ccsGraphB - CCS clamp temperature graph for cathode B
 * @param {Object} opts.ccsGraphC - CCS clamp temperature graph for cathode C
 * @param {string} opts.codeLastUpdated - Timestamp string for code deploy
 * @returns {string} Full HTML string
 */
function renderDashboard(opts) {
  const {
    data,
    state,
    sicColors,
    vacColors,
    shortTermPressureGraph,
    longTermPressureGraph,
    ccsGraphA,
    ccsGraphB,
    ccsGraphC,
    codeLastUpdated,
  } = opts;

  const experimentRunning = state.experimentRunning;

  const fileModified = (state.lastModifiedTime && !isNaN(state.lastModifiedTime))
    ? new Date(state.lastModifiedTime).toLocaleString("en-US", {timeZone: "America/Chicago"})
    : "N/A";
  const currentTime = new Date().toLocaleString("en-US", {timeZone: "America/Chicago"});

  let pressure = data.pressure;
  if (pressure !== null){
    pressure = Number(data.pressure).toExponential(3);
  }
  let pressure902b = data.pressure_902b_mbar;
  if (pressure902b !== null && typeof pressure902b !== 'undefined') {
    const numericPressure902b = Number(pressure902b);
    pressure902b = Number.isFinite(numericPressure902b)
      ? numericPressure902b.toExponential(3)
      : null;
  }

  const temperatures = (data && data.temperatures) || {
    "1": "DISCONNECTED",
    "2": "DISCONNECTED",
    "3": "DISCONNECTED",
    "4": "DISCONNECTED",
    "5": "DISCONNECTED",
    "6": "DISCONNECTED"
  };

  // Destructure sicColors into named variables for template readability
  const [
    doorColor, waterColor, vacuumPowerColor, vacuumPressureColor,
    oilLowColor, oilHighColor, estopIntColor, estopExtColor,
    allInterlocksColor, G9OutputColor, hvoltColor
  ] = sicColors;

  const shortTermChartMeta = getGraphMetadata(shortTermPressureGraph);
  const normalizePressureSeriesSource = normalizePressureSeriesForLogScale.toString();
  const paddedPressureLogRangeSource = getPaddedPressureLogRange.toString();
  const pressureLogGridFilterSource = filterPressureLogGridSplits.toString();
  const pressureTimeWindowBoundsSource = getPressureTimeWindowBounds.toString();
  const pressureViewportClampSource = clampPressureViewportRange.toString();
  const pressureViewportSampleSource = buildPressureViewportSample.toString();
  const ccsTimeWindowBoundsSource = getCCSTimeWindowBounds.toString();
  const jsonFetchSource = fetchJsonWithTimeout.toString();

  function formatPressureChartStatus(meta) {
    const rawPointCount = Number(meta.rawPointCount ?? 0);
    const displayPointCount = Number(meta.displayPointCount ?? 0);
    const downsampleFactor = Math.max(1, Number(meta.downsampleFactor ?? 1));
    const sourceResolutionLabel = meta.sourceResolutionLabel || 'source data';

    if (rawPointCount === 0) {
      return `Showing 0 of 0 raw points (${sourceResolutionLabel})`;
    }

    if (downsampleFactor === 1 && rawPointCount === displayPointCount) {
      return `Showing all ${displayPointCount.toLocaleString()} raw points (${sourceResolutionLabel})`;
    }

    return `Showing ${displayPointCount.toLocaleString()} of ${rawPointCount.toLocaleString()} raw points (downsample x${downsampleFactor}, ${sourceResolutionLabel})`;
  }

  function hasLiveNumber(value) {
    return value !== null && typeof value !== 'undefined' && Number.isFinite(Number(value));
  }

  function isOutputEnabled(value) {
    return value === true || value === 1 || value === 'true' || value === '1';
  }

  function renderPowerSupplyOutputLabel(outputEnabled, elementId, isRunning) {
    const idAttr = elementId ? ` id="${elementId}"` : '';
    if (!isRunning || outputEnabled === null || typeof outputEnabled === 'undefined') {
      return `<div${idAttr} class="power-supply-output power-supply-output-unknown">Output: --</div>`;
    }

    const enabled = isOutputEnabled(outputEnabled);
    const className = enabled
      ? 'power-supply-output power-supply-output-enabled'
      : 'power-supply-output power-supply-output-disabled';

    return `<div${idAttr} class="${className}">Output: ${enabled ? 'Enabled' : 'Disabled'}</div>`;
  }

  function formatPowerSupplyVoltage(value, scale) {
    if (!experimentRunning || !hasLiveNumber(value)) {
      return '--';
    }

    const numericValue = Number(value);
    if (scale === 'kv') {
      return `${(numericValue / 1000).toFixed(2)}kV`; // Bertans
    }

    return `${numericValue.toFixed(0)} V`;            // Matsusadas
  }

  function formatPowerSupplyCurrent(value) {
    if (!experimentRunning || !hasLiveNumber(value)) {
      return '--';
    }

    return `${Number(value).toFixed(2)} mA`;
  }

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>E-Beam Web Monitor</title>
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css"/>
      <link rel="stylesheet" href="https://unpkg.com/uplot/dist/uPlot.min.css">
      <script src="https://unpkg.com/uplot/dist/uPlot.iife.min.js"></script>
      <style>
        /* =========================
           FUTURISTIC BACKGROUND
        ========================== */

        :root {
          --bg-base:        #0a0e1a;
          --bg-surface:     rgba(255,255,255,0.05);
          --bg-surface-alt: rgba(255,255,255,0.08);
          --border-subtle:  rgba(255,255,255,0.10);
          --accent:         #38bdf8;
          --success:        #22c55e;
          --danger:         #ef4444;
          --text-primary:   #e2e8f0;
          --text-secondary: #94a3b8;
        }

        body {
          font-family: Arial, sans-serif;
          text-align: center;
          background: var(--bg-base);
          background-size: 400% 400%;
          color: var(--text-primary);
          margin: 0;
        }

        @keyframes gradientMove {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }

        /* =========================
           GLASSMORPHISM CONTAINERS
        ========================== */

        .glass-container {
          background: rgba(30, 30, 30, 0.9);
          border-radius: 8px;
          padding: 30px;
          width: 100%;
          margin: 0 auto;
        }

        .interlocks-section,
        .env-section,
        .vacuum-indicators {
          background: rgba(255, 255, 255, 0.08);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border-radius: 10px;
          padding: 12px 16px;
          margin: 14px auto;
          width: 90%;
          box-sizing: border-box;
          border: 1px solid var(--border-subtle);
        }

        /* =========================
           TITLES / HEADERS
        ========================== */
        .dashboard-title {
          font-size: 2em;
          font-weight: 700;
          color: #d6eaff;
          text-align: left;
          padding-left: 40px;
        }

        .dashboard-subtitle {
          font-size: 0.9em;
          margin-bottom: 25px;
          text-align: left;
          opacity: 0.9;
          color: rgba(255, 255, 255, 0.8);
          display: flex;
        }
        .section-header {
          font-size: 0.72rem;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--text-secondary);
          margin: 0 0 8px 0;
          padding-bottom: 6px;
          border-bottom: 1px solid var(--border-subtle);
        }
        /* =========================
           INTERLOCKS SECTION
        ========================== */
        .interlocks-title {
          font-weight: bold;
          transition: text-shadow 0.3s ease;
          font-size: 0.9em;
        }
        .interlocks-container {
          display: flex;
          justify-content: space-evenly;
          align-items: center;
          flex-wrap: wrap;
          gap: 10px;
        }
        .interlock-item {
          display: flex;
          align-items: center;
          gap: 5px;
          font-size: 0.72rem;
          color: var(--text-secondary);
          margin: 0;
          transition: color 0.2s ease;
        }
        .interlock-item:hover {
          color: var(--text-primary);
        }
        .circle {
          width: 14px;
          height: 14px;
          border-radius: 50%;
          margin: 0;
          cursor: default;
          transition: transform 0.3s ease, filter 0.3s ease;
        }
        .interlock-item:hover .circle {
          transform: scale(1.5);
          filter: brightness(1.3);
        }
        /* =========================
           GREEN INDICATORS SECTION
        ========================== */
        .vacuum-indicators-title {
          font-weight: bold;
          transition: text-shadow 0.3s ease;
          font-size: 0.9em;
        }
        .vacuum-indicators-container {
          display: flex;
          justify-content: space-evenly;
          align-items: center;
          flex-wrap: wrap;
          gap: 10px;
        }
        .vacuum-indicators-item {
          display: flex;
          align-items: center;
          gap: 5px;
          font-size: 0.72rem;
          color: var(--text-secondary);
          margin: 0;
          transition: color 0.2s ease;
        }
        .vacuum-indicators-item:hover {
          color: var(--text-primary);
        }
        .vacuum-indicators-circle {
          width: 14px;
          height: 14px;
          border-radius: 50%;
          margin: 0;
          cursor: default;
          transition: transform 0.3s ease, filter 0.3s ease;
        }
        .vacuum-indicators-item:hover .vacuum-indicators-circle {
          transform: scale(1.5);
          filter: brightness(1.3);
        }
        /* =========================
           ENVIRONMENTAL SECTION
        ========================== */
        .gauge-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
          gap: 1rem;
          margin-top: 1rem;
        }
        .gauge {
          text-align: center;
          color: #fff;
        }
        .ccs {
          text-align: center;
          color: #fff;
        }
        .ccs-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
          gap: 0.5rem;
          margin-top: 0.5rem;
        }
        .beam-energy-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 0.5rem;
          align-items: stretch;
          margin-top: 1rem;
        }
        .ccs-reading {
          font-size: 0.8rem;
          font-weight: 500;
          margin-bottom: 5px;
          padding: 5px 8px;
          border-radius: 6px;
          background: var(--bg-base);
          border: 1px solid var(--border-subtle);
        }
        .beam-energy-reading {
          font-size: 0.8rem;
          font-weight: 500;
          margin-bottom: 5px;
          padding: 5px 8px;
          border-radius: 6px;
          background: var(--bg-base);
          border: 1px solid var(--border-subtle);
        }
        .power-supply-box {
          flex: 1;
          min-width: 0;
          box-sizing: border-box;
          border: 1px solid var(--border-subtle);
          background: var(--bg-surface);
          margin-top: 5px;
          margin-bottom: 12px;
          border-radius: 7px;
          padding: 10px 12px;
        }
        .power-supply-heading {
          margin-bottom: 12px;
        }
        .cathode-box {
          flex: 1;
          border: 1px solid var(--border-subtle);
          background: var(--bg-surface);
          margin-top: 5px;
          margin-bottom: 12px;
          border-radius: 7px;
          padding: 10px 12px;
        }
        .cathode-heading {
           margin-bottom: 12px;
        }
        .power-supply-output {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 100%;
          max-width: 116px;
          min-width: 0;
          box-sizing: border-box;
          margin: 0 auto 10px;
          padding: 4px 10px;
          border-radius: 999px;
          border: 1px solid transparent;
          font-size: 0.72rem;
          font-weight: 700;
          letter-spacing: 0.03em;
          text-transform: uppercase;
        }
        .power-supply-output-enabled {
          color: #86efac;
          background: rgba(34, 197, 94, 0.14);
          border-color: rgba(34, 197, 94, 0.45);
          box-shadow: 0 0 0 1px rgba(34, 197, 94, 0.08) inset;
        }
        .power-supply-output-disabled {
          color: #fca5a5;
          background: rgba(239, 68, 68, 0.14);
          border-color: rgba(239, 68, 68, 0.45);
          box-shadow: 0 0 0 1px rgba(239, 68, 68, 0.08) inset;
        }
        .power-supply-output-unknown {
          color: var(--text-secondary);
          background: rgba(255,255,255,0.03);
          border-color: rgba(255,255,255,0.06);
          box-shadow: none;
        }
        /* gauge circle now displays the attributes of a textbox */
        .gauge-grid {
          display: flex;
          justify-content: space-around;
          align-items: center;
          flex-wrap: wrap;
          gap: 0.5rem;
          margin-top: 0.5rem;
        }
        .gauge {
          text-align: center;
          font-size: 0.75em;
          color: #fff;
        }
        /* gauge circle now displays the attributes of a textbox */
        .gauge-circle {
          background: var(--bg-surface);
          border: 1px solid var(--border-subtle);
          border-radius: 6px;
          padding: 4px 8px;
          font-size: 0.82rem;
          font-weight: 600;
          width: auto;
          height: auto;
          color: white;
          text-align: center;
        }
        /* =========================
           LOG VIEWER
        ========================== */
        pre {
          white-space: pre-wrap;
          font-family: 'Courier New', monospace;
          text-align: left;
          background-color: #000;
          color: #ffffff;
          padding: 20px 0;
          max-height: 600px;
          overflow-y: auto;
          font-size: 0.9em;
          border-radius: 9px;
          margin-top: 0.65em;
          }
        .content-section {
          display: none;
        }
        .content-section.active {
          display: block;
        }
        .btn-toggle {
          background: var(--accent);
          color: #0a0e1a;
          border: none;
          padding: 5px 10px;
          font-size: 0.75em;
          border-radius: 5px;
          transition: background-color 0.3s ease;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }
        .pressure-chart-toolbar {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
          flex-wrap: wrap;
          padding: 0 10px 8px;
          width: 90%;
          margin: 0 auto;
        }
        .pressure-chart-label {
          color: #94a3b8;
          font-size: 14px;
          flex: 1 1 300px;
        }
        .pressure-chart-controls {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 8px;
          flex-wrap: wrap;
        }
        .pressure-chart-control-group {
          display: inline-flex;
          align-items: center;
          gap: 4px;
        }
        .pressure-time-range-label {
          color: var(--text-secondary);
          font-size: 0.75em;
          white-space: nowrap;
        }
        .pressure-time-range-select,
        .pressure-chart-control {
          min-height: 28px;
          border: 1px solid rgba(148, 163, 184, 0.45);
          border-radius: 5px;
          background: #111827;
          color: #cbd5e1;
          font-size: 0.75em;
        }
        .pressure-time-range-select {
          padding: 3px 7px;
        }
        .pressure-chart-control {
          padding: 4px 9px;
          cursor: pointer;
          transition: background-color 0.2s ease, border-color 0.2s ease, color 0.2s ease;
        }
        .pressure-chart-control:hover {
          border-color: var(--accent);
          color: #e0f2fe;
        }
        .pressure-chart-control.is-active {
          background: var(--accent);
          border-color: var(--accent);
          color: #0a0e1a;
          font-weight: 600;
        }
        .pressure-chart-help {
          width: 90%;
          margin: 0 auto 6px;
          color: #64748b;
          font-size: 0.72rem;
          text-align: left;
        }
        .pressure-toggle-button {
          flex-shrink: 0;
        }
        .log-viewer-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
          flex-wrap: wrap;
        }
        .log-viewer-title {
          flex: 1 1 320px;
          margin: 0;
        }
        .log-toggle-button {
          flex-shrink: 0;
        }
        .btn-refresh {
          width: 22px;
          vertical-align: middle;
          cursor: pointer;
          border-radius: 1px;
          transition: background-color 0.3s ease;
          transform: translate(-529px, -47px);
        }

        /* =========================
           RESPONSIVE LAYOUT
        ========================== */
        @media (max-width: 992px) {
          .card-container {
            grid-template-columns: repeat(2, 1fr);
          }
          .beam-energy-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }
        @media (max-width: 600px) {
          .card-container {
            grid-template-columns: repeat(1, 1fr);
          }
          .pressure-chart-toolbar,
          .pressure-chart-help {
            width: 100%;
          }
          .pressure-chart-controls {
            width: 100%;
            justify-content: flex-start;
          }
        }
        /* =========================
           EXPERIMENT-RUNNING NOTICE
        ========================== */
        .fixed-top-right {
          position: absolute;
          top: 20px;
          right: 25px;
          padding: 5px 10px;
          font-size: 0.7em;
          border-radius: 8px;
          color: white;
          font-weight: bold;
          z-index: 9999;
        }
        .neon-warning {
          border: 2px solid var(--danger);
          box-shadow: 0 0 8px var(--danger);
          text-shadow: 0 0 8px var(--danger);
          background-color: rgba(239, 68, 68, 0.15);
        }
        .neon-success {
          border: 2px solid var(--success);
          box-shadow: 0 0 8px var(--success);
          text-shadow: 0 0 8px var(--success);
          background-color: rgba(34, 197, 94, 0.15);
        }
        @media (max-width: 768px) {
          .fixed-top-right {
            position: static;
            display: block;
            margin: 10px auto 20px;
            width: fit-content;
            font-size: 1.1em;
            padding: 8px 16px;
          }
          .dashboard-title {
            margin-top: 10px;
            font-size: 3.0em;
          }
        }

        /* =========================
          CHART STYLES
        ========================== */

        .chart-container {
          background: rgba(255, 255, 255, 0.08);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border-radius: 15px;
          padding: 10px;
          margin: 14px auto;
          width: 90%;
          box-sizing: border-box;
          overflow: hidden;
        }

        #ccs-charts-section .chart-container { margin: 10px auto; }

        .chart {
          position: relative;
          min-height: 300px;
          height: auto;
          width: 100%;
        }

        #ccs-charts-section .chart {
          height: auto;
        }

        #ccs-charts-section {
          margin: 10px 0;
        }

        .chart-title {
          font-size: 0.78rem;
          font-weight: 600;
          color: var(--text-secondary);
          text-transform: uppercase;
          letter-spacing: 0.06em;
          margin-bottom: 6px;
        }

        .chart-info-text {
          margin-top: 8px;
          font-size: 0.9em;
          color: #ccc;
        }

        #chart-root-3 .u-over {
          cursor: crosshair;
          touch-action: none;
        }

        #chart-root-3.is-pan-mode .u-over {
          cursor: grab;
        }

        #chart-root-3.is-pan-mode.is-panning .u-over {
          cursor: grabbing;
        }

        #chart-root-3 .u-select {
          display: none;
          background: rgba(56, 189, 248, 0.18);
          border: 1px solid rgba(56, 189, 248, 0.9);
          box-sizing: border-box;
        }

        #chart-root-3.is-zoom-selecting .u-select {
          display: block;
        }
      </style>
    </head>
    <body>
      <div class="container-fluid mt-4">
        <div style="display:flex; align-items:center; justify-content:space-between; padding:8px 24px 10px; border-bottom:1px solid var(--border-subtle); margin-bottom:12px;">
          <h2 style="font-size:1.4rem; font-weight:700; color:#d6eaff; margin:0;">E-beam Web Monitor</h2>
          <div style="display:flex; align-items:center; gap:10px;">
            <div id="experiment-status" class="${!experimentRunning ? 'neon-warning' : 'neon-success'}" style="padding:4px 10px; font-size:0.7em; border-radius:8px; color:white; font-weight:bold;">
              Dashboard is ${!experimentRunning ? 'not ' : ''}running
            </div>
            <button id="open-reset-modal" style="padding:4px 10px; font-size:0.7em; border-radius:8px; font-weight:bold; background:#7f1d1d; border:1px solid #ef4444; color:#fca5a5; cursor:pointer;">
              Experiment Reset
            </button>
          </div>
        </div>
        <p style="text-align:center; font-size:0.75rem; color:var(--text-secondary); margin:0 0 12px 0;">
          Log Modified: <span id="log-last-modified">${fileModified}</span> &nbsp;·&nbsp; Updated: <span id="site-last-updated">${currentTime}</span>
        </p>
        <!-- Interlocks Section -->
        <div class="interlocks-section">
          <h3 class="section-header">Interlocks</h3>
          <div class="interlocks-container">
            <div class="interlock-item" title="Door">
              <div id="sic-door" class="circle" style="background-color:${doorColor}"></div>
              <span>Door</span>
            </div>
            <div class="interlock-item" title="Water">
              <div id="sic-water" class="circle" style="background-color:${waterColor}"></div>
              <span>Water</span>
            </div>
            <div class="interlock-item" title="Vacuum Power">
              <div id="sic-vacuum-power" class="circle" style="background-color:${vacuumPowerColor}"></div>
              <span>Vacuum Power</span>
            </div>
            <div class="interlock-item" title="Vacuum Pressure">
              <div id="sic-vacuum-pressure" class="circle" style="background-color:${vacuumPressureColor}"></div>
              <span>Vacuum Pressure</span>
            </div>
            <div class="interlock-item" title="Low Oil">
              <div id="sic-oil-low" class="circle" style="background-color:${oilLowColor}"></div>
              <span>Low Oil</span>
            </div>
            <div class="interlock-item" title="High Oil">
              <div id="sic-oil-high" class="circle" style="background-color:${oilHighColor}"></div>
              <span>High Oil</span>
            </div>
            <div class="interlock-item" title="E-STOP Int">
              <div id="sic-estop" class="circle" style="background-color:${estopIntColor}"></div>
              <span>E-STOP Int</span>
            </div>
            <div class="interlock-item" title="E-STOP Ext">
              <div id="sic-estopExt" class="circle" style="background-color:${estopExtColor}"></div>
              <span>E-STOP Ext</span>
            </div>
            <div class="interlock-item" title="All Interlocks">
              <div id="all-interlocks" class="circle" style="background-color:${allInterlocksColor}"></div>
              <span>All Interlocks</span>
            </div>
            <div class="interlock-item" title="G9 Output">
              <div id="g9-output" class="circle" style="background-color:${G9OutputColor}"></div>
              <span>G9 Output</span>
            </div>
            <div class="interlock-item" title="HVolt ON">
              <div id="hvolt" class="circle" style="background-color:${hvoltColor}"></div>
              <span>HVolt ON</span>
            </div>
          </div>
        </div>
        <!-- Vacuum Indicators Section -->
        <div class="vacuum-indicators">
          <div style="display:grid; grid-template-columns:1fr auto 1fr; align-items:center; margin-bottom:8px; padding-bottom:6px; border-bottom:1px solid var(--border-subtle);">
            <span></span>
            <h3 class="section-header" style="border-bottom:none; margin:0; text-align:center;">Vacuum Indicators</h3>
            <span id="pressureReadings" style="font-size:1.05rem; font-weight:700; color:#7dd3fc; font-variant-numeric:tabular-nums; text-align:right; white-space:nowrap;">
              <span id="pressure972b">972B: ${pressure !== null ? pressure + ' mbar' : '-- mbar'}</span>&nbsp;&nbsp;<span id="pressure902b" style="color:#818cf8;">902B: ${pressure902b !== null ? pressure902b + ' mbar' : '-- mbar'}</span>
            </span>
          </div>
          <div class="vacuum-indicators-container">
            <div class="vacuum-indicators-item" title="Pumps Power ON">
              <div id="vac-indicator-0" class="vacuum-indicators-circle" style="background-color:${vacColors[0]}"></div>
              <span>Pumps Power ON</span>
            </div>
            <div class="vacuum-indicators-item" title="Turbo Rotor ON">
              <div id="vac-indicator-1" class="vacuum-indicators-circle" style="background-color:${vacColors[1]}"></div>
              <span>Turbo Rotor ON</span>
            </div>
            <div class="vacuum-indicators-item" title="Turbo Vent Open">
              <div id="vac-indicator-2" class="vacuum-indicators-circle" style="background-color:${vacColors[2]}"></div>
              <span>Turbo Vent Open</span>
            </div>
            <div class="vacuum-indicators-item" title="972B Relay 1 ON">
              <div id="vac-indicator-3" class="vacuum-indicators-circle" style="background-color:${vacColors[3]}"></div>
              <span>972B Relay 1 ON</span>
            </div>
            <div class="vacuum-indicators-item" title="Turbo Gate Closed">
              <div id="vac-indicator-4" class="vacuum-indicators-circle" style="background-color:${vacColors[4]}"></div>
              <span>Turbo Gate Closed</span>
            </div>
            <div class="vacuum-indicators-item" title="Turbo Gate Open">
              <div id="vac-indicator-5" class="vacuum-indicators-circle" style="background-color:${vacColors[5]}"></div>
              <span>Turbo Gate Open</span>
            </div>
            <div class="vacuum-indicators-item" title="Argon Gate Open">
              <div id="vac-indicator-6" class="vacuum-indicators-circle" style="background-color:${vacColors[6]}"></div>
              <span>Argon Gate Open</span>
            </div>
            <div class="vacuum-indicators-item" title="Argon Gate Closed">
              <div id="vac-indicator-7" class="vacuum-indicators-circle" style="background-color:${vacColors[7]}"></div>
              <span>Argon Gate Closed</span>
            </div>
          </div>
        </div>
        <!-- Environmental Section -->
        <div class="env-section">
          <h3 class="section-header">Environmental</h3>
          <div class="gauge-grid">
            <div class="gauge" id="sensor-1">
              <div class="gauge-circle"><div class="gauge-cover">${temperatures["1"] === "DISCONNECTED" || temperatures["1"] === "None" ? '--' : temperatures["1"] + '°C'}</div></div>
              <div class="sensor-label">Solenoid 1</div>
            </div>
            <div class="gauge" id="sensor-2">
              <div class="gauge-circle"><div class="gauge-cover">${temperatures["2"] === "DISCONNECTED" || temperatures["2"] === "None" ? '--' : temperatures["2"] + '°C'}</div></div>
              <div class="sensor-label">Solenoid 2</div>
            </div>
            <div class="gauge" id="sensor-3">
              <div class="gauge-circle"><div class="gauge-cover">${temperatures["3"] === "DISCONNECTED" || temperatures["3"] === "None" ? '--' : temperatures["3"] + '°C'}</div></div>
              <div class="sensor-label">Chmbr Bot</div>
            </div>
            <div class="gauge" id="sensor-4">
              <div class="gauge-circle"><div class="gauge-cover">${temperatures["4"] === "DISCONNECTED" || temperatures["4"] === "None" ? '--' : temperatures["4"] + '°C'}</div></div>
              <div class="sensor-label">Chmbr Top</div>
            </div>
            <div class="gauge" id="sensor-5">
              <div class="gauge-circle"><div class="gauge-cover">${temperatures["5"] === "DISCONNECTED" || temperatures["5"] === "None" ? '--' : temperatures["5"] + '°C'}</div></div>
              <div class="sensor-label">Air temp</div>
            </div>
            <div class="gauge" id="sensor-6">
              <div class="gauge-circle"><div class="gauge-cover">${temperatures["6"] === "DISCONNECTED" || temperatures["6"] === "None" ? '--' : temperatures["6"] + '°C'}</div></div>
              <div class="sensor-label">Extra 6</div>
            </div>
          </div>
        </div>
        <!-- CCS Section -->
        <div class="env-section">
          <h3 class="section-header">CCS</h3>
          <div class="ccs-grid">
            <div class="cathode-box">
              <p class="cathode-heading">Cathode 1</p>
              <div id="heaterCurrentA" class="ccs-reading">Current: ${data.heaterCurrent_A != null && experimentRunning
                ? data.heaterCurrent_A.toFixed(2) + ' A'
                : '--'}
              </div>
              <div id="heaterVoltageA" class="ccs-reading">Voltage: ${data.heaterVoltage_A != null && experimentRunning
                ? data.heaterVoltage_A.toFixed(2) + ' V'
                : '--'}
              </div>
                <div id="heaterTemperatureA" class="ccs-reading">Clamp Temperature: ${data.clamp_temperature_A != null && experimentRunning
                ? data.clamp_temperature_A.toFixed(2) + ' C'
                : '--'}
              </div>
            </div>
            <div class="cathode-box">
              <p class="cathode-heading">Cathode 2</p>
              <div id="heaterCurrentB" class="ccs-reading">Current: ${data.heaterCurrent_B != null && experimentRunning
                ? data.heaterCurrent_B.toFixed(2) + ' A'
                : '--'}
              </div>
              <div id="heaterVoltageB" class="ccs-reading">Voltage: ${data.heaterVoltage_B != null && experimentRunning
                ? data.heaterVoltage_B.toFixed(2) + ' V'
                : '--'}
              </div>
              <div id="heaterTemperatureB" class="ccs-reading">Clamp Temperature: ${data.clamp_temperature_B != null && experimentRunning
              ? data.clamp_temperature_B.toFixed(2) + ' C'
              : '--'}
              </div>
            </div>
            <div class="cathode-box">
              <p class="cathode-heading">Cathode 3</p>
              <div id="heaterCurrentC" class="ccs-reading">Current: ${data.heaterCurrent_C != null && experimentRunning
                ? data.heaterCurrent_C.toFixed(2) + ' A'
                : '--'}
              </div>
              <div id="heaterVoltageC" class="ccs-reading">Voltage: ${data.heaterVoltage_C != null && experimentRunning
                ? data.heaterVoltage_C.toFixed(2) + ' V'
                : '--'}
              </div>
              <div id="heaterTemperatureC" class="ccs-reading">Clamp Temperature: ${data.clamp_temperature_C != null && experimentRunning
                ? data.clamp_temperature_C.toFixed(2) + ' C'
                : '--'}
              </div>
            </div>
          </div>
        </div>
        <!-- Beam Energy -->
        <div class="env-section">
          <h3 class="section-header">Beam Energy</h3>
          <div class="beam-energy-grid">
            <div class="power-supply-box">
              <p class="power-supply-heading">+1kV Matsusada</p>
              ${renderPowerSupplyOutputLabel(data.pos_1kv_output, 'powerSupplyOutputPos1', experimentRunning)}
              <div id="powerSupplySetVoltagePos1" class="beam-energy-reading">Set Voltage: ${formatPowerSupplyVoltage(data.pos_1kv_set, 'v')}
                </div>
              <div id="powerSupplyMeasuredVoltagePos1" class="beam-energy-reading">Measured Voltage: ${formatPowerSupplyVoltage(data.pos_1kv_hv, 'v')}
              </div>
              <div id="powerSupplyMeasuredCurrentPos1" class="beam-energy-reading">Measured Current: ${formatPowerSupplyCurrent(data.pos_1kv_i)}
              </div>
            </div>
            <div class="power-supply-box">
              <p class="power-supply-heading">-1kV Matsusada</p>
              ${renderPowerSupplyOutputLabel(data.neg_1kv_output, 'powerSupplyOutputNeg1', experimentRunning)}
              <div id="powerSupplySetVoltageNeg1" class="beam-energy-reading">Set Voltage: ${formatPowerSupplyVoltage(data.neg_1kv_set, 'v')}
              </div>
              <div id="powerSupplyMeasuredVoltageNeg1" class="beam-energy-reading">Measured Voltage: ${formatPowerSupplyVoltage(data.neg_1kv_hv, 'v')}
              </div>
              <div id="powerSupplyMeasuredCurrentNeg1" class="beam-energy-reading">Measured Current: ${formatPowerSupplyCurrent(data.neg_1kv_i)}
              </div>
            </div>
            <div class="power-supply-box">
              <p class="power-supply-heading">20kV Bertan</p>
              ${renderPowerSupplyOutputLabel(data.pos_20kv_output, 'powerSupplyOutputB20', experimentRunning)}
              <div id="powerSupplySetVoltageB20" class="beam-energy-reading">Set Voltage: ${formatPowerSupplyVoltage(data.pos_20kv_set, 'kv')}
              </div>
              <div id="powerSupplyMeasuredVoltageB20" class="beam-energy-reading">Measured Voltage: ${formatPowerSupplyVoltage(data.pos_20kv_hv, 'kv')}
              </div>
              <div id="powerSupplyMeasuredCurrentB20" class="beam-energy-reading">Measured Current: ${formatPowerSupplyCurrent(data.pos_20kv_i)}
              </div>
            </div>
            <div class="power-supply-box">
              <p class="power-supply-heading">3kV Bertan</p>
              ${renderPowerSupplyOutputLabel(data.pos_3kv_output, 'powerSupplyOutputB3', experimentRunning)}
              <div id="powerSupplySetVoltageB3" class="beam-energy-reading">Set Voltage: ${formatPowerSupplyVoltage(data.pos_3kv_set, 'kv')}
              </div>
              <div id="powerSupplyMeasuredVoltageB3" class="beam-energy-reading">Measured Voltage: ${formatPowerSupplyVoltage(data.pos_3kv_hv, 'kv')}
              </div>
              <div id="powerSupplyMeasuredCurrentB3" class="beam-energy-reading">Measured Current: ${formatPowerSupplyCurrent(data.pos_3kv_i)}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div id="chart-root-2"></div>
      <div id="pressure-chart-section">
        <div class="pressure-chart-toolbar">
          <span id="pressure-chart-label" class="pressure-chart-label">
            Short-Term (Last 24h, ~3s source data, downsampled for display)
          </span>
          <div class="pressure-chart-controls">
            <label id="pressure-time-range-group" class="pressure-chart-control-group" for="pressure-time-range">
              <span class="pressure-time-range-label">Show</span>
              <select id="pressure-time-range" class="pressure-time-range-select" aria-label="Pressure chart time range">
                <option value="1">Last 1h</option>
                <option value="3">Last 3h</option>
                <option value="6">Last 6h</option>
                <option value="12">Last 12h</option>
                <option value="24" selected>Last 24h</option>
                <option value="custom" disabled>Custom</option>
              </select>
            </label>
            <div class="pressure-chart-control-group" role="group" aria-label="Pressure chart interaction mode">
              <button id="pressure-zoom-mode" type="button" class="pressure-chart-control is-active" aria-pressed="true">Zoom</button>
              <button id="pressure-pan-mode" type="button" class="pressure-chart-control" aria-pressed="false">Pan</button>
            </div>
            <button id="pressure-reset-view" type="button" class="pressure-chart-control">Reset</button>
            <button id="pressure-view-toggle" type="button" class="btn-toggle pressure-toggle-button">
              Switch to Historical View
            </button>
          </div>
        </div>
        <div class="pressure-chart-help">Drag to select in Zoom mode; switch to Pan to move through time. Wheel or pinch to zoom. Double-click or Reset restores the selected window.</div>
        <div id="pressure-chart-status" class="chart-info-text" style="width:90%; margin:0 auto 6px auto; text-align:left; color:#94a3b8;">
          ${formatPressureChartStatus(shortTermChartMeta)}
        </div>
        <div id="chart-root-3" style="margin-top: 0;"></div>
      </div>

      <script>
        ${normalizePressureSeriesSource}
        ${paddedPressureLogRangeSource}
        ${pressureLogGridFilterSource}
        ${pressureTimeWindowBoundsSource}
        ${pressureViewportClampSource}
        ${pressureViewportSampleSource}
        const REQUEST_TIMEOUT_MS = ${REQUEST_TIMEOUT_MS};
        const PRESSURE_SNAPSHOT_TIMEOUT_MS = ${PRESSURE_SNAPSHOT_TIMEOUT_MS};
        ${jsonFetchSource}

        let currentPressureView = 'short';
        let pressureInteractionMode = 'zoom';
        let selectedLiveHours = 24;
        let pressureViewportKind = 'preset';
        let pressureCustomRange = null;
        let pressureRawDataX = ${JSON.stringify(shortTermPressureGraph.displayXVals)};
        let pressureRawData972b = ${JSON.stringify(shortTermPressureGraph.displayYVals)};
        let pressureRawData902b = ${JSON.stringify(shortTermPressureGraph.displayPressure902bVals)};
        let pressureRawCursor = null;
        let pressureRawIndexOffset = 0;
        let pressureRawMaxPoints = ${shortTermPressureGraph.maxDataPoints};
        let pressureSourceResolutionLabel = ${JSON.stringify(shortTermPressureGraph.sourceResolutionLabel)};
        let pressureViewportNow = Date.now() / 1000;
        let pressureMinimumXSpan = getMinimumPressureXSpan(pressureRawDataX);
        let pressureViewportRenderFrame = null;
        let pressureRawRefreshInFlight = false;
        let pressureSnapshotGeneration = 0;
        let pressureChart = null;
        let pressureChartInitialized = false;
        let pressure902bLiveVisible = true;
        let pressure902bSuppressedForHistorical = false;
        let applyingPressureViewport = false;
        let lastLongTermPollAt = Date.now();
        const LONG_TERM_POLL_INTERVAL_MS = 60_000;

        const pressureChartRoot = document.getElementById('chart-root-3');
        const pressureViewToggle = document.getElementById('pressure-view-toggle');
        const pressureChartLabel = document.getElementById('pressure-chart-label');
        const pressureChartStatus = document.getElementById('pressure-chart-status');
        const pressureTimeRangeGroup = document.getElementById('pressure-time-range-group');
        const pressureTimeRange = document.getElementById('pressure-time-range');
        const pressureZoomMode = document.getElementById('pressure-zoom-mode');
        const pressurePanMode = document.getElementById('pressure-pan-mode');
        const pressureResetView = document.getElementById('pressure-reset-view');

        function getPressureDataExtent() {
          return getPressureTimeWindowBounds(pressureRawDataX, null, pressureViewportNow);
        }

        function resolvePressureViewport() {
          if (pressureViewportKind === 'custom') {
            const [dataMin, dataMax] = getPressureDataExtent();
            const [rangeMin, rangeMax] = Array.isArray(pressureCustomRange)
              ? pressureCustomRange
              : [null, null];
            const customRangeStillVisible = (
              Number.isFinite(dataMin) &&
              Number.isFinite(dataMax) &&
              Number.isFinite(rangeMin) &&
              Number.isFinite(rangeMax) &&
              rangeMax > rangeMin &&
              rangeMax >= dataMin &&
              rangeMin <= dataMax
            );

            if (customRangeStillVisible) {
              return pressureCustomRange;
            }

            pressureCustomRange = null;
            pressureViewportKind = currentPressureView === 'short' ? 'preset' : 'all';
          }

          if (currentPressureView === 'short') {
            return getPressureTimeWindowBounds(
              pressureRawDataX,
              selectedLiveHours,
              pressureViewportNow
            );
          }

          return getPressureDataExtent();
        }

        function markPressureViewportCustom(min, max) {
          if (
            !pressureChartInitialized ||
            applyingPressureViewport ||
            !Number.isFinite(min) ||
            !Number.isFinite(max) ||
            max <= min
          ) {
            return;
          }

          pressureViewportKind = 'custom';
          pressureCustomRange = [min, max];
          updatePressureChartViewText();
          schedulePressureViewportRender();
        }

        function getMinimumPressureXSpan(xVals) {
          let minimumSpan = Infinity;
          for (let index = 1; index < xVals.length; index++) {
            const span = xVals[index] - xVals[index - 1];
            if (Number.isFinite(span) && span > 0) minimumSpan = Math.min(minimumSpan, span);
          }
          return Number.isFinite(minimumSpan) ? Math.max(1, minimumSpan) : 1;
        }

        function createPressureInteractionPlugin(options) {
          let uplotRef = null;
          let zoomStart = null;
          let panStart = null;
          let pinchStart = null;
          const activePointers = new Map();
          const cleanupCallbacks = [];

          const addListener = (target, eventName, handler, listenerOptions) => {
            target.addEventListener(eventName, handler, listenerOptions);
            cleanupCallbacks.push(() => target.removeEventListener(eventName, handler, listenerOptions));
          };

          const clampScaleRange = (min, max) => {
            const [dataMin, dataMax] = options.getDataExtent();
            return clampPressureViewportRange(
              dataMin,
              dataMax,
              min,
              max,
              options.getMinimumSpan()
            );
          };

          const setUserXScale = (min, max) => {
            const clamped = clampScaleRange(min, max);
            if (clamped && uplotRef) {
              uplotRef.setScale('x', { min: clamped[0], max: clamped[1] });
            }
          };

          const pointerPair = () => Array.from(activePointers.values()).slice(0, 2);
          const getPlotX = (clientX) => {
            const rect = uplotRef.over.getBoundingClientRect();
            return Math.max(0, Math.min(rect.width, clientX - rect.left));
          };

          const clearZoomSelection = () => {
            pressureChartRoot.classList.remove('is-zoom-selecting');
            if (uplotRef) {
              uplotRef.setSelect({ left: 0, top: 0, width: 0, height: 0 }, false);
            }
          };

          const beginZoom = (pointer) => {
            if (!uplotRef) return;
            const plotX = getPlotX(pointer.clientX);
            zoomStart = {
              pointerId: pointer.pointerId,
              plotX,
            };
            clearZoomSelection();
          };

          const updateZoomSelection = (pointer) => {
            if (!uplotRef || !zoomStart || zoomStart.pointerId !== pointer.pointerId) return;
            const plotX = getPlotX(pointer.clientX);
            const left = Math.min(zoomStart.plotX, plotX);
            const width = Math.abs(plotX - zoomStart.plotX);
            const rect = uplotRef.over.getBoundingClientRect();
            pressureChartRoot.classList.toggle('is-zoom-selecting', width > 0);
            uplotRef.setSelect({ left, top: 0, width, height: rect.height }, false);
          };

          const finishZoom = (pointer, cancelled = false) => {
            if (!uplotRef || !zoomStart || zoomStart.pointerId !== pointer.pointerId) return;
            const plotX = getPlotX(pointer.clientX);
            const left = Math.min(zoomStart.plotX, plotX);
            const right = Math.max(zoomStart.plotX, plotX);
            zoomStart = null;
            clearZoomSelection();

            if (!cancelled && right - left >= 8) {
              setUserXScale(uplotRef.posToVal(left, 'x'), uplotRef.posToVal(right, 'x'));
            }
          };

          const beginPinch = () => {
            if (!uplotRef || activePointers.size < 2) return;
            const [first, second] = pointerPair();
            const distance = Math.abs(second.clientX - first.clientX);
            if (distance <= 0) return;
            pinchStart = {
              distance,
              centerX: (first.clientX + second.clientX) / 2,
              min: uplotRef.scales.x.min,
              max: uplotRef.scales.x.max,
            };
            zoomStart = null;
            clearZoomSelection();
            panStart = null;
          };

          const beginPan = (pointer) => {
            if (!uplotRef || !Number.isFinite(uplotRef.scales.x.min) || !Number.isFinite(uplotRef.scales.x.max)) return;
            panStart = {
              pointerId: pointer.pointerId,
              clientX: pointer.clientX,
              min: uplotRef.scales.x.min,
              max: uplotRef.scales.x.max,
            };
            pressureChartRoot.classList.add('is-panning');
          };

          const handlePointerDown = (event) => {
            const isTouch = event.pointerType === 'touch';
            const isPrimaryButton = isTouch || event.button === 0;
            if (!isPrimaryButton) return;

            event.preventDefault();
            activePointers.set(event.pointerId, {
              pointerId: event.pointerId,
              clientX: event.clientX,
              clientY: event.clientY,
            });
            if (typeof uplotRef.over.setPointerCapture === 'function') {
              uplotRef.over.setPointerCapture(event.pointerId);
            }

            if (activePointers.size >= 2) beginPinch();
            else if (options.getMode() === 'pan') beginPan(activePointers.get(event.pointerId));
            else beginZoom(activePointers.get(event.pointerId));
          };

          const handlePointerMove = (event) => {
            if (!activePointers.has(event.pointerId) || !uplotRef) return;
            event.preventDefault();
            activePointers.set(event.pointerId, {
              pointerId: event.pointerId,
              clientX: event.clientX,
              clientY: event.clientY,
            });

            if (activePointers.size >= 2) {
              if (!pinchStart) beginPinch();
              if (!pinchStart) return;

              const [first, second] = pointerPair();
              const currentDistance = Math.abs(second.clientX - first.clientX);
              if (currentDistance <= 0) return;

              const rect = uplotRef.over.getBoundingClientRect();
              const startSpan = pinchStart.max - pinchStart.min;
              const nextSpan = startSpan * pinchStart.distance / currentDistance;
              const currentCenterX = (first.clientX + second.clientX) / 2;
              const startCenterPct = Math.max(0, Math.min(1, (pinchStart.centerX - rect.left) / rect.width));
              const centerShift = (currentCenterX - pinchStart.centerX) / rect.width * startSpan;
              const anchorValue = pinchStart.min + startCenterPct * startSpan - centerShift;
              setUserXScale(anchorValue - startCenterPct * nextSpan, anchorValue + (1 - startCenterPct) * nextSpan);
              return;
            }

            if (panStart && panStart.pointerId === event.pointerId && options.getMode() === 'pan') {
              const rect = uplotRef.over.getBoundingClientRect();
              const span = panStart.max - panStart.min;
              const shift = (event.clientX - panStart.clientX) / rect.width * span;
              setUserXScale(panStart.min - shift, panStart.max - shift);
            } else if (zoomStart && options.getMode() === 'zoom') {
              updateZoomSelection(activePointers.get(event.pointerId));
            }
          };

          const handlePointerEnd = (event, cancelled = false) => {
            const pointer = activePointers.get(event.pointerId) || {
              pointerId: event.pointerId,
              clientX: event.clientX,
              clientY: event.clientY,
            };
            finishZoom(pointer, cancelled);
            activePointers.delete(event.pointerId);
            if (activePointers.size < 2) pinchStart = null;
            if (panStart && panStart.pointerId === event.pointerId) panStart = null;
            pressureChartRoot.classList.remove('is-panning');

            if (activePointers.size === 1 && options.getMode() === 'pan') {
              beginPan(activePointers.values().next().value);
            }
          };

          const handlePointerCancel = (event) => handlePointerEnd(event);

          const handleWheel = (event) => {
            if (!uplotRef || !Number.isFinite(uplotRef.scales.x.min) || !Number.isFinite(uplotRef.scales.x.max)) return;
            event.preventDefault();

            const rect = uplotRef.over.getBoundingClientRect();
            const pointerPct = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
            const currentMin = uplotRef.scales.x.min;
            const currentMax = uplotRef.scales.x.max;
            const currentSpan = currentMax - currentMin;
            const delta = Math.max(-100, Math.min(100, event.deltaY));
            const nextSpan = currentSpan * Math.exp(delta * 0.002);
            const anchorValue = currentMin + pointerPct * currentSpan;
            setUserXScale(anchorValue - pointerPct * nextSpan, anchorValue + (1 - pointerPct) * nextSpan);
          };

          const handleDoubleClick = (event) => {
            event.preventDefault();
            options.onReset();
          };

          return {
            hooks: {
              ready: (uplot) => {
                uplotRef = uplot;
                addListener(uplot.over, 'wheel', handleWheel, { passive: false });
                addListener(uplot.over, 'pointerdown', handlePointerDown);
                addListener(uplot.over, 'pointermove', handlePointerMove);
                addListener(uplot.over, 'lostpointercapture', handlePointerEnd);
                addListener(window, 'pointerup', handlePointerEnd);
                addListener(window, 'pointercancel', handlePointerCancel);
                addListener(uplot.over, 'dblclick', handleDoubleClick);
                options.onReady();
              },
              setScale: (uplot, scaleKey) => {
                if (scaleKey === 'x') {
                  options.onXScaleChange(uplot.scales.x.min, uplot.scales.x.max);
                }
              },
              destroy: () => {
                cleanupCallbacks.forEach((cleanup) => cleanup());
                activePointers.clear();
                zoomStart = null;
                pressureChartRoot.classList.remove('is-panning');
              },
            },
          };
        }

        function createLiveUplotChart(container, config) {
          if (typeof container === 'string') container = document.querySelector(container);

          const {
            title = "Live Updating Chart",
            data = [[], [], []],
            maxDataPoints = 1000,
            maxDisplayPoints = 100,
            displayXVals = [],
            lastUsedFactor = 1,
            chartDataIntervalDuration = 1,
          } = config;

          const wrapper = document.createElement('div');
          wrapper.className = 'chart-container';
          wrapper.innerHTML = \`
            <div class="chart-title">\${title}</div>
            <div class="chart"></div>
          \`;
          container.appendChild(wrapper);

          const chartEl = wrapper.querySelector('.chart');
          const getChartWidth = () => {
            const measuredWidth = Math.floor(chartEl.getBoundingClientRect().width || chartEl.clientWidth || 0);
            if (measuredWidth > 0) {
              return measuredWidth;
            }

            const wrapperStyles = window.getComputedStyle(wrapper);
            const horizontalPadding =
              Number.parseFloat(wrapperStyles.paddingLeft || '0') +
              Number.parseFloat(wrapperStyles.paddingRight || '0');

            return Math.max(1, Math.floor(wrapper.clientWidth - horizontalPadding));
          };

          const uplot = new uPlot({
            width: getChartWidth(),
            height: 300,
            series: [
              {},
              {
                label: '972B pressure (mbar)',
                value: (u, v) => {
                  if (v == null) return "";
                  return v.toExponential(4);
                },
                stroke: '#38bdf8',
                points: { show: true, size: 2, fill: '#38bdf8', stroke: '#38bdf8' }
              },
              {
                label: '902B pressure (mbar)',
                value: (u, v) => {
                  if (v == null) return "";
                  return v.toExponential(4);
                },
                stroke: '#818cf8',
                points: { show: true, size: 2, fill: '#818cf8', stroke: '#818cf8' }
              }
            ],
            scales: {
              x: { time: true },
              y: {
                distr: 3,
                log: 10,
                range: (_uplot, dataMin, dataMax) => (
                  getPaddedPressureLogRange(uPlot.rangeLog, dataMin, dataMax)
                ),
              },
            },
            axes: [
              {
                stroke: '#94a3b8',
                font: '10px Arial',
                ticks: { stroke: 'rgba(255,255,255,0.15)', width: 1 },
                grid:  { stroke: 'rgba(255,255,255,0.06)', width: 1 },
              },
              {
                label: 'Pressure (mbar, log10)',
                labelSize: 20,
                labelFont: '10px Arial',
                stroke: '#94a3b8',
                font: '10px Arial',
                size: 80,
                filter: filterPressureLogGridSplits,
                values: (u, vals) => vals.map(v => (
                  Number.isFinite(v) ? v.toExponential(2) : ''
                )),
                ticks: {
                  stroke: 'rgba(255,255,255,0.15)',
                  width: 1,
                  filter: filterPressureLogGridSplits,
                },
                grid:  {
                  stroke: 'rgba(255,255,255,0.06)',
                  width: 1,
                  filter: filterPressureLogGridSplits,
                },
              },
            ],
            cursor: {
              focus: { prox: -1 },
              points: {
                size: 8,
                width: 1,
                fill: '#38bdf8',
                stroke: '#e0f2fe',
              },
              drag: {
                x: false,
                y: false,
                setScale: false,
                dist: 8,
              },
            },
            plugins: [createPressureInteractionPlugin({
              getMode: () => pressureInteractionMode,
              getDataExtent: () => getPressureDataExtent(),
              getMinimumSpan: () => pressureMinimumXSpan,
              onReady: () => {
                pressureChartInitialized = true;
              },
              onReset: () => resetPressureViewport(),
              onXScaleChange: (min, max) => markPressureViewportCustom(min, max),
            })],
          }, data, chartEl);

          window.addEventListener('resize', () => {
            uplot.setSize({ width: getChartWidth(), height: 300 });
          });

          return uplot;
        }

        // Create the pressure chart and keep a reference for live updates
        pressureChart = createLiveUplotChart(pressureChartRoot, {
          title: 'Pressure Graph',
          data: [
            ${JSON.stringify(shortTermPressureGraph.displayXVals)},
            normalizePressureSeriesForLogScale(${JSON.stringify(shortTermPressureGraph.displayYVals)}),
            normalizePressureSeriesForLogScale(${JSON.stringify(shortTermPressureGraph.displayPressure902bVals)}),
          ],
          maxDataPoints: ${shortTermPressureGraph.maxDataPoints},
          maxDisplayPoints: ${shortTermPressureGraph.maxDisplayPoints},
          displayXVals: ${JSON.stringify(shortTermPressureGraph.displayXVals)},
          lastUsedFactor: ${shortTermPressureGraph.lastUsedFactor},
          chartDataIntervalDuration: ${shortTermPressureGraph.chartDataIntervalDuration},
        });

        function formatPressureChartStatus(meta) {
          const rawPointCount = Number(meta.rawPointCount ?? 0);
          const displayPointCount = Number(meta.displayPointCount ?? 0);
          const downsampleFactor = Math.max(1, Number(meta.downsampleFactor ?? 1));
          const sourceResolutionLabel = meta.sourceResolutionLabel || 'source data';

          if (rawPointCount === 0) {
            return 'Showing 0 of 0 raw points (' + sourceResolutionLabel + ')';
          }

          if (downsampleFactor === 1 && rawPointCount === displayPointCount) {
            return 'Showing all ' + rawPointCount.toLocaleString() + ' raw points (' + sourceResolutionLabel + ')';
          }

          return 'Showing ' + displayPointCount.toLocaleString() + ' of ' + rawPointCount.toLocaleString() +
            ' raw points (downsample x' + downsampleFactor + ', ' + sourceResolutionLabel + ')';
        }

        function renderPressureViewport() {
          const [min, max] = resolvePressureViewport();
          const sample = buildPressureViewportSample(
            pressureRawDataX,
            pressureRawData972b,
            pressureRawData902b,
            min,
            max,
            1000,
            pressureRawIndexOffset
          );
          const normalizedPressure972bVals =
            normalizePressureSeriesForLogScale(sample.pressure972bVals);
          const normalizedPressure902bVals = currentPressureView === 'short'
            ? normalizePressureSeriesForLogScale(sample.pressure902bVals)
            : new Array(sample.xVals.length).fill(null);

          applyingPressureViewport = true;
          pressureChart.batch(() => {
            pressureChart.setData(
              [sample.xVals, normalizedPressure972bVals, normalizedPressure902bVals],
              false
            );
            if (Number.isFinite(min) && Number.isFinite(max) && max > min) {
              pressureChart.setScale('x', { min, max });
            } else {
              pressureChart.setScale('x', { min: null, max: null });
            }
            pressureChart.setScale('y', { min: null, max: null });
          });
          applyingPressureViewport = false;
          pressureChartStatus.textContent = formatPressureChartStatus({
            ...sample,
            sourceResolutionLabel: pressureSourceResolutionLabel,
          });
          updatePressureChartViewText();
          updatePressureSeriesVisibility();
        }

        function schedulePressureViewportRender() {
          if (pressureViewportRenderFrame !== null) return;
          pressureViewportRenderFrame = window.requestAnimationFrame(() => {
            pressureViewportRenderFrame = null;
            renderPressureViewport();
          });
        }

        function replacePressureRawData(chartData) {
          pressureRawDataX = Array.isArray(chartData.xVals) ? chartData.xVals.slice() : [];
          pressureRawData972b = Array.isArray(chartData.pressure972bVals)
            ? chartData.pressure972bVals.slice()
            : [];
          pressureRawData902b =
            chartData.view === 'short' && Array.isArray(chartData.pressure902bVals)
              ? chartData.pressure902bVals.slice()
              : [];
          pressureRawCursor = chartData.cursor;
          pressureRawIndexOffset = chartData.cacheStartIndex;
          pressureRawMaxPoints = Number(chartData.maxDataPoints) || pressureRawMaxPoints;
          pressureSourceResolutionLabel = chartData.sourceResolutionLabel || pressureSourceResolutionLabel;
          pressureMinimumXSpan = getMinimumPressureXSpan(pressureRawDataX);
          renderPressureViewport();
        }

        function appendPressureRawData(chartData) {
          const xVals = Array.isArray(chartData.xVals) ? chartData.xVals : [];
          const pressure972bVals = Array.isArray(chartData.pressure972bVals)
            ? chartData.pressure972bVals
            : [];
          const pressure902bVals = Array.isArray(chartData.pressure902bVals)
            ? chartData.pressure902bVals
            : [];
          const nextCacheStartIndex = Number(chartData.cacheStartIndex);
          const expiredPointCount = Number.isInteger(nextCacheStartIndex)
            ? Math.max(0, nextCacheStartIndex - pressureRawIndexOffset)
            : 0;
          if (expiredPointCount > 0) {
            pressureRawDataX.splice(0, expiredPointCount);
            pressureRawData972b.splice(0, expiredPointCount);
            pressureRawData902b.splice(0, expiredPointCount);
          }
          pressureRawDataX.push(...xVals);
          pressureRawData972b.push(...pressure972bVals);
          if (currentPressureView === 'short') {
            pressureRawData902b.push(...pressure902bVals);
          }
          const overflow = pressureRawDataX.length - pressureRawMaxPoints;
          if (overflow > 0) {
            pressureRawDataX.splice(0, overflow);
            pressureRawData972b.splice(0, overflow);
            pressureRawData902b.splice(0, overflow);
          }
          pressureRawCursor = chartData.cursor;
          pressureRawIndexOffset = chartData.cacheStartIndex;
          renderPressureViewport();
        }

        async function loadPressureRawSnapshot(view = currentPressureView) {
          const generation = ++pressureSnapshotGeneration;
          const chartData = await fetchJsonWithTimeout(
            '/chart-data?view=' + view + '&raw=1',
            PRESSURE_SNAPSHOT_TIMEOUT_MS
          );
          if (
            generation !== pressureSnapshotGeneration ||
            view !== currentPressureView ||
            chartData.view !== view
          ) return null;
          replacePressureRawData(chartData);
          return view;
        }

        async function refreshPressureRawData() {
          if (pressureRawRefreshInFlight) return null;
          pressureRawRefreshInFlight = true;
          const requestedView = currentPressureView;
          const requestedCursor = pressureRawCursor;

          try {
            if (!Number.isInteger(requestedCursor)) {
              return await loadPressureRawSnapshot(requestedView);
            }

            const url = '/chart-data?view=' + requestedView + '&raw=1&cursor=' + requestedCursor;
            const chartData = await fetchJsonWithTimeout(url);
            if (requestedView !== currentPressureView || requestedCursor !== pressureRawCursor) return null;
            if (chartData.view !== requestedView) return null;
            if (chartData.resetRequired) return await loadPressureRawSnapshot(requestedView);
            appendPressureRawData(chartData);
            return requestedView;
          } finally {
            pressureRawRefreshInFlight = false;
          }
        }

        function updatePressureChartViewText() {
          if (currentPressureView === 'short') {
            const rangeLabel = pressureViewportKind === 'custom'
              ? 'Custom range'
              : 'Last ' + selectedLiveHours + 'h';
            pressureChartLabel.textContent = 'Short-Term (' + rangeLabel + ', ~3s source data, downsampled for display)';
            pressureViewToggle.textContent = 'Switch to Historical View';
            pressureTimeRangeGroup.hidden = false;
            pressureTimeRange.value = pressureViewportKind === 'custom'
              ? 'custom'
              : String(selectedLiveHours);
          } else {
            const rangeLabel = pressureViewportKind === 'custom' ? 'Custom range' : 'All-time';
            pressureChartLabel.textContent = 'Historical (' + rangeLabel + ', 1-min averaged source data)';
            pressureViewToggle.textContent = 'Switch to Live View';
            pressureTimeRangeGroup.hidden = true;
          }
        }

        function updatePressureSeriesVisibility() {
          if (!pressureChart) return;

          const isLiveView = currentPressureView === 'short';
          const legendRows = pressureChart.root.querySelectorAll('.u-legend .u-series');
          const pressure902bLegendRow = legendRows[2];

          if (!isLiveView && !pressure902bSuppressedForHistorical) {
            pressure902bLiveVisible = pressureChart.series[2].show !== false;
            pressureChart.setSeries(2, { show: false });
            pressure902bSuppressedForHistorical = true;
          } else if (isLiveView && pressure902bSuppressedForHistorical) {
            pressureChart.setSeries(2, { show: pressure902bLiveVisible });
            pressure902bSuppressedForHistorical = false;
          }

          if (pressure902bLegendRow) {
            pressure902bLegendRow.style.display = isLiveView ? '' : 'none';
          }
        }

        function setPressureInteractionMode(mode) {
          pressureInteractionMode = mode === 'pan' ? 'pan' : 'zoom';
          const isPanMode = pressureInteractionMode === 'pan';
          pressureChartRoot.classList.toggle('is-pan-mode', isPanMode);
          pressureZoomMode.classList.toggle('is-active', !isPanMode);
          pressurePanMode.classList.toggle('is-active', isPanMode);
          pressureZoomMode.setAttribute('aria-pressed', String(!isPanMode));
          pressurePanMode.setAttribute('aria-pressed', String(isPanMode));

          if (pressureChart) {
            pressureChart.setSelect({ left: 0, top: 0, width: 0, height: 0 }, false);
          }
        }

        function resetPressureViewport() {
          pressureCustomRange = null;
          pressureViewportKind = currentPressureView === 'short' ? 'preset' : 'all';
          renderPressureViewport();
        }

        pressureViewToggle.addEventListener('click', async () => {
          const nextPressureView = currentPressureView === 'short' ? 'long' : 'short';
          pressureViewToggle.disabled = true;

          try {
            currentPressureView = nextPressureView;
            pressureCustomRange = null;
            pressureViewportKind = currentPressureView === 'short' ? 'preset' : 'all';
            pressureRawCursor = null;
            await loadPressureRawSnapshot(currentPressureView);
          } catch (e) {
            console.error('Failed to load chart data:', e);
          } finally {
            pressureViewToggle.disabled = false;
          }
        });

        pressureTimeRange.addEventListener('change', () => {
          if (pressureTimeRange.value === 'custom') return;
          selectedLiveHours = Number(pressureTimeRange.value);
          pressureCustomRange = null;
          pressureViewportKind = 'preset';
          renderPressureViewport();
        });

        pressureZoomMode.addEventListener('click', () => setPressureInteractionMode('zoom'));
        pressurePanMode.addEventListener('click', () => setPressureInteractionMode('pan'));
        pressureResetView.addEventListener('click', resetPressureViewport);

        setPressureInteractionMode('zoom');
        renderPressureViewport();
        loadPressureRawSnapshot().catch((e) => console.error('Failed to load raw chart data:', e));
      </script>

      <div id="ccs-charts-section">
        <div id="ccs-chart-A"></div>
        <div id="ccs-chart-B"></div>
        <div id="ccs-chart-C"></div>
      </div>

      <script>
        ${ccsTimeWindowBoundsSource}

        let ccsViewportNow = ${Date.now() / 1000};

        function setCCSChartTimeWindow(chart, nowSec = ccsViewportNow) {
          const [min, max] = getCCSTimeWindowBounds(nowSec);
          chart.setScale('x', { min, max });
        }

        function updateCCSChartTimeWindows(nowSec = ccsViewportNow) {
          ccsViewportNow = Number.isFinite(nowSec) ? nowSec : Date.now() / 1000;
          setCCSChartTimeWindow(ccsChartA, ccsViewportNow);
          setCCSChartTimeWindow(ccsChartB, ccsViewportNow);
          setCCSChartTimeWindow(ccsChartC, ccsViewportNow);
        }

        function createCCSUplotChart(container, config) {
          if (typeof container === 'string') container = document.querySelector(container);

          const {
            title = "CCS Temperature",
            data = [[], []],
            seriesLabel = "Temp (°C)",
            stroke = '#f97316',
          } = config;

          const wrapper = document.createElement('div');
          wrapper.className = 'chart-container';
          wrapper.innerHTML = \`
            <div class="chart-title">\${title}</div>
            <div class="chart"></div>
          \`;
          container.appendChild(wrapper);

          const chartEl = wrapper.querySelector('.chart');

          const uplot = new uPlot({
            width: wrapper.clientWidth,
            height: 250,
            series: [
              {},
              {
                label: seriesLabel,
                value: (u, v) => v == null ? "" : v.toFixed(1) + " °C",
                stroke,
                points: { show: false },
              }
            ],
            scales: { x: { time: true }, y: { auto: true } },
            axes: [
              {
                stroke: '#94a3b8',
                font: '10px Arial',
                ticks: { stroke: 'rgba(255,255,255,0.15)', width: 1 },
                grid:  { stroke: 'rgba(255,255,255,0.06)', width: 1 },
              },
              {
                label: '°C',
                labelSize: 18,
                labelFont: '10px Arial',
                stroke: '#94a3b8',
                font: '10px Arial',
                size: 50,
                values: (u, vals) => vals.map(v => v != null ? v.toFixed(1) : ""),
                ticks: { stroke: 'rgba(255,255,255,0.15)', width: 1 },
                grid:  { stroke: 'rgba(255,255,255,0.06)', width: 1 },
              },
            ],
            cursor: {
              focus: { prox: 16 },
              drag: { x: true, y: false, setScale: true },
            },
          }, data, chartEl);

          window.addEventListener('resize', () => {
            uplot.setSize({ width: wrapper.clientWidth, height: 250 });
          });

          chartEl.ondblclick = () => {
            setCCSChartTimeWindow(uplot);
          };

          return uplot;
        }

        let ccsChartA = createCCSUplotChart(document.getElementById('ccs-chart-A'), {
          title: 'Cathode A \u2014 Clamp Temperature',
          data: [${JSON.stringify(ccsGraphA.xVals)}, ${JSON.stringify(ccsGraphA.yVals)}],
          seriesLabel: 'Temp A (°C)',
          stroke: '#f97316',
        });
        let ccsChartB = createCCSUplotChart(document.getElementById('ccs-chart-B'), {
          title: 'Cathode B \u2014 Clamp Temperature',
          data: [${JSON.stringify(ccsGraphB.xVals)}, ${JSON.stringify(ccsGraphB.yVals)}],
          seriesLabel: 'Temp B (°C)',
          stroke: '#22c55e',
        });
        let ccsChartC = createCCSUplotChart(document.getElementById('ccs-chart-C'), {
          title: 'Cathode C \u2014 Clamp Temperature',
          data: [${JSON.stringify(ccsGraphC.xVals)}, ${JSON.stringify(ccsGraphC.yVals)}],
          seriesLabel: 'Temp C (°C)',
          stroke: '#fca5a5',
        });
        updateCCSChartTimeWindows();
      </script>

      <!-- Log Viewer -->
      <div class="env-section">
        <div class="log-viewer-header">
          <h3 class="dashboard-subtitle env-title log-viewer-title">Recent Log (last 30 min); Last Update: <span id="display-last-updated">${
              state.displayLogLastModified
                ? new Date(state.displayLogLastModified).toLocaleString("en-US", {
                    hour12: true,
                    timeZone: "America/Chicago"
                  })
                : "N/A"
          }</span></h3>
          <button id="toggleButton" class="btn-toggle log-toggle-button">Show Recent Log</button>
        </div>
        <div id="fullContent" class="content-section">
          <pre></pre>
        </div>
      </div>
      <!-- Auto-refresh & Toggle Script -->
      <script>

         let savedState = sessionStorage.getItem('showingFull');
         let showingFull = savedState === 'true';

         const toggleButton = document.getElementById('toggleButton');
         const fullSection = document.getElementById('fullContent');
          const pre = fullSection.querySelector('pre')

         async function loadRecentLogSnippet() {
          try {
            const response = await fetch('/raw');
            if (!response.ok) {
              pre.textContent = 'No recent log snippet cached yet.';
              return;
            }

            const text = await response.text();
            pre.textContent = text || 'No recent log snippet cached yet.';
          } catch (error) {
            console.error('Failed to load recent log snippet:', error);
            pre.textContent = 'Unable to load recent log snippet.';
          }
         }

         if (showingFull) {
          fullSection.classList.add('active');
          toggleButton.textContent = 'Hide Recent Log';
          loadRecentLogSnippet();
        }

        function hasLivePowerSupplyNumber(value) {
          return value !== null && typeof value !== 'undefined' && Number.isFinite(Number(value));
        }

        function formatPowerSupplyVoltage(value, scale, isRunning) {
          if (!isRunning || !hasLivePowerSupplyNumber(value)) {
            return '--';
          }

          const numericValue = Number(value);
          return scale === 'kv'
            ? (numericValue / 1000).toFixed(2) + 'kV'
            : numericValue.toFixed(0) + ' V';
        }

        function formatPowerSupplyCurrent(value, isRunning) {
          if (!isRunning || !hasLivePowerSupplyNumber(value)) {
            return '--';
          }

          return Number(value).toFixed(2) + ' mA';
        }

        function formatPressureValue(value, isRunning) {
          if (!isRunning || value === null || typeof value === 'undefined') {
            return '-- mbar';
          }

          const numericValue = Number(value);
          return Number.isFinite(numericValue)
            ? numericValue.toExponential(3) + ' mbar'
            : '-- mbar';
        }

        function updatePowerSupplyOutput(id, outputEnabled, isRunning) {
          const elem = document.getElementById(id);
          if (!elem) return;

          elem.classList.add('power-supply-output');
          elem.classList.remove(
            'power-supply-output-enabled',
            'power-supply-output-disabled',
            'power-supply-output-unknown'
          );

          if (!isRunning || outputEnabled === null || typeof outputEnabled === 'undefined') {
            elem.classList.add('power-supply-output-unknown');
            elem.textContent = 'Output: --';
            return;
          }

          const enabled = outputEnabled === true || outputEnabled === 1 ||
            outputEnabled === 'true' || outputEnabled === '1';

          elem.classList.add(enabled ? 'power-supply-output-enabled' : 'power-supply-output-disabled');
          elem.textContent = 'Output: ' + (enabled ? 'Enabled' : 'Disabled');
        }

        async function pollDashboard() {
          try {

          const data = await fetchJsonWithTimeout('/data');

          const interlockIds = ['sic-door', 'sic-water', 'sic-vacuum-power', 'sic-vacuum-pressure', 'sic-oil-low', 'sic-oil-high', 'sic-estop', 'sic-estopExt', 'all-interlocks', 'g9-output', 'hvolt'];
          const vacuumIds = ['vac-indicator-0', 'vac-indicator-1', 'vac-indicator-2', 'vac-indicator-3', 'vac-indicator-4', 'vac-indicator-5', 'vac-indicator-6', 'vac-indicator-7'];

          const statusDiv = document.getElementById('experiment-status');

          const logLastModified = document.getElementById('log-last-modified');
          const displayLastModified = document.getElementById('display-last-updated');

          const dateObject1 = data.webMonitorLastModified? new Date(data.webMonitorLastModified) : null;
          const dateObject2 = data.displayLogLastModified? new Date(data.displayLogLastModified) : null;

          const clean_string_1 = dateObject1? dateObject1.toLocaleString("en-US", {
            hour12: true,
            timeZone: "America/Chicago"
          }) : "N/A";

          const clean_string_2 = dateObject2? dateObject2.toLocaleString("en-US", {
            hour12: true,
            timeZone: "America/Chicago"
          }) : "N/A";

          logLastModified.textContent = clean_string_1;
          displayLastModified.textContent = clean_string_2;

          const now = Date.now();

          const THRESHOLD = 2 * 60 * 1000;

          let experimentRunning = (now - dateObject1) <= THRESHOLD;

          statusDiv.textContent = experimentRunning
          ? 'Dashboard is running'
          : 'Dashboard is not running';

          statusDiv.classList.toggle('neon-success', experimentRunning);
          statusDiv.classList.toggle('neon-warning', !experimentRunning);

          interlockIds.forEach((id, i) => {
            const elem = document.getElementById(id);
            elem.style.backgroundColor = experimentRunning ? data.sicColors[i] : 'grey';
          });

          vacuumIds.forEach((id, i) => {
            const elem = document.getElementById(id);
            elem.style.backgroundColor = experimentRunning ? data.vacuumColors[i] : 'grey';
          });

          const pressure972b = document.getElementById('pressure972b');
          const pressure902b = document.getElementById('pressure902b');

          const webMonitorLastModified = document.getElementById('log-last-modified');

          const heaterCurrentA = document.getElementById('heaterCurrentA');
          const heaterCurrentB = document.getElementById('heaterCurrentB');
          const heaterCurrentC = document.getElementById('heaterCurrentC');

          const heaterVoltageA = document.getElementById('heaterVoltageA');
          const heaterVoltageB = document.getElementById('heaterVoltageB');
          const heaterVoltageC = document.getElementById('heaterVoltageC');

          const heaterTemperatureA = document.getElementById('heaterTemperatureA');
          const heaterTemperatureB = document.getElementById('heaterTemperatureB');
          const heaterTemperatureC = document.getElementById('heaterTemperatureC');

          const siteLastUpdated = document.getElementById('site-last-updated');

          const sensor1 = document.getElementById('sensor-1');
          const sensor2 = document.getElementById('sensor-2');
          const sensor3 = document.getElementById('sensor-3');
          const sensor4 = document.getElementById('sensor-4');
          const sensor5 = document.getElementById('sensor-5');
          const sensor6 = document.getElementById('sensor-6');

          heaterCurrentA.textContent = (data.heaterCurrent_A !== null && data.heaterCurrent_A !== undefined && experimentRunning? "Current: " + Number(data.heaterCurrent_A).toFixed(2) + " A" : "Current: " + "--");
          heaterCurrentB.textContent = (data.heaterCurrent_B !== null && data.heaterCurrent_B !== undefined && experimentRunning? "Current: " + Number(data.heaterCurrent_B).toFixed(2) + " A" : "Current: " + "--");
          heaterCurrentC.textContent = (data.heaterCurrent_C !== null && data.heaterCurrent_C !== undefined && experimentRunning? "Current: " + Number(data.heaterCurrent_C).toFixed(2) + " A" : "Current: " + "--");

          heaterVoltageA.textContent = (data.heaterVoltage_A !== null && data.heaterVoltage_A !== undefined && experimentRunning? "Voltage: " + Number(data.heaterVoltage_A).toFixed(2) + " V" : "Voltage: " + "--");
          heaterVoltageB.textContent = (data.heaterVoltage_B !== null && data.heaterVoltage_B !== undefined && experimentRunning? "Voltage: " + Number(data.heaterVoltage_B).toFixed(2) + " V" : "Voltage: " + "--");
          heaterVoltageC.textContent = (data.heaterVoltage_C !== null && data.heaterVoltage_C !== undefined && experimentRunning? "Voltage: " + Number(data.heaterVoltage_C).toFixed(2) + " V" : "Voltage: " + "--");

          heaterTemperatureA.textContent = (data.clamp_temperature_A !== null && data.clamp_temperature_A !== undefined && experimentRunning? "Clamp Temperature: " + Math.round(Number(data.clamp_temperature_A)) + "°C" : "Clamp Temperature: " + "--");
          heaterTemperatureB.textContent = (data.clamp_temperature_B !== null && data.clamp_temperature_B !== undefined && experimentRunning? "Clamp Temperature: " + Math.round(Number(data.clamp_temperature_B)) + "°C" : "Clamp Temperature: " + "--");
          heaterTemperatureC.textContent = (data.clamp_temperature_C !== null && data.clamp_temperature_C !== undefined && experimentRunning? "Clamp Temperature: " + Math.round(Number(data.clamp_temperature_C)) + "°C" : "Clamp Temperature: " + "--");

          // Update power-supply cards (Pos1: pos_1kv)
          const powerSupplySetVoltagePos1 = document.getElementById('powerSupplySetVoltagePos1');
          const powerSupplyMeasuredVoltagePos1 = document.getElementById('powerSupplyMeasuredVoltagePos1');
          const powerSupplyMeasuredCurrentPos1 = document.getElementById('powerSupplyMeasuredCurrentPos1');
          updatePowerSupplyOutput('powerSupplyOutputPos1', data.pos_1kv_output, experimentRunning);
          if (powerSupplySetVoltagePos1) powerSupplySetVoltagePos1.textContent = 'Set Voltage: ' + formatPowerSupplyVoltage(data.pos_1kv_set, 'v', experimentRunning);
          if (powerSupplyMeasuredVoltagePos1) powerSupplyMeasuredVoltagePos1.textContent = 'Measured Voltage: ' + formatPowerSupplyVoltage(data.pos_1kv_hv, 'v', experimentRunning);
          if (powerSupplyMeasuredCurrentPos1) powerSupplyMeasuredCurrentPos1.textContent = 'Measured Current: ' + formatPowerSupplyCurrent(data.pos_1kv_i, experimentRunning);

          // Update power-supply cards (Neg1: neg_1kv)
          const powerSupplySetVoltageNeg1 = document.getElementById('powerSupplySetVoltageNeg1');
          const powerSupplyMeasuredVoltageNeg1 = document.getElementById('powerSupplyMeasuredVoltageNeg1');
          const powerSupplyMeasuredCurrentNeg1 = document.getElementById('powerSupplyMeasuredCurrentNeg1');
          updatePowerSupplyOutput('powerSupplyOutputNeg1', data.neg_1kv_output, experimentRunning);
          if (powerSupplySetVoltageNeg1) powerSupplySetVoltageNeg1.textContent = 'Set Voltage: ' + formatPowerSupplyVoltage(data.neg_1kv_set, 'v', experimentRunning);
          if (powerSupplyMeasuredVoltageNeg1) powerSupplyMeasuredVoltageNeg1.textContent = 'Measured Voltage: ' + formatPowerSupplyVoltage(data.neg_1kv_hv, 'v', experimentRunning);
          if (powerSupplyMeasuredCurrentNeg1) powerSupplyMeasuredCurrentNeg1.textContent = 'Measured Current: ' + formatPowerSupplyCurrent(data.neg_1kv_i, experimentRunning);

          // Update power-supply cards (B20: pos_20kv)
          const powerSupplySetVoltageB20 = document.getElementById('powerSupplySetVoltageB20');
          const powerSupplyMeasuredVoltageB20 = document.getElementById('powerSupplyMeasuredVoltageB20');
          const powerSupplyMeasuredCurrentB20 = document.getElementById('powerSupplyMeasuredCurrentB20');
          updatePowerSupplyOutput('powerSupplyOutputB20', data.pos_20kv_output, experimentRunning);
          if (powerSupplySetVoltageB20) powerSupplySetVoltageB20.textContent = 'Set Voltage: ' + formatPowerSupplyVoltage(data.pos_20kv_set, 'kv', experimentRunning);
          if (powerSupplyMeasuredVoltageB20) powerSupplyMeasuredVoltageB20.textContent = 'Measured Voltage: ' + formatPowerSupplyVoltage(data.pos_20kv_hv, 'kv', experimentRunning);
          if (powerSupplyMeasuredCurrentB20) powerSupplyMeasuredCurrentB20.textContent = 'Measured Current: ' + formatPowerSupplyCurrent(data.pos_20kv_i, experimentRunning);

          // Update power-supply cards (B3: pos_3kv)
          const powerSupplySetVoltageB3 = document.getElementById('powerSupplySetVoltageB3');
          const powerSupplyMeasuredVoltageB3 = document.getElementById('powerSupplyMeasuredVoltageB3');
          const powerSupplyMeasuredCurrentB3 = document.getElementById('powerSupplyMeasuredCurrentB3');
          updatePowerSupplyOutput('powerSupplyOutputB3', data.pos_3kv_output, experimentRunning);
          if (powerSupplySetVoltageB3) powerSupplySetVoltageB3.textContent = 'Set Voltage: ' + formatPowerSupplyVoltage(data.pos_3kv_set, 'kv', experimentRunning);
          if (powerSupplyMeasuredVoltageB3) powerSupplyMeasuredVoltageB3.textContent = 'Measured Voltage: ' + formatPowerSupplyVoltage(data.pos_3kv_hv, 'kv', experimentRunning);
          if (powerSupplyMeasuredCurrentB3) powerSupplyMeasuredCurrentB3.textContent = 'Measured Current: ' + formatPowerSupplyCurrent(data.pos_3kv_i, experimentRunning);

          const dateObj = new Date(data.siteLastUpdated);
          const serverNowMs = Date.parse(data.siteLastUpdated);
          pressureViewportNow = Number.isFinite(serverNowMs)
            ? serverNowMs / 1000
            : Date.now() / 1000;
          ccsViewportNow = pressureViewportNow;
          if (pressureViewportKind !== 'custom') {
            schedulePressureViewportRender();
          }
          const clean_string = dateObj.toLocaleString("en-US", {
            hour12: true,
            timeZone: "America/Chicago"
          });
          siteLastUpdated.textContent = clean_string;

          pressure972b.textContent =
            '972B: ' + formatPressureValue(data.pressure, experimentRunning);
          pressure902b.textContent =
            '902B: ' + formatPressureValue(data.pressure_902b_mbar, experimentRunning);
          sensor1.querySelector('.gauge-cover').textContent = (!data.temperatures || !data.temperatures["1"] || data.temperatures["1"] === "DISCONNECTED" || data.temperatures["1"] === "None" && !experimentRunning) ? '--' : data.temperatures["1"] + '°C';
          sensor2.querySelector('.gauge-cover').textContent = (!data.temperatures || !data.temperatures["2"] || data.temperatures["2"] === "DISCONNECTED" || data.temperatures["2"] === "None" && !experimentRunning) ? '--' : data.temperatures["2"] + '°C';
          sensor3.querySelector('.gauge-cover').textContent = (!data.temperatures || !data.temperatures["3"] || data.temperatures["3"] === "DISCONNECTED" || data.temperatures["3"] === "None" && !experimentRunning) ? '--' : data.temperatures["3"] + '°C';
          sensor4.querySelector('.gauge-cover').textContent = (!data.temperatures || !data.temperatures["4"] || data.temperatures["4"] === "DISCONNECTED" || data.temperatures["4"] === "None" && !experimentRunning) ? '--' : data.temperatures["4"] + '°C';
          sensor5.querySelector('.gauge-cover').textContent = (!data.temperatures || !data.temperatures["5"] || data.temperatures["5"] === "DISCONNECTED" || data.temperatures["5"] === "None" && !experimentRunning) ? '--' : data.temperatures["5"] + '°C';
          sensor6.querySelector('.gauge-cover').textContent = (!data.temperatures || !data.temperatures["6"] || data.temperatures["6"] === "DISCONNECTED" || data.temperatures["6"] === "None" && !experimentRunning) ? '--' : data.temperatures["6"] + '°C';



          console.log(sensor1.textContent);
          console.log(data.sicColors);

          // Live chart update
          const shouldUpdateLongTerm = Date.now() - lastLongTermPollAt >= LONG_TERM_POLL_INTERVAL_MS;

          if (currentPressureView === 'short' || (currentPressureView === 'long' && shouldUpdateLongTerm)) {
            try {
              const refreshedView = await refreshPressureRawData();
              if (refreshedView === 'long') lastLongTermPollAt = Date.now();
            } catch (e) {
              console.error('Chart data update failed:', e);
            }
          }

          try {
            const ccsData = await fetchJsonWithTimeout('/ccs-chart-data');
            ccsChartA.setData([ccsData.A.xVals, ccsData.A.yVals]);
            ccsChartB.setData([ccsData.B.xVals, ccsData.B.yVals]);
            ccsChartC.setData([ccsData.C.xVals, ccsData.C.yVals]);
          } catch (e) {
            console.error('CCS chart data update failed:', e);
          } finally {
            updateCCSChartTimeWindows(ccsViewportNow);
          }

          } catch (error) {
            console.error('Failed to load the dashboard!', error);
          } finally {
            setTimeout(pollDashboard, 3000);
          }
        }

        setTimeout(pollDashboard, 3000);

        toggleButton.addEventListener('click', async () => {
          if (!showingFull) {
            pre.textContent = 'Loading recent log snippet...';
            fullSection.classList.add('active');
            await loadRecentLogSnippet();
            toggleButton.textContent = 'Hide Recent Log';
          } else {
            fullSection.classList.remove('active');
            toggleButton.textContent = 'Show Recent Log';
          }
          showingFull = !showingFull;
          sessionStorage.setItem('showingFull', showingFull);
        })
      </script>

      <!-- Experiment Reset Modal -->
      <div id="reset-modal-overlay" style="display:none; position:fixed; inset:0; background:rgba(0,0,0,0.75); z-index:9999; align-items:center; justify-content:center;">
        <div style="background:#1e293b; border:1px solid #ef4444; border-radius:12px; padding:28px 32px; max-width:420px; width:90%; text-align:left; box-shadow:0 0 32px rgba(239,68,68,0.4);">
          <h3 style="color:#fca5a5; margin:0 0 12px 0; font-size:1.1rem; font-weight:700;">Experiment Reset</h3>
          <p style="color:#cbd5e1; font-size:0.85rem; margin:0 0 18px 0;">
            This will permanently delete all data from the long-term pressure log.
            This action <strong style="color:#ef4444;">cannot be undone</strong>.
          </p>
          <input id="reset-password-input" type="password" placeholder='Password'
            style="width:100%; padding:8px 10px; border-radius:6px; border:1px solid #475569; background:#0f172a; color:#e2e8f0; font-size:0.85rem; margin-bottom:16px; box-sizing:border-box;" />
          <div id="reset-modal-message" style="font-size:0.8rem; margin-bottom:12px; min-height:1em;"></div>
          <div style="display:flex; gap:10px; justify-content:flex-end;">
            <button id="reset-cancel-btn" style="padding:7px 18px; border-radius:6px; border:1px solid #475569; background:transparent; color:#94a3b8; cursor:pointer; font-size:0.85rem;">Cancel</button>
            <button id="reset-confirm-btn" disabled style="padding:7px 18px; border-radius:6px; border:1px solid #ef4444; background:#7f1d1d; color:#fca5a5; cursor:not-allowed; font-size:0.85rem; font-weight:bold; opacity:0.5;">Reset</button>
          </div>
        </div>
      </div>

      <script>
        (function () {
          const overlay = document.getElementById('reset-modal-overlay');
          const openBtn = document.getElementById('open-reset-modal');
          const cancelBtn = document.getElementById('reset-cancel-btn');
          const confirmBtn = document.getElementById('reset-confirm-btn');
          const passwordInput = document.getElementById('reset-password-input');
          const msg = document.getElementById('reset-modal-message');

          function setReady() {
            const ready = passwordInput.value.length > 0;
            confirmBtn.disabled = !ready;
            confirmBtn.style.opacity = ready ? '1' : '0.5';
            confirmBtn.style.cursor = ready ? 'pointer' : 'not-allowed';
          }

          function openModal() {
            passwordInput.value = '';
            msg.textContent = '';
            msg.style.color = '';
            confirmBtn.disabled = true;
            confirmBtn.style.opacity = '0.5';
            confirmBtn.style.cursor = 'not-allowed';
            overlay.style.display = 'flex';
          }

          function closeModal() {
            overlay.style.display = 'none';
          }

          openBtn.addEventListener('click', openModal);
          cancelBtn.addEventListener('click', closeModal);
          overlay.addEventListener('click', function (e) {
            if (e.target === overlay) closeModal();
          });

          passwordInput.addEventListener('input', setReady);

          confirmBtn.addEventListener('click', async function () {
            confirmBtn.disabled = true;
            confirmBtn.style.opacity = '0.5';
            msg.style.color = '#94a3b8';
            msg.textContent = 'Resetting…';
            try {
              const res = await fetch('/experiment-reset', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: passwordInput.value }),
              });
              if (res.ok) {
                msg.style.color = '#22c55e';
                msg.textContent = 'Reset successful. Short-term and long-term pressure logs cleared.';
                setTimeout(closeModal, 1500);
              } else {
                const body = await res.json().catch(() => ({}));
                msg.style.color = '#ef4444';
                msg.textContent = 'Error: ' + (body.error || res.statusText);
                confirmBtn.disabled = false;
                confirmBtn.style.opacity = '1';
                confirmBtn.style.cursor = 'pointer';
              }
            } catch (err) {
              msg.style.color = '#ef4444';
              msg.textContent = 'Network error: ' + err.message;
              confirmBtn.disabled = false;
              confirmBtn.style.opacity = '1';
              confirmBtn.style.cursor = 'pointer';
            }
          });
        })();
      </script>
    </body>
    </html>
  `;
}

module.exports = {
  fetchJsonWithTimeout,
  renderDashboard,
  normalizePressureSeriesForLogScale,
  getPaddedPressureLogRange,
  filterPressureLogGridSplits,
  getPressureTimeWindowBounds,
  clampPressureViewportRange,
  getCCSTimeWindowBounds,
  buildPressureViewportSample,
};
