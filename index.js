///////////////////////////////////////////////////////////////////////////////
//  index.js - E-beam Log Monitor Server
//
//  Description:
//  -------------
//  Express.js server to monitor log files from Google Drive in real-time,
//  reverse their contents, extract structured experimental data (pressure,
//  interlocks, temperature, etc.), and serve it via API endpoints and a
//  futuristic web dashboard (with Glassmorphism styling).
//
//  Responsibilities:
//  -------------
//  - Polls Google Drive for the latest log file
//  - Extracts and parses log entries (pressure, flags, temps, etc.)
//  - Infers interlock statuses and vacuum system state
//  - Serves data via JSON and a responsive HTML frontend
//  - Automatically refreshes UI and supports raw file viewing
//
//  Author: Brandon, Pratyush, Arundhati, Anurag
//
//  TODO:
//  -----
//  [ ] Abstract and reuse the `data` object structure via helper
//  [ ] Add error boundary UI on frontend
//  [ ] Move HTML template into separate EJS/Pug/React file later
//  [ ] Add caching & retry strategy for failed fetches
//
///////////////////////////////////////////////////////////////////////////////


// Load environment variables
const express = require('express');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { debug, time } = require('console');
//const axios = require('axios');
const app = express();
app.use(express.static(path.join(__dirname, 'assets')));
require('dotenv').config();

// Credentials; find them in env file (ASK Brandon about it or any of the authors)
const FOLDER_ID = process.env.FOLDER_ID;
const API_KEY = process.env.API_KEY;
const PORT = process.env.PORT || 3000;
// check credentials are in var and assume they are ture.
if (!FOLDER_ID || !API_KEY) {
  console.error( "Missing FOLDER_ID or API_KEY in environment variables. Exiting...");
  process.exit(1);
}

// File Paths
const REVERSED_FILE_PATH = path.join(__dirname, 'reversed.txt');
// const REVERSED_FILE_PATH = path.join(__dirname, 'sample_wm_logfile.txt');  // Temp_File paths for local storage

// Initialize Google Drive API
const drive = google.drive({ version: 'v3', auth: API_KEY });

//// Global variables
let lastModifiedTime = null;
let experimentRunning = false;
// Inactivity threshold for deciding if the experiment is "stale" (15 min in ms)
const INACTIVE_THRESHOLD = 2 * 60 * 1000;
let dataLines = null;
let debugLogs = [];

let sampleDataLines = [];
let timestamps = [];

let extractLines = [];

const baseStatus = {
  safetyOutputDataFlags: [1, 1, 1, 0, 0, 0, 1],
  safetyInputDataFlags: [0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0],
  safetyOutputStatusFlags: [1, 1, 1, 1, 1, 1, 1],
  safetyInputStatusFlags: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  temperatures: {
    "1": "20.42",
    "2": "19.93",
    "3": "23.82",
    "4": "20.81",
    "5": "27.03",
    "6": "20.66"
  },
  vacuumBits: "11010101",
  "Cathode A - Heater Current:": null,
  "Cathode B - Heater Current:": null,
  "Cathode C - Heater Current:": null,
  "Cathode A - Heater Voltage:": null,
  "Cathode B - Heater Voltage:": null,
  "Cathode C - Heater Voltage:": null,
  clamp_temperature_A: null,
  clamp_temperature_B: null,
  clamp_temperature_C: null
};

// Helper: Get current timestamp in "YYYY-MM-DD HH:mm:ss"
function getTimestamp() {
  const now = new Date();
  return now.toISOString().replace('T', ' ').substring(0, 19);
}

// Helper: Generate random pressure between 7.60e-8 and 1.20e+3
function randomPressure() {
  const min = 7.60e-8;
  const max = 1.20e+3;
  const pressure = Math.random() * (max - min) + min;
  return pressure.toExponential(2);
}

// Generate a single log line
function generateLogLine() {
  return {
    timestamp: getTimestamp(),
    status: {
      pressure: randomPressure(),
      ...baseStatus
    }
  };
}

// Add 2 lines every minute
function addLogs() {
  if (sampleDataLines.length < 10) {
    for (let i = 0; i < 1; i++) {
      const line = generateLogLine();
      sampleDataLines.push(JSON.stringify(line));
    }
  }
}


// variable Structure to store ALL the data extracted 
let data = {
  pressure: null,
  pressureTimestamp: null,
  safetyOutputDataFlags: null,
  safetyInputDataFlags: null,
  safetyOutputStatusFlags: null,
  safetyInputStatusFlags: null,
  temperatures: null, 
  vacuumBits: null
};

function createGraphObj(options = {}) {
  return {
    fullXVals: options.fullXVals || [],
    fullYVals: options.fullYVals || [],
    displayXVals: options.displayXVals || [],
    displayYVals: options.displayYVals || [],
    maxDataPoints: options.maxDataPoints ?? 1000, // change later when experiment is running
    maxDisplayPoints: options.maxDisplayPoints ?? 256,
    lastUsedFactor: options.lastUsedFactor ?? 1,
    lastPermanentIndex: options.lastPermanentIndex ?? -1,
    chartDataIntervalCount: options.chartDataIntervalCount ?? 0,
    chartDataIntervalDuration: options.chartDataIntervalDuration ?? 1,
  };
}

let pressureGraph = createGraphObj();
let sampleGraph = createGraphObj();



// const fullXVals = [];
// const fullYVals = [];
// const displayXVals = [];
// const displayYVals = [];

// // Downsampling state
// let lastUsedFactor = 1;
// let lastPermanentIndex = -1;
  
// let chartDataIntervalCount = 0; // Track how many 60-second intervals have passed
// let chartDataIntervalDuration = 1; // Default value for n minutes
// // change to 4320 for 3 days of data at 1 point per minute
// const MAX_CHART_DATA_POINTS = 2880 / chartDataIntervalDuration; // Maximum number of points to display on the chart
// const MAX_CHART_DISPLAY_POINTS = 256; // Maximum number of points to display on the chart

// Add a new sinusoidal data point using current time as x
function addSampleChartDataPoint() {
  
  const nowMs = Date.now();
  const tSec = Math.floor(nowMs / 1000);
  const y = Math.sin(tSec / 10); // simple sinusoid

  sampleGraph.fullXVals.push(tSec);
  sampleGraph.fullYVals.push(y);

  updateDisplayData(sampleGraph);
}

