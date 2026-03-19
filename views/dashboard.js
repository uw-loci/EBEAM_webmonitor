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
          grid-template-columns: repeat(3, minmax(140px, 1fr));
          gap: 1rem;
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
          font-size: 0.9rem;
          font-weight: 500;
          margin-top: 2px;
          border-radius: 6px;
          background: var(--bg-surface);
          border: 1px solid var(--border-subtle);
        }
        .beam-energy-reading p{
          margin-top: 7px;
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
          width: 98%;
        }

        #ccs-charts-section .chart-container { margin: 0; width: 100%; }

        .chart {
          position: relative;
          min-height: 300px;
          height: auto;
          width: 100%;
        }

        #ccs-charts-section .chart {
          min-height: 180px;
          height: auto;
        }

        #ccs-charts-section {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 10px;
          width: 98%;
          margin: 10px auto;
          box-sizing: border-box;
        }
        @media (max-width: 900px) {
          #ccs-charts-section {
            grid-template-columns: 1fr;
          }
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
            <span id="pressureReadings" style="font-size:1.05rem; font-weight:700; color:#7dd3fc; font-variant-numeric:tabular-nums; text-align:right;">
              ${pressure !== null ? pressure + ' mbar' : '--'}
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
            <div class="vacuum-indicators-item" title="972b Power On">
              <div id="vac-indicator-3" class="vacuum-indicators-circle" style="background-color:${vacColors[3]}"></div>
              <span>972b Power On</span>
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
                <div class = "beam-energy-reading"><p>Set: --</p></div>
                <div class = "beam-energy-reading"><p>High Voltage: --</p></div>
                <div class = "beam-energy-reading"><p>Current: --</p></div>
          </div>
        </div>
      </div>

      <div id="chart-root-2"></div>
      <div id="pressure-chart-section">
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 0 10px 8px; width: 98%; margin: 0 auto 0 auto;">
          <span id="pressure-chart-label" style="color:#94a3b8; font-size:14px;">
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
                stroke: '#38bdf8',
                points: { show: true, size: 5, fill: '#38bdf8', stroke: '#38bdf8' }
              }
            ],
            scales: { x: { time: true } },
            axes: [
              {
                stroke: '#94a3b8',
                font: '10px Arial',
                ticks: { stroke: 'rgba(255,255,255,0.15)', width: 1 },
                grid:  { stroke: 'rgba(255,255,255,0.06)', width: 1 },
              },
              {
                label: 'Pressure (mbar)',
                labelSize: 20,
                labelFont: '10px Arial',
                stroke: '#94a3b8',
                font: '10px Arial',
                size: 80,
                values: (u, vals) => vals.map(v => v.toExponential(2)),
                ticks: { stroke: 'rgba(255,255,255,0.15)', width: 1 },
                grid:  { stroke: 'rgba(255,255,255,0.06)', width: 1 },
              },
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

          chartEl.ondblclick = () => {
            uplot.setScale('x', { min: null, max: null });
          };

          return uplot;
        }

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

      <div id="ccs-charts-section">
        <div id="ccs-chart-A"></div>
        <div id="ccs-chart-B"></div>
        <div id="ccs-chart-C"></div>
      </div>

      <script>
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
            height: 180,
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
            uplot.setSize({ width: wrapper.clientWidth, height: 180 });
          });

          chartEl.ondblclick = () => {
            uplot.setScale('x', { min: null, max: null });
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
          stroke: '#818cf8',
        });
      </script>

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

          pressureReadings.textContent = String(data.pressure).replace("E", "e") + " mbar";
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

          try {
            const ccsRes = await fetch('/ccs-chart-data');
            const ccsData = await ccsRes.json();
            ccsChartA.setData([ccsData.A.xVals, ccsData.A.yVals]);
            ccsChartB.setData([ccsData.B.xVals, ccsData.B.yVals]);
            ccsChartC.setData([ccsData.C.xVals, ccsData.C.yVals]);
          } catch (e) {
            console.error('CCS chart data update failed:', e);
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

module.exports = { renderDashboard };
