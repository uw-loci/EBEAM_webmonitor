const express = require('express');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const https = require('https');
const axios = require('axios');
const lockFile = require('proper-lockfile');
const { PassThrough } = require('stream');
const logDataExtractionApiRoutes = require('./log_data_extraction');

// Load environment variables
require('dotenv').config();

const FOLDER_ID = process.env.FOLDER_ID;
const API_KEY = process.env.API_KEY;
const LOG_DATA_EXTRACTION_KEY = process.env.LOG_DATA_EXTRACTION_KEY;
const PORT = process.env.PORT || 3000;

// File paths for local storage
const REVERSED_FILE_PATH = path.join(__dirname, 'reversed.txt');
// Temp_File paths for local storage
// const REVERSED_TEMP_FILE_PATH = path.join(__dirname, 'test.txt');

// 15 minutes in milliseconds
const INACTIVE_THRESHOLD = 15 * 60 * 1000;

// Initialize Express app
const app = express();
app.use('/log-data-extraction', logDataExtractionApiRoutes);

// Initialize Google Drive API
const drive = google.drive({ version: 'v3', auth: API_KEY });

// variable to store the data extracted
let data = null;

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
let response = null;
let shouldReload = false;

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
 * Get the extracted lof data from log file from API end point
 * 
 * @returns the data read form the log file in the format
 * 
 * 
 * extected repsonse var form the end point once fixed
  data = {
      "Pressure": 1200,
      "Safety Flags": [0, 0, 0, 0, 0, 0, 1],
      "Temperatures": {
          "1": "18.94",
          "2": "19.00",
          "3": "22.83",
          "4": "20.38",
          "5": "21.88",
          "6": "19.31"
      }
    }
 */