// Simplified update function (no loop for multiple permanent points)
function updateDisplayData(graph) {
  const len = graph.fullXVals.length;

  const predictedPoints = Math.ceil((len - 1) / graph.lastUsedFactor) + 1;

  if (predictedPoints > graph.maxDisplayPoints) {
    // Increase factor and reset
    graph.lastUsedFactor *= 2;
    graph.lastPermanentIndex = -1;
    graph.displayXVals.length = 0;
    graph.displayYVals.length = 0;

    for (let i = 0; i < len - 1; i += graph.lastUsedFactor) {
      graph.displayXVals.push(graph.fullXVals[i]);
      graph.displayYVals.push(graph.fullYVals[i]);
      graph.lastPermanentIndex = i;
    }

    // Add latest point
    graph.displayXVals.push(graph.fullXVals[len - 1]);
    graph.displayYVals.push(graph.fullYVals[len - 1]);

  } else {
    if (len - 1 === graph.lastPermanentIndex + graph.lastUsedFactor + 1) {
      // Previous latest is now permanent
      graph.displayXVals.push(graph.fullXVals[len - 1]);
      graph.displayYVals.push(graph.fullYVals[len - 1]);
      graph.lastPermanentIndex = len - 2;

    } else {
      if (graph.displayXVals.length > 0) {
        // Update latest point in place
        graph.displayXVals[graph.displayXVals.length - 1] = graph.fullXVals[len - 1];
        graph.displayYVals[graph.displayYVals.length - 1] = graph.fullYVals[len - 1];
      } else {
        // First data point ever
        graph.displayXVals.push(graph.fullXVals[len - 1]);
        graph.displayYVals.push(graph.fullYVals[len - 1]);
      }
    }
  }
}


// Assume All Interlocks Start Red
// const interlockStates = {
//  "Door": "red",
//  "Water": "red",
//  "Vacuum Power": "red",
//  "Vacuum Pressure": "red",
//  "Low Oil": "red",
//  "High Oil": "red",
//  "E-STOP Int": "red",
//  "E-STOP Ext": "red",
//  "All Interlocks": "red",
//  "G9SP Active": "red",
//  "HVolt ON": "red",
// };

// Quick helper function to help with data to color while integration
// 1 --> green, 0 --> red, Default --> grey.

// Interlocks
function getDoorStatus(inputFlags, statusFlags) {
  if (!Array.isArray(inputFlags) || !Array.isArray(statusFlags)) return "grey";
  if (!inputFlags || inputFlags.length < 13 || !statusFlags || statusFlags.length < 13) return "grey";
  const data = inputFlags[4] && inputFlags[5];
  const status_f = statusFlags[4] && statusFlags[5];
  return (data && status_f)? "green" : "red";
}


function getVacuumPower(inputFlags, statusFlags) {
  if (!Array.isArray(inputFlags) || !Array.isArray(statusFlags)) return "grey";
  if (!inputFlags || inputFlags.length < 13 || !statusFlags || statusFlags.length < 13) return "grey";
  const data = inputFlags[6];
  const status_f = statusFlags[6];
  return (data && status_f)? "green" : "red";
}


function getVacuumPressure(inputFlags, statusFlags) {
  if (!Array.isArray(inputFlags) || !Array.isArray(statusFlags)) return "grey";
  if (!inputFlags || inputFlags.length < 13 || !statusFlags || statusFlags.length < 13) return "grey";
  const data = inputFlags[7];
  const status_f = statusFlags[7];
  return (data && status_f)? "green" : "red";
}


function getAllInterlocksStatus(outputFlags) {
 if (!Array.isArray(outputFlags) || !Array.isArray(outputFlags)) return "grey";
 if (!outputFlags || outputFlags.length < 7) return "grey";
 if (outputFlags[6]) return "red";
 return outputFlags[5] ? "green" : "red";
}


function getWaterStatus(inputFlags, statusFlags) {
  if (!Array.isArray(inputFlags) || !Array.isArray(statusFlags)) return "grey";
  if (!inputFlags || inputFlags.length < 13 || !statusFlags || statusFlags.length < 13) return "grey";
  const data = inputFlags[10];
  const status_f = statusFlags[10];
  return (data && status_f)? "green" : "red";
}


function getG9Output(outputFlags) {
 if (!Array.isArray(outputFlags) || !Array.isArray(outputFlags)) return "grey";
 if (!outputFlags || outputFlags.length < 7) return "grey";
 return outputFlags[4] ? "green" : "red";
}


function getEStopInternal(inputFlags, statusFlags) {
  if (!Array.isArray(inputFlags) || !Array.isArray(statusFlags)) return "grey";
  if (!inputFlags || inputFlags.length < 13 || !statusFlags || statusFlags.length < 13) return "grey";
  const data = inputFlags[0] && inputFlags[1];
  const status_f = statusFlags[0] && statusFlags[1];
  return (data && status_f)? "green" : "red";
}


function getEStopExternal(inputFlags, statusFlags) {
  if (!Array.isArray(inputFlags) || !Array.isArray(statusFlags)) return "grey";
  if (!inputFlags || inputFlags.length < 13 || !statusFlags || statusFlags.length < 13) return "grey";
  const data = inputFlags[2] && inputFlags[3];
  const status_f = statusFlags[2] && statusFlags[3];
  return (data && status_f)? "green" : "red";
}


function getOilLow(inputFlags, statusFlags) {
  if (!Array.isArray(inputFlags) || !Array.isArray(statusFlags)) return "grey";
  if (!inputFlags || inputFlags.length < 13 || !statusFlags || statusFlags.length < 13) return "grey";
  const data = inputFlags[9];
  const status_f = statusFlags[9];
  return (data && status_f)? "green" : "red";
}


function getOilHigh(inputFlags, statusFlags) {
  if (!Array.isArray(inputFlags) || !Array.isArray(statusFlags)) return "grey";
  if (!inputFlags || inputFlags.length < 13 || !statusFlags || statusFlags.length < 13) return "grey";
  const data = inputFlags[8];
  const status_f = statusFlags[8];
  return (data && status_f)? "green" : "red";
}


