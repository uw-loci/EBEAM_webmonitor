
const express = require('express');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const https = require('https');
const lockFile = require('proper-lockfile');
const { PassThrough } = require('stream');
const logDataExtracApiRoutes = require('./log_data_extraction');

app.use('/log-data-extraction', logDataExtracApiRoutes);

// Load environment variables
require('dotenv').config();

const FOLDER_ID = process.env.FOLDER_ID;
const API_KEY = process.env.API_KEY;
const LOG_DATA_EXTRACTION_KEY = 'my-secret-key';
const PORT = process.env.PORT || 3000;

// File paths for local storage
const REVERSED_FILE_PATH = path.join(__dirname, 'reversed.txt');
// Temp_File paths for local storage
const REVERSED_TEMP_FILE_PATH = path.join(__dirname, 'reversed.tmp.txt');

// 15 minutes in milliseconds
const INACTIVE_THRESHOLD = 15 * 60 * 1000;

// Initialize Express app
const app = express();

// Initialize Google Drive API
const drive = google.drive({ version: 'v3', auth: API_KEY });

/**
 * Fetch the most recent file from Google Drive.
 */
async function getMostRecentFile() {
  try {
    const res = await drive.files.list({
      q: `'${FOLDER_ID}' in parents and mimeType='text/plain'`,
      orderBy: 'modifiedTime desc',
      pageSize: 1,
      fields: 'files(id, name, modifiedTime)',
    });

    const files = res.data.files;
    if (!files || files.length === 0) {
      throw new Error('No files found in the folder.');
    }

    return files[0]; // Returns the most recent file (ID, name, modifiedTime)
  } catch (err) {
    console.error(`Google Drive API Error: ${err.message}`);
    return null;
  }
}

let lastModifiedTime = null;
let logFileName = null;
let experimentRunning = false;

/**
 * Fetches file contents from Google Drive using streaming
 * @param {string} fileId - The Google Drive file ID
 * @returns {Promise<string[]>} Array of lines from the file
 */
async function fetchFileContents(fileId) {
  let retries = 3;
  
  while (retries > 0) {
    try {
      const response = await new Promise((resolve, reject) => {
        https.get(
          `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&key=${API_KEY}`,
          {
            headers: {
              'Accept': 'text/plain'
            }
          },
          (res) => {
            if (res.statusCode !== 200) {
              reject(new Error(`Google API Failed: ${res.statusCode}`));
              return;
            }
            resolve(res);
          }
        ).on('error', reject);
      });

      // Process the stream line by line
      const lines = [];
      let currentLine = '';

      await new Promise((resolve, reject) => {
        response.on('data', chunk => {
          const chunkStr = chunk.toString();
          const chunkLines = (currentLine + chunkStr).split('\n');
          currentLine = chunkLines.pop();
          lines.push(...chunkLines);
        });

        response.on('end', () => {
          if (currentLine) lines.push(currentLine);
          resolve();
        });

        response.on('error', reject);
      });

      return lines;
    } catch (err) {
      console.log(`Retry ${4 - retries}: ${err.message}`);
      retries--;
      if (retries === 0) throw err;
      await new Promise(res => setTimeout(res, 2000));
    }
  }
}



/**
 * Fetches and updates the log file if there's a new version
 * @returns {Promise<boolean>} True if file was updated, false otherwise
 */