async function extractData() {
  try {
    response = await axios.get('https://ebeam-webmonitor.onrender.com/log-data-extraction/data', {
      headers: {
        'x-api-key': LOG_DATA_EXTRACTION_KEY
      }});
    
    if (response.status !== 200) {
      console.warn(`API request failed with status: ${response.status}. Returning empty data.`);
      return { // Return an empty object on failure
        pressure: null,
        safetyFlags: null,
        temperatures: null
      };
    }

    // only for testing accessing
    console.log("Data: ", response.data);
    // console.log("Data: ", data.data);

    // Accessing each data field:
    const pressure = response.data.pressure; // Access Pressure (e.g., 1200)
    // const safetyFlags = data.data.safetyFlags[0]; // Access Safety Flags array
    const temperatures = response.data.temperatures; // Access Temperatures object
    // const timestamp = response.NEW; // Access the timestamp (or NEW field)
    

    // For example, to access the first temperature reading:
    // const temperatureSensor1 = temperatures["1"]; // "18.94"

    // You can now use these variables as needed in your front end.
    console.log('Pressure:', pressure);
    // console.log('Safety Flags:', safetyFlags);
    console.log('Temperatures:', temperatures['1']);
    
  } catch (e) {
    console.log("Error: ", e);
  }

  return response;
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

    // First check if the experiment is active
    if (currentTime - fileModifiedTime > INACTIVE_THRESHOLD) { 
      // experiment is inactive and we are outside the 15 min. window
      experimentRunning = false; // experiment is not running
      if (!fs.existsSync(REVERSED_FILE_PATH)) {
        // We don't have a "REVERSED_FILE_PATH.file" on server so we fetch the file from google
        console.log("Experiment not running but passing through");
      } else {
        // if REVERSED_FILE_PATH.file exists then return, no need to read.
        console.log("Experiment not running - no updates in 15 minutes");
        shouldReload = false;
        data = extractData(); // only for testing has to be removed after
        return false;
      }
    }
    //The experiment is running
    if (lastModifiedTime && lastModifiedTime === mostRecentFile.modifiedTime) {
      // Use the cached file if it didn't change from last time instead of fetching again. 
      console.log("No new updates. Using cached file.");
      experimentRunning = true;
      shouldReload = false;
      if (fs.existsSync(REVERSED_FILE_PATH)) {
        data = extractData();
      } else {
        data = null;
        console.log("File None existant -- Could not extract the log data");
      }

      return false;
    }
    
    // fetch file
    console.log("Fetching new file...");
    let lines = await fetchFileContents(mostRecentFile.id);
    lines.reverse();

    // Write to file first
    // if (!fs.existsSync(REVERSED_FILE_PATH)) {
    //   fs.writeFileSync(REVERSED_FILE_PATH, '', 'utf8');
    // }

    // fs.writeFileSync(REVERSED_TEMP_FILE_PATH, 'hii ', 'utf8'); // only for debugging

    // release = await lockFile.lock(REVERSED_TEMP_FILE_PATH); // lock original path

    const writeStream = fs.createWriteStream(REVERSED_FILE_PATH, { flags: 'w' });
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
          // fs.renameSync(REVERSED_TEMP_FILE_PATH, REVERSED_FILE_PATH); // atomic replace
          console.log('Reversed log updated successfully.');
          lastModifiedTime = mostRecentFile.modifiedTime;
          logFileName = mostRecentFile.name;
          experimentRunning = true;
          shouldReload = true;

          if (fs.existsSync(REVERSED_FILE_PATH)) {
            try {
              data = await extractData(); // AWAIT the result!
            } catch (error) {
              console.log("Error extracting data:", error);
              data = null; // Or handle this appropriately
            }
          } else {
            data = null;
            console.log("File None existant -- Could not extract the log data");
          }

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
    data = null
    console.log("Could not extract the log data");
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
    // if (fs.existsSync(REVERSED_TEMP_FILE_PATH)) {
    //   // Temp write is in progress — delay response briefly
    //   await new Promise((r) => setTimeout(r, 500));
    // }

    let reversedContents = "No data available.";
    if (fs.existsSync(REVERSED_FILE_PATH)) {
      reversedContents = await fs.promises.readFile(REVERSED_FILE_PATH, 'utf8');
    }else{
      reversedContents = `No data available. no ${REVERSED_FILE_PATH} on the server.`;
    }

    const contentLines = reversedContents.split('\n');
    const previewContent = contentLines.slice(0, 20).join('\n');
    // console.log("Preview content (first 20 lines):\n", previewContent);

    const fileModified = lastModifiedTime 
      ? new Date(lastModifiedTime).toLocaleString("en-US", { timeZone: "America/Chicago" })
      : "N/A";
    const currentTime = new Date().toLocaleString("en-US", { timeZone: "America/Chicago" });

    console.log("Data: ", data) // throwing an error on render.

    // Accessing each data field:
    const pressure = data.pressure; // Access Pressure (e.g., 1200)
    const temperatures = data.temperatures;
    // const safetyFlags = data.data.safetyFlags; // Access Safety Flags array
    // const temperatures = response.Temperatures; // Access Temperatures object
    // const timestamp = response.NEW; // Access the timestamp (or NEW field)
    

    // For example, to access the first temperature reading:
    // const temperatureSensor1 = temperatures["1"]; // "18.94"

    // You can now use these variables as needed in your front end.
    console.log('Pressure:', pressure);
    // console.log('Safety Flags:', safetyFlags);
    // console.log('Temperatures:', temperatures);
    // console.log('Timestamp:', timestamp);
    // console.log('Temperature from sensor 1:', temperatureSensor1);

    // temp var 
    const temp = JSON.stringify(data.data);

    //  keep your HTML generation as-is below this
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
            /* background: linear-gradient(-45deg, #001f3f, #003366, #005a9e); */
            background: #0d1117;
            background-size: 400% 400%;
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
            background: rgba(30, 30, 30, 0.9);

            /* backdrop-filter: blur(20px);
            -webkit-backdrop-filter: blur(20px); */

            border-radius: 8px;
            padding: 30px;

            /* box-shadow: 0px 4px 25px rgba(255, 255, 255, 0.15); */

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
            /* text-shadow: 0px 0px 12px rgba(214, 234, 255, 0.6),
                         0px 0px 20px rgba(214, 234, 255, 0.4); */
          }
          
          /* .dashboard-title::after {
            content: "";
            display: block;
            width: 60%;
            height: 5px;
            background: rgba(0, 255, 255, 0.8);
            margin: 10px auto;
            box-shadow: 0px 0px 15px rgba(0, 255, 255, 1);
            border-radius: 10px;
          } */

          .dashboard-subtitle {
            font-size: 0.9em;
            margin-bottom: 25px;
            text-align: left;
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
            font-size: 0.9em;
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
            font-size: 0.75em;
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
            width: 30px;
            height: 30px;
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
            font-size: 0.9em;
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
            font-size: 0.75em;
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
            width: 30px;
            height: 30px;
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

          /* Radial Gauges*/
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
          /* .gauge-circle {
            width: 40px;
            height: 40px;
            border-radius: 50%;
            background: conic-gradient(#ccc 0deg, #ccc 360deg);
            position: relative;
            margin: 0 auto 0.5rem;
            transition: background 0.3s;
          } */
          /* .gauge-cover {
            position: absolute;
            top: 12px; left: 12px;
            width: 60px; height: 60px;
            background: rgba(0,0,0,0.4);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 1em;
            color: #fff;
          }
          .sensor-label { font-weight: bold; } */
          

          /* horizontal layout */
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
          .gauge-circle {
            width: 40px;
            height: 40px;
            border-radius: 50%;
            background: conic-gradient(#ccc 0deg, #ccc 360deg);
            position: relative;
            margin: 0 auto 0.5rem;
            transition: background 0.3s;
          }
          .gauge-cover {
            width: 100%;
            height: 100%;
            border-radius: 50%;
            background: rgba(0, 0, 0, 0.4);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 1em;
            color: #fff;
          }
          .sensor-label { font-weight: bold; }


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
            margin-top: 2.75em;
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
            padding: 10px 20px;
            font-size: 0.75em;
            border-radius: 5px;
            cursor: pointer;
            transition: background-color 0.3s ease;
            float: right;
            margin-top: -3.5em;
            margin-bottom: 10px;
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
            padding: 5px 10px;
            font-size: 0.7em;
            background-color: rgba(255, 0, 0, 0.2);
            border: 2px solid red;
            border-radius: 8px;
            box-shadow: 0 0 10px red;
            text-shadow: 0 0 10px red;
            color: white;
            font-weight: bold;
            z-index: 9999;
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
            <strong>Last Update:</strong> ${currentTime}
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
          <!-- Environmental Section (Horizontal Radial Gauges) -->
          <div class="env-section">
            <h3 class="dashboard-subtitle env-title">Environmental</h3>
            <div class="gauge-grid">
              <div class="gauge" id="sensor-1">
                <div class="gauge-circle"><div class="gauge-cover">${temperatures["1"] || '--'}°C</div></div>
                <div class="sensor-label">Solenoid 1</div>
              </div>
              <div class="gauge" id="sensor-2">
                <div class="gauge-circle"><div class="gauge-cover">${temperatures["2"] || '--'}°C</div></div>
                <div class="sensor-label">Solenoid 2</div>
              </div>
              <div class="gauge" id="sensor-3">
                <div class="gauge-circle"><div class="gauge-cover">${temperatures["3"] || '--'}°C</div></div>
                <div class="sensor-label">Chmbr Bot</div>
              </div>
              <div class="gauge" id="sensor-4">
                <div class="gauge-circle"><div class="gauge-cover">${temperatures["4"] || '--'}°C</div></div>
                <div class="sensor-label">Chmbr Top</div>
              </div>
              <div class="gauge" id="sensor-5">
                <div class="gauge-circle"><div class="gauge-cover">${temperatures["5"] || '--'}°C</div></div>
                <div class="sensor-label">Air temp</div>
              </div>
              <div class="gauge" id="sensor-6">
                <div class="gauge-circle"><div class="gauge-cover">${temperatures["6"] || '--'}°C</div></div>
                <div class="sensor-label">Extra 6</div>
              </div>
            </div>
          </div>

          <!-- Log Viewer -->
            <div class="env-section">
              <h3 class="dashboard-subtitle env-title">System Logs</h3>
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


        <!-- Auto-refresh & Toggle Script -->
        <script>
          // Refresh every minute
          setTimeout(function() {
            if (shouldReload) {
              location.reload();
            }
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
    // if (fs.existsSync(REVERSED_TEMP_FILE_PATH)) {
    //   await new Promise((r) => setTimeout(r, 500));
    // }

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