function getHvoltOn(inputFlags, statusFlags) {
  if (!Array.isArray(inputFlags) || !Array.isArray(statusFlags)) return "grey";
  if (!inputFlags || inputFlags.length < 13 || !statusFlags || statusFlags.length < 13) return "grey";
  const data = inputFlags[11];
  const status_f = statusFlags[11];
  if (data == 0 && status_f == 1){
    return "green"
  }
  else{
    return "red"
  }
}

// Vacuum Indicators
function varBitToColor(bits, index) {
  if (!Array.isArray(bits) || bits.length < 8) return "grey";   // Default
  return bits[index] ? "green" : "red";                         // 1 --> green, 0 --> red
}


const chicagoTimeFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
  hour12: false
});

function secondsSinceMidnightChicago() {
  const parts = chicagoTimeFormatter.formatToParts(new Date());
  let hours = 0, minutes = 0, seconds = 0;

  for (const part of parts) {
    if (part.type === 'hour') hours = parseInt(part.value, 10);
    else if (part.type === 'minute') minutes = parseInt(part.value, 10);
    else if (part.type === 'second') seconds = parseInt(part.value, 10);
  }

  return hours * 3600 + minutes * 60 + seconds;
}

// function secondsSinceMidnightChicago() {
//  const now = new Date().toLocaleString("en-US", { timeZone: "America/Chicago" });
//  const d = new Date(now);
//  return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
// }

/**
 * Fetch the single most-recent plain-text log file in the Drive folder.
 *
 * Steps:
 * 1) Drive API list call:
 *      - Folder constraint:  `'${LOG_FOLDER_ID}' in parents`
 *      - File type filter:   `mimeType='text/plain'`
 * 2) Sort descending by `modifiedTime` so index 0 is newest.
 * 3) Return that file’s `{ id, name, modifiedTime }`.
 *
 * On any error (API or empty list) we log it and return `null`
 * so the caller can decide whether to retry or mark the experiment inactive.
 *
 * @returns {Promise<{id: string, name: string, modifiedTime: string}|null>}
 */
async function getMostRecentFile() {
  try {
    const res = await drive.files.list({
      q: `'${FOLDER_ID}' in parents and mimeType='text/plain'`, // filter by folder & .txt
      orderBy: 'modifiedTime desc',                             // newest first
      pageSize: 5,                                              // only need one file
      fields: 'files(id, name, modifiedTime)',                  // minimal field set
    });

    const files = res.data.files;
    console.log("Latest files seen:", files.map(f => f.name));
    // debugLogs.push(`Latest files seen: ${files.map(f => f.name).join(', ')}`);


    // let dataFile = files[1];
    // console.log('dataFile', dataFile);

    let displayFile = null;

    if (!files || files.length === 0) {
      throw new Error('No files found in the folder.');
    }

    // can optimize this futher - temporary fix for now.
    let dataFile = null;

    for (const file of files){
      if (file.name.startsWith('webMonitor')){
        dataFile = file;
        console.log(dataFile);
        console.log("DATA FILE'S ID: ", dataFile.id)
      }
      else if (file.name.startsWith('log_')){
        displayFile = file;
      }
      //TEMP CHANGE: Add Display File here
      if (dataFile) break;
    }
    return {dataFile, displayFile};
  
  } catch (err) {
    console.error(`Google Drive API Error: ${err.message}`);
    return {dataFile: null, displayFile: null};
  }
}

/**
 * Stream-downloads a text file from Google Drive and returns its lines.
 *
 * Why streaming?
 * ---  Avoids loading large logs entirely into memory.
 *
 * Retry policy:
 * ---  Up to three attempts (2 second back-off) on any network/HTTP error.
 *
 * @param  {string} fileId  Google Drive file ID to fetch
 * @returns {Promise<string[]>}  All lines in the file (preserves order)
 */
async function fetchFileContents(fileId) {
  let retries = 3;

  while (retries > 0) {
    try {
      // -------------------------------------------------------------
      // 1) Download the file as a stream via HTTPS (public Drive API)
      // -------------------------------------------------------------
      const response = await new Promise((resolve, reject) => {
        https
          .get(
            `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&key=${API_KEY}`,
            { headers: { Accept: 'text/plain' } },
            res => {
              if (res.statusCode !== 200) {
                reject(new Error(`Google API Failed: ${res.statusCode}`));
                return;
              }
              resolve(res);     // pass the readable stream forward
            }
          )
          .on('error', reject); // network-level error
      });

      // -------------------------------------------------------------
      // 2) Read the stream chunk-by-chunk and split into lines
      //    (handles cases where a line breaks across chunks)
      // -------------------------------------------------------------
      const lines = [];
      let currentLine = '';
      // const MAX_LINES = 100

      await new Promise((resolve, reject) => {
        response.on('data', chunk => {
          const chunkStr   = chunk.toString();
          const chunkLines = (currentLine + chunkStr).split('\n');
          currentLine = chunkLines.pop();   // last part may be incomplete
          lines.push(...chunkLines);
        });

        response.on('end', () => {
          if (currentLine){
            lines.push(currentLine);
          }  // push final partial
          resolve();
        });

        response.on('error', reject); // stream error
      });

      return lines; // success – return the collected lines

    } catch (err) {
      console.log(`Retry ${4 - retries}: ${err.message}`);
      return false

      // TEMP CHANGE: Uncomment this chunk after fixing fetch issues with data file
      // retries--;

      // if (retries === 0) {
      //   // Out of retries – bubble the error up
      //   throw err;
      // }

      // // Simple back-off (2 sec) before the next attempt
      // await new Promise(res => setTimeout(res, 2000));
    }
  }
}


/**
 * Parses log lines and extracts key experimental values.
 * This function is responsible for scanning log entries and pulling out:
 * - Pressure and timestamp
 * - Safety output/input data flags
 * - Temperature values
 * - Vacuum state bits (VTRX)
 * 
 * The extraction process is constrained to only consider "fresh" data, i.e., 
 * entries not older than 15 minutes from current time (to avoid stale logs).
 * 
 * Each data field is extracted only once — the newest valid value is kept.
 * Stops early if all values are found.
 * 
 * Returns:
 * - true if extraction completed (even if partial)
 * 
 * Throws:
 * - Error if something goes wrong unexpectedly during parsing.
 */

