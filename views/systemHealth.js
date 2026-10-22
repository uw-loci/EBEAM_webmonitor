function renderSystemHealthPage(options = {}) {
  const memoryLimitMb = Number(options.memoryLimitMb) || 512;

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>E-Beam Memory &amp; System Health</title>
      <style>
        :root {
          color-scheme: dark;
          --bg: #080d18;
          --surface: rgba(18, 29, 49, 0.92);
          --surface-alt: rgba(30, 45, 70, 0.7);
          --border: rgba(148, 163, 184, 0.2);
          --text: #e2e8f0;
          --muted: #94a3b8;
          --blue: #38bdf8;
          --purple: #a78bfa;
          --green: #34d399;
          --orange: #fb923c;
          --red: #f87171;
        }

        * { box-sizing: border-box; }

        body {
          margin: 0;
          min-height: 100vh;
          color: var(--text);
          background:
            radial-gradient(circle at 15% 0%, rgba(56, 189, 248, 0.12), transparent 32rem),
            radial-gradient(circle at 90% 10%, rgba(167, 139, 250, 0.1), transparent 28rem),
            var(--bg);
          font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }

        a { color: inherit; }

        .page-shell {
          width: min(1180px, calc(100% - 32px));
          margin: 0 auto;
          padding: 28px 0 48px;
        }

        .topbar {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 20px;
          margin-bottom: 22px;
        }

        .eyebrow {
          color: var(--blue);
          font-size: 0.75rem;
          font-weight: 700;
          letter-spacing: 0.12em;
          text-transform: uppercase;
        }

        h1 {
          margin: 5px 0 7px;
          color: #f8fafc;
          font-size: clamp(1.7rem, 4vw, 2.55rem);
          letter-spacing: -0.03em;
        }

        .subtitle {
          max-width: 720px;
          margin: 0;
          color: var(--muted);
          font-size: 0.95rem;
          line-height: 1.55;
        }

        .button-row {
          display: flex;
          flex-wrap: wrap;
          justify-content: flex-end;
          gap: 9px;
        }

        .button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-height: 38px;
          padding: 8px 14px;
          border: 1px solid var(--border);
          border-radius: 8px;
          background: rgba(15, 23, 42, 0.82);
          color: var(--text);
          font: inherit;
          font-size: 0.85rem;
          font-weight: 650;
          text-decoration: none;
          cursor: pointer;
        }

        .button:hover, .button:focus-visible {
          border-color: rgba(56, 189, 248, 0.65);
          background: rgba(30, 41, 59, 0.95);
          outline: none;
        }

        .status-strip {
          display: flex;
          align-items: center;
          gap: 10px;
          min-height: 42px;
          margin-bottom: 16px;
          padding: 9px 12px;
          border: 1px solid var(--border);
          border-radius: 9px;
          background: rgba(15, 23, 42, 0.66);
          color: var(--muted);
          font-size: 0.83rem;
        }

        .status-dot {
          width: 10px;
          height: 10px;
          flex: 0 0 auto;
          border-radius: 50%;
          background: var(--orange);
          box-shadow: 0 0 10px currentColor;
        }

        .status-strip.is-good .status-dot { color: var(--green); background: var(--green); }
        .status-strip.is-warning .status-dot { color: var(--orange); background: var(--orange); }
        .status-strip.is-danger .status-dot { color: var(--red); background: var(--red); }

        .summary-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 12px;
          margin-bottom: 16px;
        }

        .summary-card, .panel {
          border: 1px solid var(--border);
          border-radius: 12px;
          background: var(--surface);
          box-shadow: 0 14px 36px rgba(0, 0, 0, 0.16);
        }

        .summary-card { padding: 15px; }

        .summary-label {
          margin-bottom: 7px;
          color: var(--muted);
          font-size: 0.72rem;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .summary-value {
          font-size: clamp(1.35rem, 3vw, 2rem);
          font-weight: 750;
          letter-spacing: -0.035em;
        }

        .summary-context {
          margin-top: 5px;
          color: var(--muted);
          font-size: 0.76rem;
        }

        .meter {
          height: 6px;
          margin-top: 12px;
          overflow: hidden;
          border-radius: 999px;
          background: rgba(148, 163, 184, 0.16);
        }

        .meter-fill {
          width: 0;
          height: 100%;
          border-radius: inherit;
          background: var(--blue);
          transition: width 180ms ease;
        }

        .chart-grid {
          display: grid;
          grid-template-columns: minmax(0, 1.35fr) minmax(320px, 0.85fr);
          gap: 16px;
          margin-bottom: 16px;
        }

        .panel { padding: 17px; }

        .panel-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 10px;
        }

        .panel h2 {
          margin: 0 0 4px;
          font-size: 1rem;
        }

        .panel-caption {
          margin: 0;
          color: var(--muted);
          font-size: 0.76rem;
          line-height: 1.45;
        }

        .chart-wrap {
          position: relative;
          min-height: 260px;
        }

        canvas {
          display: block;
          width: 100%;
          height: 260px;
        }

        .legend {
          display: flex;
          flex-wrap: wrap;
          gap: 8px 14px;
          margin-top: 9px;
          color: var(--muted);
          font-size: 0.73rem;
        }

        .legend-item { display: inline-flex; align-items: center; gap: 6px; }
        .legend-line { width: 16px; height: 3px; border-radius: 2px; }

        .definition-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px 18px;
        }

        .definition {
          padding: 10px 0;
          border-bottom: 1px solid rgba(148, 163, 184, 0.12);
        }

        .definition strong {
          display: block;
          margin-bottom: 3px;
          font-size: 0.84rem;
        }

        .definition p {
          margin: 0;
          color: var(--muted);
          font-size: 0.76rem;
          line-height: 1.48;
        }

        .cache-list { display: grid; gap: 14px; margin-top: 15px; }
        .cache-row-header { display: flex; justify-content: space-between; gap: 12px; font-size: 0.78rem; }
        .cache-row-header span:last-child { color: var(--muted); font-variant-numeric: tabular-nums; }

        .footer-note {
          margin-top: 12px;
          color: var(--muted);
          font-size: 0.72rem;
          text-align: right;
        }

        .sr-only {
          position: absolute;
          width: 1px;
          height: 1px;
          padding: 0;
          margin: -1px;
          overflow: hidden;
          clip: rect(0, 0, 0, 0);
          white-space: nowrap;
          border: 0;
        }

        @media (max-width: 900px) {
          .summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .chart-grid { grid-template-columns: 1fr; }
        }

        @media (max-width: 620px) {
          .page-shell { width: min(100% - 20px, 1180px); padding-top: 18px; }
          .topbar { flex-direction: column; }
          .button-row { justify-content: flex-start; }
          .summary-grid, .definition-grid { grid-template-columns: 1fr; }
          .summary-value { font-size: 1.65rem; }
          .panel { padding: 13px; }
          canvas { height: 225px; }
        }
      </style>
    </head>
    <body>
      <main class="page-shell">
        <header class="topbar">
          <div>
            <div class="eyebrow">E-beam diagnostics</div>
            <h1>Memory &amp; System Health</h1>
            <p class="subtitle">Live server memory and in-memory graph cache usage. Samples are collected by this browser every five seconds and kept for the current tab.</p>
          </div>
          <div class="button-row">
            <button id="clear-history" class="button" type="button">Clear chart history</button>
            <a class="button" href="/">Back to dashboard</a>
          </div>
        </header>

        <div id="overall-status" class="status-strip" role="status" aria-live="polite">
          <span class="status-dot" aria-hidden="true"></span>
          <span id="overall-status-text">Loading current server health…</span>
        </div>

        <section class="summary-grid" aria-label="Current memory summary">
          <article class="summary-card">
            <div class="summary-label">Total process RAM (RSS)</div>
            <div id="rss-value" class="summary-value">--</div>
            <div id="rss-context" class="summary-context">of ${memoryLimitMb} MiB reference limit</div>
            <div class="meter" role="progressbar" aria-label="Process RAM utilization" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
              <div id="rss-meter" class="meter-fill"></div>
            </div>
          </article>
          <article class="summary-card">
            <div class="summary-label">JavaScript heap used</div>
            <div id="heap-used-value" class="summary-value">--</div>
            <div id="heap-used-context" class="summary-context">Active JavaScript data</div>
          </article>
          <article class="summary-card">
            <div class="summary-label">JavaScript heap reserved</div>
            <div id="heap-total-value" class="summary-value">--</div>
            <div id="heap-percent-context" class="summary-context">Heap utilization --</div>
          </article>
          <article class="summary-card">
            <div class="summary-label">External memory</div>
            <div id="external-value" class="summary-value">--</div>
            <div id="external-context" class="summary-context">Buffers and native allocations</div>
          </article>
        </section>

        <section class="chart-grid">
          <article class="panel">
            <div class="panel-header">
              <div>
                <h2>Memory over time</h2>
                <p class="panel-caption">A rising line that never settles after workload stops can indicate a leak.</p>
              </div>
            </div>
            <div class="chart-wrap">
              <canvas id="memory-chart" role="img" aria-label="Line chart of server RSS, heap used, heap total, and external memory over time"></canvas>
              <p class="sr-only" id="memory-chart-summary">Waiting for memory samples.</p>
            </div>
            <div class="legend" aria-hidden="true">
              <span class="legend-item"><span class="legend-line" style="background:#38bdf8"></span>RSS</span>
              <span class="legend-item"><span class="legend-line" style="background:#a78bfa"></span>Heap used</span>
              <span class="legend-item"><span class="legend-line" style="background:#34d399"></span>Heap total</span>
              <span class="legend-item"><span class="legend-line" style="background:#fb923c"></span>External</span>
            </div>
          </article>

          <article class="panel">
            <div class="panel-header">
              <div>
                <h2>Cache utilization over time</h2>
                <p class="panel-caption">Percentage of each intentional in-memory graph limit currently occupied.</p>
              </div>
            </div>
            <div class="chart-wrap">
              <canvas id="cache-chart" role="img" aria-label="Line chart of short-term, long-term, and temperature graph cache utilization"></canvas>
              <p class="sr-only" id="cache-chart-summary">Waiting for cache samples.</p>
            </div>
            <div class="legend" aria-hidden="true">
              <span class="legend-item"><span class="legend-line" style="background:#38bdf8"></span>Short-term</span>
              <span class="legend-item"><span class="legend-line" style="background:#a78bfa"></span>Long-term</span>
              <span class="legend-item"><span class="legend-line" style="background:#34d399"></span>Temperature</span>
            </div>
          </article>
        </section>

        <section class="chart-grid">
          <article class="panel">
            <h2>Current graph caches</h2>
            <p class="panel-caption">These are bounded copies used for fast charts. They do not represent the number of rows stored in Supabase.</p>
            <div class="cache-list">
              <div>
                <div class="cache-row-header"><span>Short-term pressure</span><span id="short-cache-label">--</span></div>
                <div class="meter"><div id="short-cache-meter" class="meter-fill"></div></div>
              </div>
              <div>
                <div class="cache-row-header"><span>Long-term pressure</span><span id="long-cache-label">--</span></div>
                <div class="meter"><div id="long-cache-meter" class="meter-fill" style="background:var(--purple)"></div></div>
              </div>
              <div>
                <div class="cache-row-header"><span>Clamp temperature per channel</span><span id="ccs-cache-label">--</span></div>
                <div class="meter"><div id="ccs-cache-meter" class="meter-fill" style="background:var(--green)"></div></div>
              </div>
            </div>
          </article>

          <article class="panel">
            <h2>What the memory numbers mean</h2>
            <div class="definition-grid">
              <div class="definition">
                <strong>RSS</strong>
                <p>Total physical RAM used by the Node process. This is the closest comparison to Render’s instance memory limit.</p>
              </div>
              <div class="definition">
                <strong>heapUsed</strong>
                <p>Memory occupied by active JavaScript objects, including server state and graph arrays.</p>
              </div>
              <div class="definition">
                <strong>heapTotal</strong>
                <p>Memory currently reserved by the JavaScript engine. Some unused space here is normal.</p>
              </div>
              <div class="definition">
                <strong>external</strong>
                <p>Memory outside the JavaScript heap, such as network buffers and other native allocations.</p>
              </div>
            </div>
          </article>
        </section>

        <p id="last-sampled" class="footer-note">No sample received yet.</p>
      </main>

      <script>
        (function () {
          'use strict';

          var HISTORY_KEY = 'ebeam-system-health-history-v1';
          var MAX_SAMPLES = 360;
          var POLL_INTERVAL_MS = 5000;
          var defaultMemoryLimitMb = ${memoryLimitMb};
          var samples = loadHistory();
          var latestHealth = null;

          var memorySeries = [
            { key: 'rss', color: '#38bdf8' },
            { key: 'heapUsed', color: '#a78bfa' },
            { key: 'heapTotal', color: '#34d399' },
            { key: 'external', color: '#fb923c' }
          ];
          var cacheSeries = [
            { key: 'shortPercent', color: '#38bdf8' },
            { key: 'longPercent', color: '#a78bfa' },
            { key: 'ccsPercent', color: '#34d399' }
          ];

          function loadHistory() {
            try {
              var parsed = JSON.parse(sessionStorage.getItem(HISTORY_KEY) || '[]');
              if (!Array.isArray(parsed)) return [];
              var cutoff = Date.now() - (2 * 60 * 60 * 1000);
              return parsed.filter(function (sample) {
                return sample && Number.isFinite(sample.time) && sample.time >= cutoff;
              }).slice(-MAX_SAMPLES);
            } catch (error) {
              return [];
            }
          }

          function saveHistory() {
            try {
              sessionStorage.setItem(HISTORY_KEY, JSON.stringify(samples));
            } catch (error) {
              // The live page still works when browser storage is unavailable.
            }
          }

          function finiteNumber(value, fallback) {
            var numeric = Number(value);
            return Number.isFinite(numeric) ? numeric : fallback;
          }

          function clampPercent(value) {
            return Math.max(0, Math.min(100, finiteNumber(value, 0)));
          }

          function formatMb(value) {
            return finiteNumber(value, 0).toFixed(1) + ' MiB';
          }

          function formatInteger(value) {
            return Math.round(finiteNumber(value, 0)).toLocaleString();
          }

          function cachePercent(current, limit) {
            var safeLimit = finiteNumber(limit, 0);
            return safeLimit > 0 ? clampPercent((finiteNumber(current, 0) / safeLimit) * 100) : 0;
          }

          function buildSample(health) {
            var memory = health.memoryMb || {};
            var points = health.cachePoints || {};
            var limits = health.cacheLimits || {};
            return {
              time: Date.parse(health.sampledAt) || Date.now(),
              rss: finiteNumber(memory.rss, 0),
              heapUsed: finiteNumber(memory.heapUsed, 0),
              heapTotal: finiteNumber(memory.heapTotal, 0),
              external: finiteNumber(memory.external, 0),
              shortPercent: cachePercent(points.shortTermPressure, limits.shortTermPressure),
              longPercent: cachePercent(points.longTermPressure, limits.longTermPressure),
              ccsPercent: cachePercent(points.ccsPerChannel, limits.ccsPerChannel)
            };
          }

          function setMeter(id, percent) {
            var meter = document.getElementById(id);
            if (meter) {
              var safePercent = clampPercent(percent);
              meter.style.width = safePercent.toFixed(1) + '%';
              if (meter.parentElement && meter.parentElement.hasAttribute('role')) {
                meter.parentElement.setAttribute('aria-valuenow', safePercent.toFixed(1));
              }
            }
          }

          function updateSummary(health) {
            var memory = health.memoryMb || {};
            var points = health.cachePoints || {};
            var limits = health.cacheLimits || {};
            var memoryLimitMb = finiteNumber(health.memoryLimitMb, defaultMemoryLimitMb);
            var rssPercent = memoryLimitMb > 0 ? (finiteNumber(memory.rss, 0) / memoryLimitMb) * 100 : 0;
            var heapPercent = finiteNumber(memory.heapTotal, 0) > 0
              ? (finiteNumber(memory.heapUsed, 0) / finiteNumber(memory.heapTotal, 1)) * 100
              : 0;

            document.getElementById('rss-value').textContent = formatMb(memory.rss);
            document.getElementById('rss-context').textContent = rssPercent.toFixed(1) + '% of ' + formatInteger(memoryLimitMb) + ' MiB reference limit';
            document.getElementById('heap-used-value').textContent = formatMb(memory.heapUsed);
            document.getElementById('heap-total-value').textContent = formatMb(memory.heapTotal);
            document.getElementById('heap-percent-context').textContent = 'Heap utilization ' + heapPercent.toFixed(1) + '%';
            document.getElementById('external-value').textContent = formatMb(memory.external);

            setMeter('rss-meter', rssPercent);

            var shortPercent = cachePercent(points.shortTermPressure, limits.shortTermPressure);
            var longPercent = cachePercent(points.longTermPressure, limits.longTermPressure);
            var ccsPercent = cachePercent(points.ccsPerChannel, limits.ccsPerChannel);
            document.getElementById('short-cache-label').textContent = formatInteger(points.shortTermPressure) + ' / ' + formatInteger(limits.shortTermPressure) + ' (' + shortPercent.toFixed(1) + '%)';
            document.getElementById('long-cache-label').textContent = formatInteger(points.longTermPressure) + ' / ' + formatInteger(limits.longTermPressure) + ' (' + longPercent.toFixed(1) + '%)';
            document.getElementById('ccs-cache-label').textContent = formatInteger(points.ccsPerChannel) + ' / ' + formatInteger(limits.ccsPerChannel) + ' (' + ccsPercent.toFixed(1) + '%)';
            setMeter('short-cache-meter', shortPercent);
            setMeter('long-cache-meter', longPercent);
            setMeter('ccs-cache-meter', ccsPercent);

            var status = document.getElementById('overall-status');
            var statusText = document.getElementById('overall-status-text');
            status.className = 'status-strip';

            if (health.supabase !== 'connected') {
              status.classList.add('is-danger');
              statusText.textContent = 'Supabase is disconnected. Memory data is available, but experiment data cannot update.';
            } else if (rssPercent >= 85) {
              status.classList.add('is-danger');
              statusText.textContent = 'Memory is critical at ' + rssPercent.toFixed(1) + '% of the reference limit.';
            } else if (rssPercent >= 70) {
              status.classList.add('is-warning');
              statusText.textContent = 'Memory is elevated at ' + rssPercent.toFixed(1) + '% of the reference limit.';
            } else {
              status.classList.add('is-good');
              statusText.textContent = 'Server responding · Supabase connected · Memory ' + rssPercent.toFixed(1) + '% of reference limit · Experiment ' + (health.experimentRunning ? 'running' : 'inactive');
            }

            var sampled = new Date(Date.parse(health.sampledAt) || Date.now());
            document.getElementById('last-sampled').textContent = 'Last sampled ' + sampled.toLocaleString() + ' · Server uptime ' + formatDuration(health.uptimeSeconds);
          }

          function formatDuration(seconds) {
            var totalSeconds = Math.max(0, Math.floor(finiteNumber(seconds, 0)));
            var days = Math.floor(totalSeconds / 86400);
            var hours = Math.floor((totalSeconds % 86400) / 3600);
            var minutes = Math.floor((totalSeconds % 3600) / 60);
            if (days > 0) return days + 'd ' + hours + 'h';
            if (hours > 0) return hours + 'h ' + minutes + 'm';
            return minutes + 'm';
          }

          function drawChart(canvasId, series, options) {
            var canvas = document.getElementById(canvasId);
            var context = canvas.getContext('2d');
            var width = Math.max(280, canvas.clientWidth || 600);
            var height = canvas.clientHeight || 260;
            var dpr = Math.max(1, window.devicePixelRatio || 1);
            canvas.width = Math.floor(width * dpr);
            canvas.height = Math.floor(height * dpr);
            context.setTransform(dpr, 0, 0, dpr, 0, 0);
            context.clearRect(0, 0, width, height);

            var left = 52;
            var right = 12;
            var top = 12;
            var bottom = 28;
            var plotWidth = Math.max(1, width - left - right);
            var plotHeight = Math.max(1, height - top - bottom);
            var values = [];
            samples.forEach(function (sample) {
              series.forEach(function (item) {
                var value = Number(sample[item.key]);
                if (Number.isFinite(value)) values.push(value);
              });
            });
            var observedMax = values.length ? Math.max.apply(null, values) : 1;
            var yMax = options.fixedMax || Math.max(options.minimumMax || 1, observedMax * 1.2);

            context.font = '11px ui-sans-serif, system-ui, sans-serif';
            context.textBaseline = 'middle';
            context.lineWidth = 1;

            for (var gridIndex = 0; gridIndex <= 4; gridIndex++) {
              var fraction = gridIndex / 4;
              var y = top + plotHeight - (fraction * plotHeight);
              context.strokeStyle = 'rgba(148, 163, 184, 0.14)';
              context.beginPath();
              context.moveTo(left, y);
              context.lineTo(left + plotWidth, y);
              context.stroke();
              context.fillStyle = '#94a3b8';
              context.textAlign = 'right';
              context.fillText((yMax * fraction).toFixed(options.decimals || 0) + options.unit, left - 7, y);
            }

            var firstTime = samples.length ? samples[0].time : Date.now();
            var lastTime = samples.length ? samples[samples.length - 1].time : firstTime + 1;
            var timeSpan = Math.max(1, lastTime - firstTime);
            context.fillStyle = '#94a3b8';
            context.textBaseline = 'alphabetic';
            context.textAlign = 'left';
            context.fillText(samples.length ? new Date(firstTime).toLocaleTimeString() : 'waiting', left, height - 6);
            context.textAlign = 'right';
            context.fillText(samples.length ? new Date(lastTime).toLocaleTimeString() : 'for samples', left + plotWidth, height - 6);

            series.forEach(function (item) {
              context.strokeStyle = item.color;
              context.lineWidth = 2;
              context.lineJoin = 'round';
              context.lineCap = 'round';
              context.beginPath();
              var started = false;
              samples.forEach(function (sample) {
                var value = Number(sample[item.key]);
                if (!Number.isFinite(value)) return;
                var x = samples.length === 1
                  ? left + plotWidth
                  : left + (((sample.time - firstTime) / timeSpan) * plotWidth);
                var y = top + plotHeight - ((value / yMax) * plotHeight);
                if (!started) {
                  context.moveTo(x, y);
                  started = true;
                } else {
                  context.lineTo(x, y);
                }
              });
              context.stroke();

              if (samples.length === 1) {
                var onlyValue = Number(samples[0][item.key]);
                if (Number.isFinite(onlyValue)) {
                  context.fillStyle = item.color;
                  context.beginPath();
                  context.arc(left + plotWidth, top + plotHeight - ((onlyValue / yMax) * plotHeight), 3, 0, Math.PI * 2);
                  context.fill();
                }
              }
            });
          }

          function drawAllCharts() {
            drawChart('memory-chart', memorySeries, { unit: ' MiB', decimals: 0, minimumMax: 32 });
            drawChart('cache-chart', cacheSeries, { unit: '%', decimals: 0, fixedMax: 100 });

            if (samples.length) {
              var latest = samples[samples.length - 1];
              document.getElementById('memory-chart-summary').textContent = 'Latest RSS ' + formatMb(latest.rss) + ', heap used ' + formatMb(latest.heapUsed) + ', heap total ' + formatMb(latest.heapTotal) + ', external ' + formatMb(latest.external) + '.';
              document.getElementById('cache-chart-summary').textContent = 'Latest cache utilization: short-term ' + latest.shortPercent.toFixed(1) + '%, long-term ' + latest.longPercent.toFixed(1) + '%, temperature ' + latest.ccsPercent.toFixed(1) + '%.';
            }
          }

          async function sampleHealth() {
            try {
              var response = await fetch('/health', { cache: 'no-store' });
              if (!response.ok) throw new Error('Health request failed with status ' + response.status);
              var health = await response.json();
              if (!health.memoryMb) throw new Error('Health response does not include memory data');

              latestHealth = health;
              var sample = buildSample(health);
              var previous = samples[samples.length - 1];
              if (previous && previous.time === sample.time) {
                samples[samples.length - 1] = sample;
              } else {
                samples.push(sample);
                samples = samples.slice(-MAX_SAMPLES);
              }
              saveHistory();
              updateSummary(health);
              drawAllCharts();
            } catch (error) {
              var status = document.getElementById('overall-status');
              status.className = 'status-strip is-danger';
              document.getElementById('overall-status-text').textContent = 'Unable to read server health: ' + error.message;
            }
          }

          document.getElementById('clear-history').addEventListener('click', function () {
            samples = [];
            saveHistory();
            if (latestHealth) {
              samples.push(buildSample(latestHealth));
              saveHistory();
            }
            drawAllCharts();
          });

          var resizeTimer = null;
          window.addEventListener('resize', function () {
            window.clearTimeout(resizeTimer);
            resizeTimer = window.setTimeout(drawAllCharts, 120);
          });

          drawAllCharts();
          sampleHealth();
          window.setInterval(sampleHealth, POLL_INTERVAL_MS);
        })();
      </script>
    </body>
    </html>
  `;
}

module.exports = { renderSystemHealthPage };