async function fetchAndUpdateFile() {
  let release;

  try {
    const mostRecentFile = await getMostRecentFile();
    if (!mostRecentFile) {
      experimentRunning = false;
      return false;
    }

    const fileModifiedTime = new Date(mostRecentFile.modifiedTime).getTime();
    const currentTime = new Date().getTime();

    if (currentTime - fileModifiedTime > INACTIVE_THRESHOLD) {
      experimentRunning = false;

      if (!fs.existsSync(REVERSED_FILE_PATH)) {
        console.log("Experiment not running but passing through");
      } else {
        console.log("Experiment not running - no updates in 15 minutes");
        return false;
      }
    }

    if (lastModifiedTime && lastModifiedTime === mostRecentFile.modifiedTime) {
      console.log("No new updates. Using cached file.");
      experimentRunning = true;
      return false;
    }

    console.log("Fetching new file...");
    let lines = await fetchFileContents(mostRecentFile.id);
    lines.reverse();

    // Write to temporary file first
    release = await lockFile.lock(REVERSED_FILE_PATH); // lock original path

    const writeStream = fs.createWriteStream(REVERSED_TEMP_FILE_PATH, { flags: 'w' });
    let hasError = false;

    await new Promise((resolve, reject) => {
      let i = 0;
      function writeNext() {
        if (hasError) return;

        let ok = true;
        while (i < lines.length && ok) {
          ok = writeStream.write(lines[i] + '\n');
          i++;
        }
        if (i < lines.length) {
          writeStream.once('drain', writeNext);
        } else {
          writeStream.end();
        }
      }

      writeNext();

      writeStream.on('finish', async () => {
        try {
          fs.renameSync(REVERSED_TEMP_FILE_PATH, REVERSED_FILE_PATH); // atomic replace
          console.log('Reversed log updated successfully.');
          lastModifiedTime = mostRecentFile.modifiedTime;
          logFileName = mostRecentFile.name;
          experimentRunning = true;
          // TODO: complete and uncomment the extraction API here, once Prat is done fixing it. 
          // const response = await axios.get('http://localhost:3001/get-log-data');
          // console.log('Map from API:', response.data);
          resolve(true);
        } catch (err) {
          console.error('Rename failed:', err);
          reject(false);
        }
      });

      writeStream.on('error', async (err) => {
        console.error('Error writing file:', err);
        hasError = true;
        reject(false);
      });
    });

  } catch (err) {
    console.error(`Error processing file: ${err.message}`);
    experimentRunning = false;
    return false;
  } finally {
    if (release) {
      await release(); // always release lock
    }
  }
}

// Schedule updates
fetchAndUpdateFile(); // Initial fetch
setInterval(fetchAndUpdateFile, 60000); // Check every minute

/**
 * GET/: Render log dashboard
 */