async function extractData(lines){
  // FIXME: how is extraction constrained to only fresh data
  // extractLines = lines; // store for debugging

  try{
    data = {
      pressure: null,
      pressureTimestamp: null,
      safetyInputDataFlags: null,
      safetyOutputDataFlags: null,
      safetyInputStatusFlags: null,
      safetyOutputStatusFlags: null,
      temperatures: null,
      vacuumBits: null,
      heaterCurrent_A: null,
      heaterCurrent_B: null,
      heaterCurrent_C: null,
      heaterVoltage_A: null,
      heaterVoltage_B: null,
      heaterVoltage_C: null,
      clamp_temperature_A: null,
      clamp_temperature_B: null,
      clamp_temperature_C: new Date().toISOString()
    };

    let firstTimestamp = null;

    // Loop through each line in the log file
    for (let i = 0; i < lines.length; i++){
      const line = lines[i]

      let jsonData;
      
      try {
        // Parse the JSON object from the line
        jsonData = JSON.parse(line);
      } catch (e) {
        console.log(`Error parsing JSON at line ${i}:`, line, e);
        continue; // Skip to the next line if JSON parsing fails
      }
      
      if (firstTimestamp === null && jsonData.timestamp) {
        firstTimestamp = new Date(jsonData.timestamp);
      }

      // if (firstTimestamp && jsonData.timestamp) {
      //   const currentTimestamp = new Date(jsonData.timestamp);
      //   const elapsedSeconds = (currentTimestamp - firstTimestamp) / 1000;

      //   if (elapsedSeconds > 60) {
      //     console.log("Reached 1-minute window. Stopping.");
      //     break;
      //   }
      // }

      const status = jsonData.status || {};

      

      if (status.pressure != null && data.pressure === null) {
        data.pressure          = parseInt(status.pressure) + Math.random() * 10;
        timestamps.push(jsonData.timestamp);
        data.pressureTimestamp = new Date(jsonData.timestamp.replace(" ", "T")).getTime();
      }
      if (status.safetyOutputDataFlags && data.safetyOutputDataFlags === null) {
        data.safetyOutputDataFlags = status.safetyOutputDataFlags;
      }
      if (status.safetyInputDataFlags && data.safetyInputDataFlags === null) {
        data.safetyInputDataFlags = status.safetyInputDataFlags;
      }
      if (status.safetyOutputStatusFlags && data.safetyOutputStatusFlags === null) {
        data.safetyOutputStatusFlags = status.safetyOutputStatusFlags;
      }
      if (status.safetyInputStatusFlags && data.safetyInputStatusFlags === null) {
        data.safetyInputStatusFlags = status.safetyInputStatusFlags;
      }
      if (status.temperatures && data.temperatures === null) {
        data.temperatures = status.temperatures;
      }
      if (status.vacuumBits && data.vacuumBits === null) {
        if (typeof status.vacuumBits === 'string') {
          data.vacuumBits = status.vacuumBits
            .split('')
            .map(bit => bit === '1');
        } else {
          data.vacuumBits = status.vacuumBits;
        }
      }

      if (status["Cathode A - Heater Current:"] != null) {
        data.heaterCurrent_A = status["Cathode A - Heater Current: "];
      }

      if (status["Cathode B - Heater Current:"] != null) {
        data.heaterCurrent_B = status["Cathode B - Heater Current: "];
      }

      if (status["Cathode C - Heater Current:"] != null) {
        data.heaterCurrent_C = status["Cathode C - Heater Current: "];
      }

      if (status["Cathode A - Heater Voltage:"] != null) {
        data.heaterVoltage_A = status["Cathode A - Heater Voltage: "];
      }

      if (status["Cathode B - Heater Voltage:"] != null) {
        data.heaterVoltage_B = status["Cathode B - Heater Voltage: "];
      }

      if (status["Cathode C - Heater Voltage:"] != null) {
        data.heaterVoltage_C = status["Cathode C - Heater Voltage: "];
      }

      if (status["clamp_temperature_A"] != null) {
        data.clamp_temperature_A = status["clamp_temperature_A"];
      }

      if (status["clamp_temperature_B"] != null) {
        data.clamp_temperature_B = status["clamp_temperature_B"];
      }

      if (status["clamp_temperature_C"] != null) {
        data.clamp_temperature_C = status["clamp_temperature_C"];
      }



      // If all fields are filled, stop early to save processing time
      if(Object.values(data).every(value => value != null)) {
        data.clamp_temperature_C = "full";
        console.log(" All data fields found within 1 hour. Exiting early.");
        return true;
      }

    }
    
    return true; // success
  } catch(e) {
    console.log("Error: ", e);
    throw new Error("extraction failed: pattern not found: ", e); // rethrow with message
  }
}

/**
 * Asynchronously writes an array of log lines to a local file in reverse order.
 * This function is designed to run in parallel with the extractData() process.
 * 
 * Key Features:
 * - Uses a writable stream to efficiently write each line to REVERSED_FILE_PATH.
 * - Handles backpressure using the 'drain' event when the internal buffer is full.
 * - Resolves the Promise once the entire file is written.
 * - Rejects if a write error occurs.
 * 
 * Assumptions:
 * - 'lines' is an array of strings that have already been reversed.
 * - The write operation is independent of data extraction, allowing concurrency.
 * 
 * Returns:
 * - Promise that resolves with true on successful write.
 * - Rejects with error on failure.
 */
function writeToFile(lines) {
  return new Promise((resolve, reject) => {
    // Create a writable stream to the reversed log file, overwrite mode ('w')
    const writeStream = fs.createWriteStream(REVERSED_FILE_PATH, { flags: 'w' });
    let i = 0;

    // Function to write lines to the stream in chunks
    function writeNext() {
      let ok = true;
      // Write lines until the buffer is full or all lines are written
      while (i < lines.length && ok) {
        ok = writeStream.write(lines[i] + '\n'); // append newline after each line
        i++;
      }
      // If buffer is full, wait for 'drain' event to resume
      if (i < lines.length) {
        writeStream.once('drain', writeNext);
      } else {
        writeStream.end(); // Close the stream once writing is done
      }
    }


    // When all data has been flushed and the stream ends
    writeStream.on('finish', async () => {
    // Optional rename logic was here, currently commented out
    //  try {
       // fs.renameSync(REVERSED_TEMP_FILE_PATH, REVERSED_FILE_PATH); // atomic replace
      console.log('Reversed log updated successfully.');

        // console.log("DEBUG (X): ", data);
  //    } catch (err) {
  //      console.error('Rename failed:', err);
  //       return false;
  //    }
      resolve(true); // Resolve the promise to signal success
    });

    // Handle any write errors
    writeStream.on('error', (err) => {
      console.error("Write error:", err);
      reject(err); // Reject the promise on failure
    });

    // Kick off the initial write cycle
    writeNext();
  });
}

