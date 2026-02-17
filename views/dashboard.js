/**
 * Renders the full HTML dashboard page.
 *
 * @param {Object} opts
 * @param {Object} opts.data            - Current experimental data
 * @param {Object} opts.state           - Shared app state
 * @param {number[]} opts.sicColors     - 11-element array of interlock colors
 * @param {string[]} opts.vacColors     - 8-element array of vacuum indicator colors
 * @param {Object} opts.sampleGraph     - Sample chart graph object
 * @param {Object} opts.shortTermPressureGraph - Short-term pressure chart graph object
 * @param {Object} opts.longTermPressureGraph - Long-term pressure chart graph object
 * @param {string} opts.codeLastUpdated - Timestamp string for code deploy
 * @returns {string} Full HTML string
 */
function renderDashboard(opts) {
  const {
    data,
    state,
    sicColors,
    vacColors,
    sampleGraph,
    shortTermPressureGraph,
    longTermPressureGraph,
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

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>uPlot Live Update</title>
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css"/>
      <link rel="stylesheet" href="https://unpkg.com/uplot/dist/uPlot.min.css">
      <script src="https://unpkg.com/uplot/dist/uPlot.iife.min.js"></script>
      <style>
        /* =========================
           FUTURISTIC BACKGROUND
        ========================== */

        body {
          font-family: Arial, sans-serif;
          text-align: center;
          background: #0d1117;
          background-size: 400% 400%;
          color: white;
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
          border-radius: 15px;
          padding: 20px;
          margin: 50px auto;
          width: 90%;
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
          justify-content: space-around;
          align-items: center;
          flex-wrap: wrap;
        }
        .interlock-item {
          text-align: center;
          font-size: 0.75em;
          margin: 10px;
          transition: transform 0.3s ease, filter 0.3s ease;
        }
        .interlock-item div:last-child {
          transition: font-weight 0.3s ease;
        }
        .circle {
          width: 30px;
          height: 30px;
          border-radius: 50%;
          margin: 0 auto 5px auto;
          transition: transform 0.3s ease, filter 0.3s ease;
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
          justify-content: space-around;
          align-items: center;
          flex-wrap: wrap;
        }
        .vacuum-indicators-item {
          text-align: center;
          font-size: 0.75em;
          margin: 10px;
          transition: transform 0.3s ease, filter 0.3s ease;
        }
        .vacuum-indicators-item div:last-child {
          transition: font-weight 0.3s ease;
        }
        .vacuum-indicators-circle {
          width: 30px;
          height: 30px;
          border-radius: 50%;
          margin: 0 auto 5px auto;
          transition: transform 0.3s ease, filter 0.3s ease;
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
          gap: 1rem;
          margin-top: 1rem;
        }
        .beam-energy-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(140px, 1fr));
          gap: 1rem;
          align-items: stretch;
          margin-top: 1rem;
        }
        .ccs-reading {
          font-size: 0.8rem;
          font-weight: 500;
          margin-bottom: 12px;
          padding: 10px;
          border-radius: 6px;
          background-color:rgb(116, 118, 121);
          border: 1px solid #ced4da;
        }
        .beam-energy-reading {
          font-size: 0.9rem;
          font-weight: 500;
          margin-top: 2px;
          border-radius: 6px;
          background-color:rgb(116, 118, 121);
          border: 1px solid #ced4da;
        }
        .beam-energy-reading p{
          margin-top: 7px;
        }
        .cathode-box {
          flex: 1;
          border: 1px solid #dee2e6;
          margin-top: 5px;
          margin-bottom: 12px;
          border-radius: 7px;
          padding: 20px;
        }
        .cathode-heading {
           margin-bottom: 12px;
        }
        /* gauge circle now displays the attributes of a textbox */
        .gauge-grid {
          display: flex;
          justify-content: space-around;
          align-items: center;
          flex-wrap: wrap;
          gap: 1.5rem;
          margin-top: 1.5rem;
        }
        .gauge {
          text-align: center;
          font-size: 0.75em;
          color: #fff;
        }
        /* gauge circle now displays the attributes of a textbox */
        .gauge-circle {
          width: 80px;
          height: 37px;
          padding: 10px;
          background-color: conic-gradient(#ccc 0deg, #ccc 360deg);
          color: white;
          border: 1px solid #ccc;
          text-align: center;
          font-size: 0.9em;
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
          background-color: #00bcd4;
          color: white;
          border: none;
          padding: 5px 10px;
          font-size: 0.75em;
          border-radius: 5px;
          transition: background-color 0.3s ease;
          float: right;
          margin-top: -3.5em;
          margin-bottom: 5px;
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
        }
        @media (max-width: 600px) {
          .card-container {
            grid-template-columns: repeat(1, 1fr);
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
          border: 2px solid red;
          box-shadow: 0 0 10px red;
          text-shadow: 0 0 10px red;
          background-color: rgba(255, 0, 0, 0.2);
        }
        .neon-success {
          border: 2px solid green;
          box-shadow: 0 0 10px green;
          text-shadow: 0 0 10px green;
          background-color: rgba(0, 255, 0, 0.2);
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
          margin: 50px auto;
          width: 98%;
          max-height: 500px;
          overflow-y: auto;
          border: 2px dashed red;
        }

        .chart {
          position: relative;
          height: 300px;
          width: 100%;
          border: 2px solid blue;
        }

        .chart-title {
          font-size: 20px;
          font-weight: bold;
          margin-bottom: 10px;
          color: #ccc;
        }

        .chart-info-text {
          margin-top: 40px;
          font-size: 0.9em;
          color: #ccc;
          border: 1px dotted green;
        }
      </style>
    </head>
    <body>
      <div class="container-fluid mt-4">
        <!-- If experiment isn't running, show a neon warning. In the alternate case, show a neon success -->
        <div id="experiment-status" class="${!experimentRunning ? 'neon-warning' : 'neon-success'} fixed-top-right">
          Dashboard is ${!experimentRunning ? 'not ' : ''}running
        </div>
        <!-- Title & Subtitle -->
        <h2 class="dashboard-title">E-beam Web Monitor</h2>
        <p class="dashboard-subtitle">
          <strong>Web Monitor Log Last Modified:</strong> <span id="log-last-modified">${fileModified}</span> |
          <strong>Site Last Updated:</strong> <span id="site-last-updated">${currentTime}</span>
        </p>
        <!-- Interlocks Section -->
        <div class="interlocks-section">
          <h3 class="dashboard-subtitle interlocks-title">Interlocks</h3>
          <div class="interlocks-container">
            <div class="interlock-item">
              <div id="sic-door" class="circle" style="background-color:${doorColor}"></div>
              <div>Door</div>
            </div>
            <div class="interlock-item">
              <div id="sic-water" class="circle" style="background-color:${waterColor}"></div>
              <div>Water</div>
            </div>
            <div class="interlock-item">
              <div id="sic-vacuum-power" class="circle" style="background-color:${vacuumPowerColor}"></div>
              <div>Vacuum Power</div>
            </div>
            <div class="interlock-item">
              <div id="sic-vacuum-pressure" class="circle" style="background-color:${vacuumPressureColor}"></div>
              <div>Vacuum Pressure</div>
            </div>
            <div class="interlock-item">
              <div id="sic-oil-low" class="circle" style="background-color:${oilLowColor}"></div>
              <div>Low Oil</div>
            </div>
            <div class="interlock-item">
              <div id="sic-oil-high" class="circle" style="background-color:${oilHighColor}"></div>
              <div>High Oil</div>
            </div>
            <div class="interlock-item">
              <div id="sic-estop" class="circle" style="background-color:${estopIntColor}"></div>
              <div>E-STOP Int</div>
            </div>
            <div class="interlock-item">
              <div id="sic-estopExt" class="circle" style="background-color:${estopExtColor}"></div>
              <div>E-STOP Ext</div>
            </div>
            <div class="interlock-item">
              <div id="all-interlocks" class="circle" style="background-color:${allInterlocksColor}"></div>
              <div>All Interlocks</div>
            </div>
            <div class="interlock-item">
              <div id="g9-output" class="circle" style="background-color:${G9OutputColor}"></div>
              <div>G9 Output</div>
            </div>
            <div class="interlock-item">
              <div id="hvolt" class="circle" style="background-color:${hvoltColor}"></div>
              <div>HVolt ON</div>
            </div>
          </div>
        </div>
        <!-- Vacuum Indicators Section -->
        <div class="vacuum-indicators">
          <h3 id="pressureReadings" class="dashboard-subtitle vacuum-indicators-title">Vacuum Indicators: ${pressure !== null ? pressure + ' mbar' : '--'}</h3>
          <div class="vacuum-indicators-container">
            <div class="vacuum-indicators-item">
              <div id = "vac-indicator-0" class="vacuum-indicators-circle" style="background-color:${vacColors[0]}"></div>
              <div>Pumps Power ON</div>
            </div>
            <div class="vacuum-indicators-item">
              <div id = "vac-indicator-1" class="vacuum-indicators-circle" style="background-color:${vacColors[1]}"></div>
              <div>Turbo Rotor ON</div>
            </div>
            <div class="vacuum-indicators-item">
              <div id = "vac-indicator-2" class="vacuum-indicators-circle" style="background-color:${vacColors[2]}"></div>
              <div>Turbo Vent Open</div>
            </div>
            <div class="vacuum-indicators-item">
              <div id = "vac-indicator-3" class="vacuum-indicators-circle" style="background-color:${vacColors[3]}"></div>
              <div>972b Power On</div>
            </div>
            <div class="vacuum-indicators-item">
              <div id = "vac-indicator-4" class="vacuum-indicators-circle" style="background-color:${vacColors[4]}"></div>
              <div>Turbo Gate Closed</div>
            </div>
            <div class="vacuum-indicators-item">
              <div id = "vac-indicator-5" class="vacuum-indicators-circle" style="background-color:${vacColors[5]}"></div>
              <div>Turbo Gate Open</div>
            </div>
            <div class="vacuum-indicators-item">
              <div id = "vac-indicator-6" class="vacuum-indicators-circle" style="background-color:${vacColors[6]}"></div>
              <div>Argon Gate Open</div>
            </div>
            <div class="vacuum-indicators-item">
              <div id = "vac-indicator-7" class="vacuum-indicators-circle" style="background-color:${vacColors[7]}"></div>
              <div>Argon Gate Closed</div>
            </div>
          </div>
        </div>
        <!-- Environmental Section -->
        <div class="env-section">
          <h3 class="dashboard-subtitle env-title">Environmental</h3>
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
          <h3 class="dashboard-subtitle env-title">CCS</h3>
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
          <h3 class="dashboard-subtitle env-title">Beam Energy</h3>
          <div class="beam-energy-grid">
                <div class = "beam-energy-reading"><p>Set: --</p></div>
                <div class = "beam-energy-reading"><p>High Voltage: --</p></div>
                <div class = "beam-energy-reading"><p>Current: --</p></div>
          </div>
        </div>
      </div>

      <div id="chart-root-1"></div>
      <div id="chart-root-2"></div>
      <div id="pressure-chart-section">
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 0 10px 8px; width: 98%; margin: 50px auto 0 auto;">
          <span id="pressure-chart-label" style="color:#ccc; font-size:14px;">
            Short-Term (Last 24h, ~3s resolution)
          </span>
          <button id="pressure-view-toggle" class="btn-toggle" style="float:none; margin:0;">
            Switch to Historical View
          </button>
        </div>
        <div id="chart-root-3" style="margin-top: 0;"></div>
      </div>

      <script>
        function createLiveUplotChart(container, config) {
          if (typeof container === 'string') container = document.querySelector(container);

          const {
            title = "Live Updating Chart",
            data = [[], []],
            seriesLabel = "Series",
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
            <div class="chart-info-text">
              Max \${maxDataPoints} calculated points. Max \${maxDisplayPoints} display points.
              # points displayed: \${displayXVals.length}.
              Current stride: \${lastUsedFactor} minute(s).
              New point added every \${60 * chartDataIntervalDuration}s.
              Double-click to reset zoom. Drag horizontally to zoom in.
            </div>
          \`;
          container.appendChild(wrapper);

          const chartEl = wrapper.querySelector('.chart');

          const uplot = new uPlot({
            width: wrapper.clientWidth,
            height: 300,
            series: [
              {},
              {
                label: seriesLabel,
                value: (u, v) => {
                  if (v == null) return "";
                  return v.toExponential(4);
                },
                stroke: 'blue',
                points: { show: true, size: 5, fill: 'blue', stroke: 'blue' }
              }
            ],
            scales: { x: { time: true } },
            axes: [
              { stroke: '#ccc' },
              { stroke: '#ccc', values: (u, vals) => vals.map(v => v.toExponential(2)) },
            ],
            cursor: {
              focus: { prox: 16 },
              drag: {
                x: true,
                y: false,
                setScale: true
              },
            },
          }, data, chartEl);

          window.addEventListener('resize', () => {
            const newWidth = wrapper.clientWidth;
            uplot.setSize({ width: newWidth, height: 300 });
          });

          const innerChart = chartEl.querySelector(':scope > *');
          if (innerChart) {
            innerChart.style.position = 'absolute';
            innerChart.style.top = '0';
            innerChart.style.left = '0';
            innerChart.style.width = '100%';
            innerChart.style.height = '100%';
          }

          chartEl.ondblclick = () => {
            uplot.setScale('x', { min: null, max: null });
          };

          return uplot;
        }

        const now = Date.now();

        function makeSineData(freq = 10, len = 100) {
          const x = Array.from({ length: len }, (_, i) => now + i * 60000);
          const y = x.map((_, i) => Math.sin(i / freq));
          return [x, y];
        }

        // Create the sample sine chart
        createLiveUplotChart(document.getElementById('chart-root-1'), {
          title: 'Live Update Sin Graph',
          data: [${JSON.stringify(sampleGraph.displayXVals)}, ${JSON.stringify(sampleGraph.displayYVals)}],
          seriesLabel: "sin(t/10)",
          maxDataPoints: ${sampleGraph.maxDataPoints},
          maxDisplayPoints: ${sampleGraph.maxDisplayPoints},
          displayXVals: ${JSON.stringify(sampleGraph.displayXVals)},
          lastUsedFactor: ${sampleGraph.lastUsedFactor},
          chartDataIntervalDuration: ${sampleGraph.chartDataIntervalDuration},
        });

        // Create the pressure chart and keep a reference for live updates
        let pressureChart = createLiveUplotChart(document.getElementById('chart-root-3'), {
          title: 'Pressure Graph',
          data: [${JSON.stringify(shortTermPressureGraph.displayXVals)}, ${JSON.stringify(shortTermPressureGraph.displayYVals)}],
          seriesLabel: "pressure (mbar)",
          maxDataPoints: ${shortTermPressureGraph.maxDataPoints},
          maxDisplayPoints: ${shortTermPressureGraph.maxDisplayPoints},
          displayXVals: ${JSON.stringify(shortTermPressureGraph.displayXVals)},
          lastUsedFactor: ${shortTermPressureGraph.lastUsedFactor},
          chartDataIntervalDuration: ${shortTermPressureGraph.chartDataIntervalDuration},
        });

        // Toggle state for pressure chart view
        let currentPressureView = 'short';
        let longTermPollCounter = 0;
        const LONG_TERM_POLL_EVERY = 20; // 20 * 3s = 60s

        const pressureViewToggle = document.getElementById('pressure-view-toggle');
        const pressureChartLabel = document.getElementById('pressure-chart-label');

        pressureViewToggle.addEventListener('click', async () => {
          currentPressureView = currentPressureView === 'short' ? 'long' : 'short';

          if (currentPressureView === 'short') {
            pressureViewToggle.textContent = 'Switch to Historical View';
            pressureChartLabel.textContent = 'Short-Term (Last 24h, ~3s resolution)';
          } else {
            pressureViewToggle.textContent = 'Switch to Live View';
            pressureChartLabel.textContent = 'Historical (All-time, 1-min averages)';
          }

          try {
            const res = await fetch('/chart-data?view=' + currentPressureView);
            const chartData = await res.json();
            pressureChart.setData([chartData.xVals, chartData.yVals]);
          } catch (e) {
            console.error('Failed to load chart data:', e);
          }
        });
      </script>


      <div class="env-section", style="overflow-y: auto;">
        <p>Code last updated: ${codeLastUpdated}</p>
      </div>

      <div class="env-section" style="max-height: 200px; overflow-y: auto;">
        <p>Data extracted</span></p>
        <pre>${JSON.stringify(data, null, 2)}</pre>
        <pre>${JSON.stringify(state.extractLines)}</pre>
      </div>

      <!-- Log Viewer -->
      <div class="env-section">
        <h3 class="dashboard-subtitle env-title">System Logs; Last Update: <span id="display-last-updated">${
            data.displayLogLastModified
              ? new Date(data.displayLogLastModified).toLocaleString("en-US", {
                  hour12: true,
                  timeZone: "America/Chicago"
                })
              : "N/A"
        }</span></h3>
        <button id="toggleButton" class="btn-toggle">Show Full Log</button>
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

         if (showingFull) {
          fetch('/raw').then(resp => resp.text()).then(text => {
          pre.textContent = text;
          fullSection.classList.add('active');
          toggleButton.textContent = 'Collapse Log View';
          });
        }

        setInterval(async() => {
          try {

          const res = await fetch('/data');
          const data = await res.json();

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

          const pressureReadings = document.getElementById('pressureReadings');

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

          heaterCurrentA.textContent = (data.heaterCurrent_A !== null && data.heaterCurrent_A !== undefined && experimentRunning? "Current: " + data.heaterCurrent_A : "Current: " + "--");
          heaterCurrentB.textContent = (data.heaterCurrent_B !== null && data.heaterCurrent_B !== undefined && experimentRunning? "Current: " + data.heaterCurrent_B : "Current: " + "--");
          heaterCurrentC.textContent = (data.heaterCurrent_C !== null && data.heaterCurrent_C !== undefined && experimentRunning? "Current: " + data.heaterCurrent_C : "Current: " + "--");

          heaterVoltageA.textContent = (data.heaterVoltage_A !== null && data.heaterVoltage_A !== undefined && experimentRunning? "Voltage: " + data.heaterVoltage_A : "Voltage: " + "--");
          heaterVoltageB.textContent = (data.heaterVoltage_B !== null && data.heaterVoltage_B !== undefined && experimentRunning? "Voltage: " + data.heaterVoltage_B : "Voltage: " + "--");
          heaterVoltageC.textContent = (data.heaterVoltage_C !== null && data.heaterVoltage_C !== undefined && experimentRunning? "Voltage: " + data.heaterVoltage_C : "Voltage: " + "--");

          heaterTemperatureA.textContent = (data.clamp_temperature_A !== null && data.clamp_temperature_A !== undefined && experimentRunning? "Clamp Temperature: " + data.clamp_temperature_A : "Clamp Temperature: " + "--");
          heaterTemperatureB.textContent = (data.clamp_temperature_B !== null && data.clamp_temperature_B !== undefined && experimentRunning? "Clamp Temperature: " + data.clamp_temperature_B : "Clamp Temperature: " + "--");
          heaterTemperatureC.textContent = (data.clamp_temperature_C !== null && data.clamp_temperature_C !== undefined && experimentRunning? "Clamp Temperature: " + data.clamp_temperature_C : "Clamp Temperature: " + "--");


          const dateObj = new Date(data.siteLastUpdated);
          const clean_string = dateObj.toLocaleString("en-US", {
            hour12: true,
            timeZone: "America/Chicago"
          });
          siteLastUpdated.textContent = clean_string;

          pressureReadings.textContent = "Vacuum Indicators: " + String(data.pressure).replace("E", "e") + " mbar";
          sensor1.querySelector('.gauge-cover').textContent = (!data.temperatures || !data.temperatures["1"] || data.temperatures["1"] === "DISCONNECTED" || data.temperatures["1"] === "None" && !experimentRunning) ? '--' : data.temperatures["1"] + '°C';
          sensor2.querySelector('.gauge-cover').textContent = (!data.temperatures || !data.temperatures["2"] || data.temperatures["2"] === "DISCONNECTED" || data.temperatures["2"] === "None" && !experimentRunning) ? '--' : data.temperatures["2"] + '°C';
          sensor3.querySelector('.gauge-cover').textContent = (!data.temperatures || !data.temperatures["3"] || data.temperatures["3"] === "DISCONNECTED" || data.temperatures["3"] === "None" && !experimentRunning) ? '--' : data.temperatures["3"] + '°C';
          sensor4.querySelector('.gauge-cover').textContent = (!data.temperatures || !data.temperatures["4"] || data.temperatures["4"] === "DISCONNECTED" || data.temperatures["4"] === "None" && !experimentRunning) ? '--' : data.temperatures["4"] + '°C';
          sensor5.querySelector('.gauge-cover').textContent = (!data.temperatures || !data.temperatures["5"] || data.temperatures["5"] === "DISCONNECTED" || data.temperatures["5"] === "None" && !experimentRunning) ? '--' : data.temperatures["5"] + '°C';
          sensor6.querySelector('.gauge-cover').textContent = (!data.temperatures || !data.temperatures["6"] || data.temperatures["6"] === "DISCONNECTED" || data.temperatures["6"] === "None" && !experimentRunning) ? '--' : data.temperatures["6"] + '°C';



          console.log(sensor1.textContent);
          console.log(data.sicColors);

          // Live chart update
          longTermPollCounter++;
          const shouldUpdateLongTerm = longTermPollCounter >= LONG_TERM_POLL_EVERY;
          if (shouldUpdateLongTerm) longTermPollCounter = 0;

          if (currentPressureView === 'short' || (currentPressureView === 'long' && shouldUpdateLongTerm)) {
            try {
              const chartRes = await fetch('/chart-data?view=' + currentPressureView);
              const chartData = await chartRes.json();
              pressureChart.setData([chartData.xVals, chartData.yVals]);
            } catch (e) {
              console.error('Chart data update failed:', e);
            }
          }

          }
          catch {
          console.error('Failed to load the dashboard!')
            }
          }, 3000)

        toggleButton.addEventListener('click', async () => {
          if (!showingFull) {
            pre.textContent = ' Fetching file contents...';
            fullSection.classList.add('active');
            await fetch('/refresh-display');
            const resp = await (await fetch('/raw')).text();
            pre.textContent = resp;
            toggleButton.textContent = 'Collapse Log View';
          } else {
            fullSection.classList.remove('active');
            toggleButton.textContent = 'Show Full Log';
          }
          showingFull = !showingFull;
          sessionStorage.setItem('showingFull', showingFull);
        })
      </script>
    </body>
    </html>
  `;
}

module.exports = { renderDashboard };