app.get('/', async (req, res) => {
  try {
    if (fs.existsSync(REVERSED_TEMP_FILE_PATH)) {
      // Temp write is in progress — delay response briefly
      await new Promise((r) => setTimeout(r, 500));
    }

    let reversedContents = "No data available.";
    if (fs.existsSync(REVERSED_FILE_PATH)) {
      reversedContents = await fs.promises.readFile(REVERSED_FILE_PATH, 'utf8');
    }

    const contentLines = reversedContents.split('\n');
    const previewContent = contentLines.slice(0, 20).join('\n');
    const fileModified = lastModifiedTime 
      ? new Date(lastModifiedTime).toLocaleString("en-US", { timeZone: "America/Chicago" })
      : "N/A";
    const currentTime = new Date().toLocaleString("en-US", { timeZone: "America/Chicago" });

    // 👇 keep your HTML generation as-is below this
    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Log System Dashboard</title>
        <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet" />
        <style>
          /* =========================
             FUTURISTIC BACKGROUND
          ========================== */
          body {
            font-family: Arial, sans-serif;
            text-align: center;
            background: linear-gradient(-45deg, #001f3f, #003366, #005a9e);
            background-size: 400% 400%;
            animation: gradientMove 12s ease infinite;
            color: white;
            padding: 20px;
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
            background: rgba(255, 255, 255, 0.08);
            backdrop-filter: blur(20px);
            -webkit-backdrop-filter: blur(20px);
            border-radius: 15px;
            padding: 30px;
            box-shadow: 0px 4px 25px rgba(255, 255, 255, 0.15);
            width: 100%;
            margin: 0 auto;
          }
          /* For sections like Interlocks, Environmental, and Green Indicators */
          .interlocks-section,
          .env-section,
          .vacuum-indicators{
            background: rgba(255, 255, 255, 0.08);
            backdrop-filter: blur(20px);
            -webkit-backdrop-filter: blur(20px);
            border-radius: 15px;
            padding: 20px;
            margin: 30px auto;
            width: 90%;
          }

          /* =========================
             TITLES / HEADERS
          ========================== */
          .dashboard-title {
            font-size: 3.5em;
            font-weight: 900;
            color: #d6eaff;
            text-shadow: 0px 0px 12px rgba(214, 234, 255, 0.6),
                         0px 0px 20px rgba(214, 234, 255, 0.4);
          }
          .dashboard-title::after {
            content: "";
            display: block;
            width: 60%;
            height: 5px;
            background: rgba(0, 255, 255, 0.8);
            margin: 10px auto;
            box-shadow: 0px 0px 15px rgba(0, 255, 255, 1);
            border-radius: 10px;
          }
          .dashboard-subtitle {
            font-size: 1.2em;
            margin-bottom: 25px;
            opacity: 0.9;
            color: rgba(255, 255, 255, 0.8);
          }

          /* =========================
             INTERLOCKS SECTION
          ========================== */
          .interlocks-title {
            font-weight: bold;
            transition: text-shadow 0.3s ease;
            cursor: pointer;
          }
          .interlocks-title:hover {
            text-shadow: 0px 0px 10px rgba(255,255,255,0.8);
          }
          .interlocks-container {
            display: flex;
            justify-content: space-around;
            align-items: center;
            flex-wrap: wrap;
          }
          .interlock-item {
            text-align: center;
            margin: 10px;
            transition: transform 0.3s ease, filter 0.3s ease;
            cursor: pointer;
          }
          .interlock-item:hover {
            transform: translateY(-5px);
            filter: brightness(1.3);
          }
          .interlock-item div:last-child {
            transition: font-weight 0.3s ease;
          }
          .interlock-item:hover div:last-child {
            font-weight: bold;
          }
          .circle {
            width: 40px;
            height: 40px;
            border-radius: 50%;
            margin: 0 auto 5px auto;
            transition: transform 0.3s ease, filter 0.3s ease;
          }
          .interlock-item:hover .circle {
            transform: scale(1.1);
            filter: brightness(1.3);
          }

          /* =========================
             GREEN INDICATORS SECTION
          ========================== */
          .vacuum-indicators-title {
            font-weight: bold;
            transition: text-shadow 0.3s ease;
            cursor: pointer;
          }
          .vacuum-indicators-title:hover {
            text-shadow: 0px 0px 10px rgba(255,255,255,0.8);
          }
          /* Reusing the interlocks container style for consistency */
          .vacuum-indicators-container {
            display: flex;
            justify-content: space-around;
            align-items: center;
            flex-wrap: wrap;
          }
          /* Items here are the same as interlock items but will only use green circles */
          .vacuum-indicators-item {
            text-align: center;
            margin: 10px;
            transition: transform 0.3s ease, filter 0.3s ease;
            cursor: pointer;
          }
          .vacuum-indicators-item:hover {
            transform: translateY(-5px);
            filter: brightness(1.3);
          }
          .vacuum-indicators-item div:last-child {
            transition: font-weight 0.3s ease;
          }
          .vacuum-indicators-item:hover div:last-child {
            font-weight: bold;
          }
          /* Use same circle styling */
          .vacuum-indicators-circle {
            width: 40px;
            height: 40px;
            border-radius: 50%;
            margin: 0 auto 5px auto;
            background-color: #28a745; /* Green */
            transition: transform 0.3s ease, filter 0.3s ease;
          }
          .vacuum-indicators-item:hover .vacuum-indicators-circle {
            transform: scale(1.1);
            filter: brightness(1.3);
          }

          /* =========================
             ENVIRONMENTAL SECTION
          ========================== */
          .env-title {
            font-weight: bold;
            transition: text-shadow 0.3s ease;
            cursor: pointer;
          }
          .env-title:hover {
            text-shadow: 0px 0px 10px rgba(255,255,255,0.8);
          }
          .env-container {
            display: flex;
            justify-content: space-around;
            align-items: flex-end;
            flex-wrap: wrap;
          }
          .env-item {
            position: relative;
            margin: 15px;
            width: 60px;  /* width for each bar column */
            text-align: center;
          }
          .env-item-header {
            margin-bottom: 10px;
            font-weight: bold;
            min-height: 1.5em;
          }
          /* The scale+bar wrapper */
          .env-bar-scale {
            display: flex;
            align-items: flex-end;
            height: 200px; /* total height of the chart */
          }
          /* Vertical scale */
          .env-scale {
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            margin-right: 5px;
            height: 100%;
          }
          .env-scale span {
            color: #fff;
            font-size: 0.8em;
          }
          /* Outer bar container */
          .env-bar-outer {
            width: 30px;
            background: rgba(255,255,255,0.2);
            border: 1px solid #fff;
            border-radius: 5px;
            position: relative;
            overflow: hidden;
          }
          /* The fill portion */
          .env-bar-inner {
            background: #00c8ff;
            width: 100%;
            position: absolute;
            bottom: 0;
            transition: height 0.3s ease;
          }

          /* =========================
             LOG VIEWER
          ========================== */
          pre {
            white-space: pre-wrap;
            font-family: 'Courier New', monospace;
            text-align: left;
            background: rgba(10, 10, 10, 0.85);
            color: #ffffff;
            padding: 20px;
            border-radius: 12px;
            max-height: 600px;
            overflow-y: auto;
            font-size: 1.2em;
            box-shadow: 0px 0px 15px rgba(0, 255, 255, 0.3);
            border: 1px solid rgba(0, 255, 255, 0.5);
          }
          .content-section {
            display: none;
          }
          .content-section.active {
            display: block;
          }
          .btn-toggle {
            background: rgba(0, 255, 255, 0.5);
            color: white;
            border: 1px solid rgba(0, 255, 255, 0.8);
            border-radius: 8px;
            padding: 12px 25px;
            font-size: 1.1em;
            margin-bottom: 20px;
            transition: background 0.3s ease, box-shadow 0.3s ease;
          }
          .btn-toggle:hover {
            background: rgba(0, 255, 255, 0.8);
            box-shadow: 0px 0px 15px rgba(0, 255, 255, 1);
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
            padding: 10px 20px;
            font-size: 1.3em;
            background-color: rgba(255, 0, 0, 0.2);
            border: 2px solid red;
            border-radius: 8px;
            box-shadow: 0 0 20px red;
            text-shadow: 0 0 15px red;
            color: white;
            font-weight: bold;
            animation: neonBlink 8s infinite alternate;
            z-index: 9999;
          }
          @keyframes neonBlink {
            0% { opacity: 1; text-shadow: 0 0 10px red; }
            50% { opacity: 0.8; text-shadow: 0 0 5px red; }
            100% { opacity: 1; text-shadow: 0 0 10px red; }
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
        </style>
      </head>
      <body>
        <div class="container-fluid mt-4">
          <!-- If experiment isn't running, show a neon warning -->
          ${!experimentRunning ? `<div class="neon-warning fixed-top-right">Experiment is not running</div>` : ''}

          <!-- Title & Subtitle -->
          <h2 class="dashboard-title">E-beam Web Monitor</h2>
          <p class="dashboard-subtitle">
            <strong>File Last Modified:</strong> ${fileModified} | 
            <strong>Last Updated:</strong> ${currentTime}
          </p>

          <!-- Example Cards (Optional) -->
          <!--
          <div class="card-container">
            <div class="card">Hi, I am Card 1</div>
            <div class="card">Hi, I am Card 2</div>
            <div class="card">Hi, I am Card 3</div>
            <div class="card">Hi, I am Card 4</div>
            <div class="card">Hi, I am Card 5</div>
            <div class="card">Hi, I am Card 6</div>
            <div class="card">Hi, I am Card 7</div>
            <div class="card">Hi, I am Card 8</div>
          </div>
          -->

          <!-- Interlocks Section -->
          <div class="interlocks-section">
            <h3 class="dashboard-subtitle interlocks-title">Interlocks</h3>
            <div class="interlocks-container">
              <div class="interlock-item">
                <div class="circle bg-danger"></div>
                <div>Vacuum</div>
              </div>
              <div class="interlock-item">
                <div class="circle bg-success"></div>
                <div>Water</div>
              </div>
              <div class="interlock-item">
                <div class="circle bg-success"></div>
                <div>Door</div>
              </div>
              <div class="interlock-item">
                <div class="circle bg-success"></div>
                <div>Timer</div>
              </div>
              <div class="interlock-item">
                <div class="circle bg-success"></div>
                <div>Oil High</div>
              </div>
              <div class="interlock-item">
                <div class="circle bg-success"></div>
                <div>Oil Low</div>
              </div>
              <div class="interlock-item">
                <div class="circle bg-danger"></div>
                <div>E-stop Ext</div>
              </div>
              <div class="interlock-item">
                <div class="circle bg-danger"></div>
                <div>E-stop Int</div>
              </div>
              <div class="interlock-item">
                <div class="circle bg-success"></div>
                <div>QGSP Active</div>
              </div>
            </div>
          </div>

          <!-- Vacuum Indicators Section -->
          <div class="vacuum-indicators">
            <h3 class="dashboard-subtitle vacuum-indicators-title">Vacuum Indicators</h3>
            <div class="vacuum-indicators-container">
              <div class="vacuum-indicators-item">
                <div class="vacuum-indicators-circle"></div>
                <div>Pumps Power ON</div>
              </div>
              <div class="vacuum-indicators-item">
                <div class="vacuum-indicators-circle"></div>
                <div>Turbo Rotor ON</div>
              </div>
              <div class="vacuum-indicators-item">
                <div class="vacuum-indicators-circle"></div>
                <div>Turbo Vent Open</div>
              </div>
              <div class="vacuum-indicators-item">
                <div class="vacuum-indicators-circle"></div>
                <div>972b Power On</div>
              </div>
              <div class="vacuum-indicators-item">
                <div class="vacuum-indicators-circle"></div>
                <div>Turbo Gate Valve Closed</div>
              </div>
              <div class="vacuum-indicators-item">
                <div class="vacuum-indicators-circle"></div>
                <div>Turbo Gate Valve Open</div>
              </div>
              <div class="vacuum-indicators-item">
                <div class="vacuum-indicators-circle"></div>
                <div>Argon Gate Valve Open</div>
              </div>
              <div class="vacuum-indicators-item">
                <div class="vacuum-indicators-circle"></div>
                <div>Argon Gate Valve Closed</div>
              </div>
            </div>
          </div>

          <!-- Environmental Section -->
          <div class="env-section">
            <h3 class="dashboard-subtitle env-title">Environmental</h3>
            <div class="env-container">
              <!-- Bar 1: Solenoid 1 -->
              <div class="env-item">
                <div class="env-item-header">Solenoid 1</div>
                <div class="env-bar-scale">
                  <div class="env-scale">
                    <span>100</span>
                    <span>80</span>
                    <span>60</span>
                    <span>40</span>
                    <span>20</span>
                    <span>0</span>
                  </div>
                  <div class="env-bar-outer">
                    <div class="env-bar-inner" style="height: 20%;"></div>
                  </div>
                </div>
              </div>
              
              <!-- Bar 2: Solenoid 2 -->
              <div class="env-item">
                <div class="env-item-header">Solenoid 2</div>
                <div class="env-bar-scale">
                  <div class="env-scale">
                    <span>100</span>
                    <span>80</span>
                    <span>60</span>
                    <span>40</span>
                    <span>20</span>
                    <span>0</span>
                  </div>
                  <div class="env-bar-outer">
                    <div class="env-bar-inner" style="height: 40%;"></div>
                  </div>
                </div>
              </div>

              <!-- Bar 3: Chmbr Bot -->
              <div class="env-item">
                <div class="env-item-header">Chmbr Bot</div>
                <div class="env-bar-scale">
                  <div class="env-scale">
                    <span>100</span>
                    <span>80</span>
                    <span>60</span>
                    <span>40</span>
                    <span>20</span>
                    <span>0</span>
                  </div>
                  <div class="env-bar-outer">
                    <div class="env-bar-inner" style="height: 100%;"></div>
                  </div>
                </div>
              </div>

              <!-- Bar 4: Chmbr Top -->
              <div class="env-item">
                <div class="env-item-header">Chmbr Top</div>
                <div class="env-bar-scale">
                  <div class="env-scale">
                    <span>100</span>
                    <span>80</span>
                    <span>60</span>
                    <span>40</span>
                    <span>20</span>
                    <span>0</span>
                  </div>
                  <div class="env-bar-outer">
                    <div class="env-bar-inner" style="height: 100%;"></div>
                  </div>
                </div>
              </div>

              <!-- Bar 5: Air temp -->
              <div class="env-item">
                <div class="env-item-header">Air temp</div>
                <div class="env-bar-scale">
                  <div class="env-scale">
                    <span>100</span>
                    <span>80</span>
                    <span>60</span>
                    <span>40</span>
                    <span>20</span>
                    <span>0</span>
                  </div>
                  <div class="env-bar-outer">
                    <div class="env-bar-inner" style="height: 60%;"></div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Log Viewer -->
          <div class="row justify-content-center">
            <div class="col-lg-12">
              <div class="glass-container p-4">
                <button id="toggleButton" class="btn-toggle">Show Full Log</button>
                <div id="previewContent" class="content-section active">
                  <pre>${previewContent}</pre>
                  <p class="text-center text-info mt-2">
                    Showing first 20 lines. Click the button above to see the full log.
                  </p>
                </div>
                <div id="fullContent" class="content-section">
                  <pre>${reversedContents}</pre>
                  <p class="text-center text-info mt-2">
                    Showing full log. Click the button above to see the preview.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Auto-refresh & Toggle Script -->
        <script>
          // Refresh every minute
          setTimeout(function() {
            location.reload();
          }, 60000);

          // Toggle between preview/full log
          const toggleButton = document.getElementById('toggleButton');
          const previewSection = document.getElementById('previewContent');
          const fullSection = document.getElementById('fullContent');
          let showingFull = false;
          
          function toggleContent() {
            if (showingFull) {
              previewSection.className = 'content-section active';
              fullSection.className = 'content-section';
              toggleButton.textContent = 'Show Full Log';
            } else {
              previewSection.className = 'content-section';
              fullSection.className = 'content-section active';
              toggleButton.textContent = 'Show Preview';
            }
            showingFull = !showingFull;
          }
          toggleButton.onclick = toggleContent;
        </script>
      </body>
      </html>
    `);
  } catch (err) {
    console.error(err);
    res.status(500).send(`Error: ${err.message}`);
  }
});



/**
 * GET /raw : Returns just the reversed text (newest at top).
 */
app.get('/raw', async (req, res) => {
  try {
    if (fs.existsSync(REVERSED_TEMP_FILE_PATH)) {
      await new Promise((r) => setTimeout(r, 500));
    }

    if (fs.existsSync(REVERSED_FILE_PATH)) {
      const content = await fs.promises.readFile(REVERSED_FILE_PATH, 'utf8');
      res.type('text/plain').send(content);
    } else {
      res.status(404).send("No file found.");
    }
  } catch (err) {
    console.error(err);
    res.status(500).send(`Error: ${err.message}`);
  }
});


// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