async function fetchDisplayFileContents(){
  let release; // used if you implement lock control (e.g. mutex/fmutex)

  try {
    // Step 1: Get the most recent file from Drive
    //TEMP CHANGE: Uncomment
    const { dataFile, displayFile } = await getMostRecentFile();

    if (!displayFile){
      console.log("No display file found!")
    }

    // Step 4: File has changed → proceed to fetch contents
    console.log("Fetching new display log file...");
    let displayLines = null;
    try {
      displayLines = await fetchFileContents(displayFile.id);
      if (!Array.isArray(displayLines)) {
        console.warn("Display File fetch failed or returned no lines. Skipping extraction.");
        return false;
      }
      displayLines.reverse();
      displayLines = displayLines.slice(0, 100000);
    } catch (e) {
      console.error("Log file failed:", e);
    }
    
    // Step 5: Run extraction and file write in parallel
    const writePromise = writeToFile(displayLines);   // Save reversed lines to local file

    const [writeResult] = await Promise.allSettled([
      writePromise
    ]);

    // Step 7: Handle write result
    if (writeResult.status === 'fulfilled') {
      console.log("File write complete.");
      lastModifiedTime = dataFile.modifiedTime; // Update in-memory cache
      logFileName = dataFile.name;
    } else {
      console.error("File write failed:", writeResult.reason);
      // You could reset experimentRunning = false here if desired
    }

  } catch (err) {
    // Catch-all error handling for the fetch/extract/write process
    console.error(`Error processing file: ${err.message}`);
    return false;
  }
}

/**
 * Checks for a new log file in Google Drive, processes it, and updates the local reversed.txt file.
 * 
 * Steps:
 * 1. Fetch metadata of the most recent file in the Google Drive folder.
 * 2. If the file is stale (>15 min), mark experiment as inactive and skip.
 * 3. If the file is new, fetch its contents and reverse the log lines.
 * 4. Run data extraction and file writing in parallel using Promise.allSettled().
 * 5. On success, update in-memory state and mark experiment as running.
 * 
 * Returns:
 * - false: if no update was needed or fetch failed
 * - true: implicitly if successful (not used but possible)
 */
async function fetchAndUpdateFile() {
  sampleGraph.chartDataIntervalCount++;
  // Check if the required number of intervals have passed
  if (sampleGraph.chartDataIntervalCount == sampleGraph.chartDataIntervalDuration) {
    if (sampleGraph.fullXVals.length < sampleGraph.maxDataPoints) {
      addSampleChartDataPoint();
      sampleGraph.chartDataIntervalCount = 0;   // Reset the counter
    }
  }

  let release; // used if you implement lock control (e.g. mutex/fmutex)

  try {
    // Step 1: Get the most recent file from Drive
    const { dataFile, displayFile } = await getMostRecentFile();

    if (!dataFile){
      console.log("No data file found!")
    }

    let fileModifiedTime = null;
    if (dataFile && dataFile.modifiedTime) {
      fileModifiedTime = new Date(dataFile.modifiedTime).getTime();
    }

    const currentTime = Date.now(); // Get current time in ms

    console.log("XX", fileModifiedTime);
    console.log("YY", currentTime);

    // Step 2: Check experiment activity status
    // FIXME: Currently disabled for testing
    // if (currentTime - fileModifiedTime > INACTIVE_THRESHOLD) { // More than 15 minutes old?
    if (currentTime === currentTime) {
      experimentRunning = false;

      // Reset data to nulls — consistent fallback structure
      data = {
        pressure: null,
        pressureTimestamp: null,
        safetyOutputDataFlags: null,
        safetyInputDataFlags: null,
        safetyOutputStatusFlags: null,
        safetyInputStatusFlags: null,
        temperatures: null, 
        vacuumBits: null,
        heaterCurrent_A: null,
        heaterCurrent_B: null,
        heaterCurrent_C: null,
        heaterVoltage_A: null,
        heaterVoltage_B: null,
        heaterVoltage_C: null,
        clamp_temperature_A: null,
        clamp_temperature_B: null,
        clamp_temperature_C: null
      };
    } else {
      experimentRunning = true;
    }

    // FIXME: uncomment this block after testing
    // if (lastModifiedTime === dataFile.modifiedTime) {
    //   console.log("No new updates. Using cached data.");
    //   return false;
    // }

    console.log("Fetching new file...");
    let dataExtractionLines = null;
    try {
      dataExtractionLines = await fetchFileContents(dataFile.id);
      if (!Array.isArray(dataExtractionLines)) {
        console.warn("File fetch failed or returned no lines. Skipping extraction.");
        return false;
      }
      dataExtractionLines = dataExtractionLines.reverse();
      dataLines = dataExtractionLines.slice(0, 100); // TODO: just added this
    } catch (e) {
      console.error("WebMonitor file failed:", e);
    }
    
    // TODO: Need to add experimentRunning check
    // FIXME: changes dataExtractionLines to real lines rather than sample data lines for testing
    addLogs(); // Simulate adding logs for testing
    //const extractPromise = extractData(dataExtractionLines); // Parse data from logs
    const extractPromise = extractData(sampleDataLines); // Parse data from logs
    
    const [extractionResult] = await Promise.allSettled([
      extractPromise,
    ]);

    pressureGraph.fullXVals.push(data.pressureTimestamp);
    // FIXME: handle null/invalid pressure values appropriately
    pressureGraph.fullYVals.push(data.pressure ? parseInt(data.pressure) : -1);
    //extractLines.push(`${data.pressureTimestamp}, ${data.pressure}, from graph: ${pressureGraph.fullXVals[pressureGraph.fullXVals.length - 1]}, ${pressureGraph.fullYVals[pressureGraph.fullYVals.length - 1]}`);
    //extractLines.push(`{from graph: [${pressureGraph.fullXVals}], [${pressureGraph.fullYVals}]}`);
    updateDisplayData(pressureGraph);

    if (extractionResult.status === 'fulfilled') {
      data.webMonitorLastModified = dataFile.modifiedTime;
      // FIXME: TEMP CHANGE: Uncomment
      // data.displayLogLastModified = displayFile.modifiedTime;
      console.log("Extraction complete:", data);
    } else {
      console.error("Extraction failed:", extractionResult.reason);
    }

    if (dataFile && dataFile.modifiedTime) {
      lastModifiedTime = new Date(dataFile.modifiedTime).getTime();
    }

  } catch (err) {
    // Catch-all error handling for the fetch/extract/write process
    console.error(`Error processing file: ${err.message}`);
    experimentRunning = false; // not sure if this should be here but doesn't hurt much

    // Reset data to safe empty state
    data = {
      pressure: null,
      pressureTimestamp: null,
      safetyOutputDataFlags: null,
      safetyInputDataFlags: null,
      safetyOutputStatusFlags: null,
      safetyInputStatusFlags: null,
      temperatures: null, 
      vacuumBits: null,
      heaterCurrent_A: null,
      heaterCurrent_B: null,
      heaterCurrent_C: null,
      heaterVoltage_A: null,
      heaterVoltage_B: null,
      heaterVoltage_C: null,
      clamp_temperature_A: null,
      clamp_temperature_B: null,
      clamp_temperature_C: null,
      fileModifiedTime: null,
      webMonitorLastModified: null
    };

    console.log("Could not extract the log data");
    return false;
  } finally {
    // Always release lock/mutex if used
    if (release) {
      await release();
    }
  }
}


