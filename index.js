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
const axios = require('axios');
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

let xVals = [];
let yVals = [];

// Add a new sinusoidal data point using current time as x
function addDataPoint() {
  if (xVals.length < 50) {
    // const nowMs = Date.now();
    // const tSec = Math.floor(nowMs / 1000);
    // const y = Math.sin(tSec / 10); // simple sinusoid

    xVals.push(Math.floor(Date.now() / 1000));
    yVals.push(Math.sin(tSec / 10));
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
      clamp_temperature_C: null
    };

    let jsonBlock = '';
    let bracesCount = 0;
    let jsonStart = false;

    // Loop through each line in the log file
    for (let i = 0; i < lines.length; i++){
      const line = lines[i]
      
      
      if (!jsonStart && line.includes('{')){
        jsonStart = true;
        jsonBlock = '';
      }

      // FIXME: Need to eventually make this brace counting logic for json extraction more robust for defensive programming
      // to handle malformed data that is syntactically valid json but logically invalid
      if (jsonStart){
        jsonBlock += line + '\n'; // preserve line breaks

        bracesCount += (line.match(/{/g) || []).length;
        bracesCount -= (line.match(/}/g) || []).length;

        if (bracesCount === 0){
          try{
            const jsonData = JSON.parse(jsonBlock);

            // const nowSec = secondsSinceMidnightChicago();
            // let diff = nowSec - jsonData.timestamp;
            // if (diff < 0) diff += 24 * 3600;

            // can't do just jsonData.status?.pressure as pressure could be 0.0
            if (jsonData.status?.pressure != null && data.pressure === null) {
              data.pressure          = jsonData.status.pressure;
              data.pressureTimestamp = jsonData.timestamp;
            }
            if (jsonData.status?.safetyOutputDataFlags && data.safetyOutputDataFlags === null) {
              data.safetyOutputDataFlags = jsonData.status.safetyOutputDataFlags;
            }
            if (jsonData.status?.safetyInputDataFlags && data.safetyInputDataFlags === null) {
              data.safetyInputDataFlags = jsonData.status.safetyInputDataFlags;
            }
            if (jsonData.status?.safetyOutputStatusFlags && data.safetyOutputStatusFlags === null) {
              data.safetyOutputStatusFlags = jsonData.status.safetyOutputStatusFlags;
            }
            if (jsonData.status?.safetyInputStatusFlags && data.safetyInputStatusFlags === null) {
              data.safetyInputStatusFlags = jsonData.status.safetyInputStatusFlags;
            }
            if (jsonData.status?.temperatures && data.temperatures === null) {
              data.temperatures = jsonData.status.temperatures;
            }
            if (jsonData.status?.vacuumBits && data.vacuumBits === null) {
              if (typeof jsonData.status.vacuumBits === 'string') {
                data.vacuumBits = jsonData.status.vacuumBits
                  .split('')
                  .map(bit => bit === '1');
              } else {
                data.vacuumBits = jsonData.status.vacuumBits;
              }
            }

            if (jsonData.status["Cathode A - Heater Current:"] !== null) {
              data.heaterCurrent_A = jsonData.status["Cathode A - Heater Current: "];
            }

            if (jsonData.status["Cathode B - Heater Current:"] !== null) {
              data.heaterCurrent_B = jsonData.status["Cathode B - Heater Current: "];
            }

            if (jsonData.status["Cathode C - Heater Current:"] !== null) {
              data.heaterCurrent_C = jsonData.status["Cathode C - Heater Current: "];
            }

            if (jsonData.status["Cathode A - Heater Voltage:"] !== null) {
              data.heaterVoltage_A = jsonData.status["Cathode A - Heater Voltage: "];
            }

            if (jsonData.status["Cathode B - Heater Voltage:"] !== null) {
              data.heaterVoltage_B = jsonData.status["Cathode B - Heater Voltage: "];
            }

            if (jsonData.status["Cathode C - Heater Voltage:"] !== null) {
              data.heaterVoltage_C = jsonData.status["Cathode C - Heater Voltage: "];
            }

            if (jsonData.status["clamp_temperature_A"] !== null) {
              data.clamp_temperature_A = jsonData.status["clamp_temperature_A"];
            }

            if (jsonData.status["clamp_temperature_B"] !== null) {
              data.clamp_temperature_B = jsonData.status["clamp_temperature_B"];
            }

            if (jsonData.status["clamp_temperature_C"] !== null) {
              data.clamp_temperature_C = jsonData.status["clamp_temperature_C"];
            }



            // If all fields are filled, stop early to save processing time
            if(Object.values(data).every(value => value != null)) {
              console.log(" All data fields found within 1 hour. Exiting early.");
              return true;
            }

          }

          // FIXME: should we throw an error here as well?
          catch(e){
            console.log("Error parsing JSON: ", e);
          }

          jsonBlock = '';
          bracesCount = 0;
          jsonStart = false;
        }
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
  addDataPoint()
  // if (xVals.length < 20) {
  //   const startTime = Date.now() / 1000;

  //   // FIXME: Uncomment this
  //   for (let i = 0; i < 5; i++) {
  //     xVals.push(startTime + (i + 5) * 60); // 1-minute intervals
  //     yVals.push(Math.sin((xVals.length + i + 5) / 50) + Math.random() * 0.5); // some variation
  //   }
  // }

  // xVals.push(Date.now() / 1000);
  // yVals.push(Math.sin(xVals.length / 50) + Math.random() * 0.3);


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
    if (currentTime - fileModifiedTime > INACTIVE_THRESHOLD) { // More than 15 minutes old?
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

    if (lastModifiedTime === dataFile.modifiedTime) {
      console.log("No new updates. Using cached data.");
      return false;
    }

    console.log("Fetching new file...");
    let dataExtractionLines = null;
    try {
      dataExtractionLines = await fetchFileContents(dataFile.id);
      if (!Array.isArray(dataExtractionLines)) {
        console.warn("File fetch failed or returned no lines. Skipping extraction.");
        return false;
      }
      dataExtractionLines = dataExtractionLines.reverse();
    } catch (e) {
      console.error("WebMonitor file failed:", e);
    }
    
    // TODO: Need to add experimentRunning check
    const extractPromise = extractData(dataExtractionLines); // Parse data from logs
    const [extractionResult] = await Promise.allSettled([
      extractPromise,
    ]);

    if (extractionResult.status === 'fulfilled') {
      data.webMonitorLastModified = dataFile.modifiedTime;
      //TEMP CHANGE: Uncomment
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
      </style>
      <script src="https://unpkg.com/uplot/dist/uPlot.iife.min.js"></script>
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
      <div class="env-section">
        <p>This is a paragraph of text. ${xVals}, ${yVals}</p>
      </div>
        <div style="
          background: rgba(255, 255, 255, 0.08);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border-radius: 15px;
          padding: 0px 5px;
          margin: 50px auto;
          width: 90%;
          max-width: 800px;
        ">
        <div class="wrap">
          <h2>Sinusoidal Time Series</h2>
          <div id="chart"></div>
          <div class="meta">Auto-refreshes every ~11s. Max 50 points. New point added every 10s on server.</div>
        </div>
        <script>
          // Data embedded by server
          const x = ${JSON.stringify(xVals)}; // Unix seconds
          const y = ${JSON.stringify(yVals)};

          const data = [x, y];

          const opts = {
            width: Math.min(900, window.innerWidth - 48),
            height: 400,
            series: [
              {},
              { label: 'sin(t/10)', stroke: 'blue', points: { show: true, size: 5, fill: 'blue', stroke: 'blue' } }
            ],
            scales: {
              x: { time: true },
            },
            axes: [
              { stroke: '#333' },
              { stroke: '#333' },
            ],
            cursor: { focus: { prox: 16 } },
          };

          const el = document.getElementById('chart');
          const u = new uPlot(opts, data, el);
        </script>
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