const codeLastUpdated = new Date().toLocaleString('en-US', {
  timeZone: 'America/Chicago'
});

/**
 * Startup routine
 * 
 * Immediately fetches and processes the latest available log file when the app starts,
 * and sets up a repeating fetch every 60 seconds to keep data updated.
 */


(async function start() {
  // 1) grab the latest logs right now
  await fetchAndUpdateFile();

  // 2) then keep polling every minute
  setInterval(fetchAndUpdateFile, 60_000);

  // 3) finally open the HTTP port
  app.listen(PORT, () => console.log(`Listening on ${PORT}`));
})();
 

app.get('/', async (req, res) => {
try {
  // console.log("Preview content (first 20 lines):\n", previewContent);
  const fileModified = (lastModifiedTime && !isNaN(lastModifiedTime))
    ? new Date(lastModifiedTime).toLocaleString("en-US", {timeZone: "America/Chicago"})
    : "N/A";
  // console.log("fileModifiedTime", fileModified);
  const currentTime = new Date().toLocaleString("en-US", {timeZone: "America/Chicago"});
  // Accessing each data field:
  // add logic for setting pressure to null if we have crossed the pressure threshold
  // let pressure = null;
  // let timeStampDebug = data.pressureTimestamp;
  let pressure = null;
  pressure = data.pressure;
 //  if (data && data.differenceTimestamp != null && data.differenceTimestamp <= 75) {
 //    // pressure = data.pressure;
 //    pressure = Number(data.pressure).toExponential(3);
 //  }

  const safeData = data || {
  pressure: null,
  pressureTimestamp: null,
  safetyOutputDataFlags: null,
  safetyInputDataFlags: null,
  safetyOutputStatusFlags: null,
  safetyInputStatusFlags: null,
  temperatures: null, 
  vacuumBits: null,
  heaterCurrent_A: null,
  heaterCurrent_B: null,
  heaterCurrent_C: null,
  heaterVoltage_A: null,
  heaterVoltage_B: null,
  heaterVoltage_C: null,
  clamp_temperature_A: null,
  clamp_temperature_B: null,
  clamp_temperature_C: null,
  fileModifiedTime: null,
  webMonitorLastModified: null
  };
  // todo: use this safedata in place of data var after this point for better "data" null pointer handling.




 if (data && data.pressure !== null && data.pressureTimestamp !== null) {


   // skips the first pressure reading - find a better way to handle this


   const nowSec = secondsSinceMidnightChicago();
   let diff = nowSec - data.pressureTimestamp;


   if (diff < 0) diff += 24 * 3600;


//    if (diff <= 120) {
//      pressure = Number(data.pressure).toExponential(3);
//    }
 }

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
  const temp = JSON.stringify(data);
  console.log('experimentRunning: ', experimentRunning);
  // console.log('YY', data);
  // console.log('ZZ', pressure);
  // console.log('AA', temperatures);


  let vacuumPowerColor = experimentRunning? getVacuumPower(data.safetyInputDataFlags, data.safetyInputStatusFlags) : "grey";
  let vacuumPressureColor = experimentRunning? getVacuumPressure(data.safetyInputDataFlags, data.safetyInputStatusFlags) : "grey";
  let waterColor = experimentRunning? getWaterStatus(data.safetyInputDataFlags, data.safetyInputStatusFlags) : "grey";
  let doorColor = experimentRunning? getDoorStatus(data.safetyInputDataFlags, data.safetyInputStatusFlags) : "grey";
  let oilHighColor = experimentRunning? getOilHigh(data.safetyInputDataFlags, data.safetyInputStatusFlags) : "grey";
  let oilLowColor = experimentRunning? getOilLow(data.safetyInputDataFlags, data.safetyInputStatusFlags) : "grey";
  let hvoltColor = experimentRunning? getHvoltOn(data.safetyInputDataFlags, data.safetyInputStatusFlags) : "grey";
  let estopIntColor = experimentRunning? getEStopInternal(data.safetyInputDataFlags, data.safetyInputStatusFlags) : "grey";
  let estopExtColor = experimentRunning? getEStopExternal(data.safetyInputDataFlags, data.safetyInputStatusFlags) : "grey";
  let allInterlocksColor = experimentRunning? getAllInterlocksStatus(data.safetyOutputDataFlags) : "grey";
  let G9OutputColor = experimentRunning? getG9Output(data.safetyOutputDataFlags) : "grey";

  let vacColors = (bits => [
    experimentRunning? varBitToColor(bits, 0) : "grey",
    experimentRunning? varBitToColor(bits, 1) : "grey",
    experimentRunning? varBitToColor(bits, 2) : "grey",
    experimentRunning? varBitToColor(bits, 3) : "grey",
    experimentRunning? varBitToColor(bits, 4) : "grey",
    experimentRunning? varBitToColor(bits, 5) : "grey",
    experimentRunning? varBitToColor(bits, 6) : "grey",
    experimentRunning? varBitToColor(bits, 7) : "grey"
    ])(data.vacuumBits);

  
  /**
   * GET /data
   * 
   * API endpoint that returns the latest extracted experimental values
   * in JSON format. This data is used by the frontend dashboard to display:
   * - Pressure and its timestamp
   * - Safety Output/Input Terminal Flags
   * - PMON temperature readings
   * - Vacuum interlock bits (VTRX states)
   * 
   * The values come from the shared `data` object in memory, which gets 
   * updated every minute by `fetchAndUpdateFile()`.
   */

  app.get('/data', (req, res) => {
    const inF  = data.safetyInputDataFlags || null;
    const outF = data.safetyOutputDataFlags || null;

    const inSF = data.safetyInputStatusFlags || null;

    const doorColor           = getDoorStatus(inF, inSF);
    const waterColor          = getWaterStatus(inF, inSF);
    const vacuumPowerColor    = getVacuumPower(inF, inSF);
    const vacuumPressureColor = getVacuumPressure(inF, inSF);
    const oilLowColor         = getOilLow(inF, inSF);
    const oilHighColor        = getOilHigh(inF, inSF);
    const estopIntColor       = getEStopInternal(inF, inSF);
    const estopExtColor       = getEStopExternal(inF, inSF);
    const allInterlocksColor  = getAllInterlocksStatus(outF);
    const G9OutputColor       = getG9Output(outF);
    const hvoltColor          = getHvoltOn(inF, inSF);

    // recompute all 8 vacuum‐bit colors:
    const vacColors = Array.from({ length: 8 }, (_, i) =>
      data.vacuumBits
        ? varBitToColor(data.vacuumBits, i)
        : 'grey'
    );

    res.json({
      pressure: data.pressure,                         
      pressureTimestamp: data.pressureTimestamp,   
      safetyInputStatusFlags: data.safetyInputStatusFlags,
      safetyOutputStatusFlags: data.safetyOutputStatusFlags,    
      safetyOutputDataFlags: data.safetyOutputDataFlags, 
      safetyInputDataFlags: data.safetyInputDataFlags,  
      temperatures: data.temperatures,                  
      vacuumBits: data.vacuumBits,                       
      vacuumColors: vacColors,
      sicColors: [doorColor,
        waterColor,
        vacuumPowerColor,
        vacuumPressureColor,
        oilLowColor,
        oilHighColor,
        estopIntColor,
        estopExtColor,
        allInterlocksColor,
        G9OutputColor,
        hvoltColor],
      heaterCurrent_A: data.heaterCurrent_A,
      heaterCurrent_B: data.heaterCurrent_B,
      heaterCurrent_C: data.heaterCurrent_C,
      heaterVoltage_A: data.heaterVoltage_A,
      heaterVoltage_B: data.heaterVoltage_B,
      heaterVoltage_C: data.heaterVoltage_C,
      clamp_temperature_A: data.clamp_temperature_A,
      clamp_temperature_B: data.clamp_temperature_B,
      clamp_temperature_C: data.clamp_temperature_C,
      siteLastUpdated: new Date().toISOString(),
      webMonitorLastModified: data.webMonitorLastModified || null,
      displayLogLastModified: data.displayLogLastModified || null
    });
  });

  app.get('/refresh-display', async (req, res) => {
    await fetchDisplayFileContents();
    res.status(200).send('Refreshed display logs');
  });

  //  keep your HTML generation as-is below this
  res.send(`
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
          /* background: linear-gradient(-45deg, #001f3f, #003366, #005a9e); */
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
          /* backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px); */
          border-radius: 8px;
          padding: 30px;
          /* box-shadow: 0px 4px 25px rgba(255, 255, 255, 0.15); */
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
        }
        .vacuum-indicators-item div:last-child {
          transition: font-weight 0.3s ease;
        }
        /* Use same circle styling */
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
        // gauge circle now displays the attributes of a textbox
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
          width: 100%; /* Make chart fill the container width */
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
        <!-- Environmental Section (Horizontal Radial Gauges) -->
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
      <div id="chart-root-3"></div>
                
      <script>
        /**
         * Creates a reusable uPlot chart section with zoom, resize, and debug info.
         * Works for multiple charts on the same page (uses classes, not IDs).
         * 
         * @param {HTMLElement|string} container - Parent element or selector.
         * @param {Object} config - Chart configuration and data.
         */
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

          // Create container HTML
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

          // Create the uPlot chart
          const uplot = new uPlot({
            width: wrapper.clientWidth,
            height: 300,
            series: [
              {},
              {
                label: seriesLabel,
                stroke: 'blue',
                points: { show: true, size: 5, fill: 'blue', stroke: 'blue' }
              }
            ],
            scales: { x: { time: true } },
            axes: [{ stroke: '#ccc' }, { stroke: '#ccc' }],
            cursor: {
              focus: { prox: 16 },
              drag: {
                x: true,
                y: false,
                setScale: true
              },
            },
          }, data, chartEl);

          // Resize dynamically
          window.addEventListener('resize', () => {
            const newWidth = wrapper.clientWidth;
            uplot.setSize({ width: newWidth, height: 300 });
          });

          // Fill parent
          const innerChart = chartEl.querySelector(':scope > *');
          if (innerChart) {
            innerChart.style.position = 'absolute';
            innerChart.style.top = '0';
            innerChart.style.left = '0';
            innerChart.style.width = '100%';
            innerChart.style.height = '100%';
          }

          // Reset zoom on double-click
          chartEl.ondblclick = () => {
            uplot.setScale('x', { min: null, max: null });
          };

          return uplot;
        }

        // ✅ Example usage: create multiple charts
        const now = Date.now();

        function makeSineData(freq = 10, len = 100) {
          const x = Array.from({ length: len }, (_, i) => now + i * 60000);
          const y = x.map((_, i) => Math.sin(i / freq));
          return [x, y];
        }

        const chartConfigs = [
          { containerId: 'chart-root-1', title: 'Live Update Chart 1', data: [${JSON.stringify(sampleGraph.displayXVals)}, ${JSON.stringify(sampleGraph.displayYVals)}], seriesLabel: "sin(t/10)",
            maxDataPoints: ${sampleGraph.maxDataPoints}, maxDisplayPoints: ${sampleGraph.maxDisplayPoints}, displayXVals: ${JSON.stringify(sampleGraph.displayXVals)}, lastUsedFactor: ${sampleGraph.lastUsedFactor}, chartDataIntervalDuration: ${sampleGraph.chartDataIntervalDuration} },
          { containerId: 'chart-root-2', title: 'Chart 2', data: makeSineData(20), seriesLabel: "sin(t/20)" },
          { containerId: 'chart-root-3', title: 'Live Update Chart 3', data: [${JSON.stringify(pressureGraph.fullXVals)}, ${JSON.stringify(pressureGraph.fullYVals)}], seriesLabel: "sin(t/20)",
            maxDataPoints: ${pressureGraph.maxDataPoints}, maxDisplayPoints: ${pressureGraph.maxDisplayPoints}, displayXVals: ${JSON.stringify(pressureGraph.displayXVals)}, lastUsedFactor: ${pressureGraph.lastUsedFactor}, chartDataIntervalDuration: ${pressureGraph.chartDataIntervalDuration} },
        ];

        chartConfigs.forEach(cfg => {
          const container = document.getElementById(cfg.containerId);
          createLiveUplotChart(container, cfg);
        });
      </script>


      <div class="env-section", style="overflow-y: auto;">
        <p>Code last updated: ${codeLastUpdated}</p>
        <!--
          <p>xVals: ${sampleGraph.fullXVals}</p>
          <p>yVals: ${sampleGraph.fullYVals}</p>
        -->
      </div>

      <!--
      <div class="env-section" style="max-height: 600px; overflow-y: auto;">
        <p>Raw Data Lines 7 debugLogs length: <span id="debug-length"></span></p>
        <p id="debug-preview"></p>
        <pre id="debugLogs"></pre>
        <pre id="data-lines-container"></pre>
      </div>

      <script>
        // Injecting local variables into the frontend JavaScript
        const debugLogs = ${JSON.stringify(debugLogs)};
        const dataLines = ${JSON.stringify(dataLines)};

        // Populate the DOM elements with the data
        document.getElementById('debug-length').textContent = debugLogs.length;
        document.getElementById('debug-preview').innerHTML = debugLogs.slice(-10).join('<br>');
        document.getElementById('debugLogs').textContent = debugLogs.join('\\n');
        document.getElementById('data-lines-container').textContent = dataLines.slice(0, 10).join('\\n');
      </script>
      -->

      <div class="env-section" style="max-height: 200px; overflow-y: auto;">
        <p>Data extracted</span></p>
        <pre>${JSON.stringify(data, null, 2)}</pre>
        <pre>${JSON.stringify(timestamps)}</pre>
        <pre>${JSON.stringify(extractLines)}</pre>
      </div>

      <!-- FIXME: Commented out sample data lines section for now -->
      <div class="env-section" style="max-height: 600px; overflow-y: auto;">
        <p>Sample Data Lines length: ${sampleDataLines.length}</p>
        <pre id="sample-data-lines"></pre>
      </div>

      <script>
        // Injecting local variables into the frontend JavaScript
        const sampleDataLines = ${sampleDataLines};
        // Populate the DOM elements with the data
        document.getElementById('sample-data-lines').textContent = sampleDataLines.join('<br>');
      </script>

      <div class="env-section" style="max-height: 600px; overflow-y: auto;">
        <div id="xOutput"></div>
        <div id="yOutput"></div>
      </div>

      <script>
        // Injecting local variables into the frontend JavaScript
        const pressureXVals = ${pressureGraph.fullXVals};
        const pressureYVals = ${pressureGraph.fullYVals};
        document.getElementById("xOutput").innerHTML = \`
          <p><strong>xVals:</strong> [ \${pressureXVals.join(", ")} ]</p>
        \`;

        document.getElementById("yOutput").innerHTML = \`
          <p><strong>yVals:</strong> [ \${pressureYVals.join(", ")} ]</p>
        \`;
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

        // Toggle between preview/full log
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
          sensor1.querySelector('.gauge-cover').textContent = (!data.temperatures["1"] || data.temperatures["1"] === "DISCONNECTED" || data.temperatures["1"] === "None" && !experimentRunning) ? '--' : data.temperatures["1"] + '°C';
          sensor2.querySelector('.gauge-cover').textContent = (!data.temperatures["2"] || data.temperatures["2"] === "DISCONNECTED" || data.temperatures["2"] === "None" && !experimentRunning) ? '--' : data.temperatures["2"] + '°C';
          sensor3.querySelector('.gauge-cover').textContent = (!data.temperatures["3"] || data.temperatures["3"] === "DISCONNECTED" || data.temperatures["3"] === "None" && !experimentRunning) ? '--' : data.temperatures["3"] + '°C';
          sensor4.querySelector('.gauge-cover').textContent = (!data.temperatures["4"] || data.temperatures["4"] === "DISCONNECTED" || data.temperatures["4"] === "None" && !experimentRunning) ? '--' : data.temperatures["4"] + '°C';
          sensor5.querySelector('.gauge-cover').textContent = (!data.temperatures["5"] || data.temperatures["5"] === "DISCONNECTED" || data.temperatures["5"] === "None" && !experimentRunning) ? '--' : data.temperatures["5"] + '°C';
          sensor6.querySelector('.gauge-cover').textContent = (!data.temperatures["6"] || data.temperatures["6"] === "DISCONNECTED" || data.temperatures["6"] === "None" && !experimentRunning) ? '--' : data.temperatures["6"] + '°C';

          

          console.log(sensor1.textContent);
          console.log(data.sicColors);
          }
          catch {
          console.error('Failed to load the dashboard!')
            }
          }, 60000)
     
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
    let content = await fs.promises.readFile(REVERSED_FILE_PATH, 'utf8');
    res.type('text/plain').send(content);
  } else {
    res.status(404).send("No file found.");
  }
} catch (err) {
  console.error(err);
  res.status(500).send(`Error: ${err.message}`);
}
});


// app.listen(PORT, () => {
// console.log(`Server running on port ${PORT}`);
// });