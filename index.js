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
const INACTIVE_THRESHOLD = 15 * 60 * 1000;

// variable Structure to store ALL the data extracted 
let data = {
pressure: null,
pressureTimestamp: null,
safetyOutputDataFlags: null,
safetyInputDataFlags: null,
temperatures: null, 
vacuumBits: null
};

// Assume All Interlocks Start Red
const interlockStates = {
 "Door": "red",
 "Water": "red",
 "Vacuum Power": "red",
 "Vacuum Pressure": "red",
 "Low Oil": "red",
 "High Oil": "red",
 "E-STOP Int": "red",
 "E-STOP Ext": "red",
 "All Interlocks": "red",
 "G9SP Active": "red",
 "HVolt ON": "red",
};

// Quick helper function to help with data to colour while integration
// 1 --> green, 0 --> red, Default --> grey.

// Interlocks
function getDoorStatus(inputFlags) {
 if (!inputFlags || inputFlags.length < 13) return "grey";
 return inputFlags[4] && inputFlags[5] ? "green" : "red";
}


function getVacuumPower(inputFlags) {
 if (!inputFlags || inputFlags.length < 13) return "grey";
 return inputFlags[6] ? "green" : "red";
}


function getVacuumPressure(inputFlags) {
  if (!inputFlags || inputFlags.length < 13) return "grey";
  return inputFlags[7] ? "green" : "red";
}


function getAllInterlocksStatus(outputFlags) {
 if (!outputFlags || outputFlags.length < 7) return "grey";
 if (outputFlags[6]) return "red";
 return outputFlags[5] ? "green" : "red";
}


function getWaterStatus(inputFlags) {
 if (!inputFlags || inputFlags.length < 13) return "grey";
 return inputFlags[10] ? "green" : "red";
}


function getG9Output(outputFlags) {
 if (!outputFlags || outputFlags.length < 7) return "grey";
 return outputFlags[4] ? "green" : "red";
}


function getEStopInternal(inputFlags) {
 if (!inputFlags || inputFlags.length < 13) return "grey";
 return inputFlags[0] && inputFlags[1] ? "green" : "red";
}


function getEStopExternal(inputFlags) {
 if (!inputFlags || inputFlags.length < 13) return "grey";
 return inputFlags[2] && inputFlags[3] ? "green" : "red";
}


function getOilLow(inputFlags) {
 if (!inputFlags || inputFlags.length < 13) return "grey";
 return inputFlags[9] ? "green" : "red";
}


function getOilHigh(inputFlags) {
 if (!inputFlags || inputFlags.length < 13) return "grey";
 return inputFlags[8] ? "green" : "red";
}


function getHvoltOn(inputFlags) {
 if (!inputFlags || inputFlags.length < 13) return "grey";
 return inputFlags[12] ? "green" : "red";
}

// Vacuume Indicators
function varBitToColour(bits, index) {
  if (!Array.isArray(bits) || bits.length < 8) return "grey";   // Default
  return bits[index] ? "green" : "red";                         // 1 --> green, 0 --> red
}

function secondsSinceMidnightChicago() {
 const now = new Date().toLocaleString("en-US", { timeZone: "America/Chicago" });
 const d = new Date(now);
 return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
}

/**
 * Fetch the single most-recent plain-text log file in the Drive folder.
 *
 * Steps:
 * 1) Drive API list call:
 *      - Folder constraint:  `'${FOLDER_ID}' in parents`
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


    let dataFile = files[1];
    console.log('dataFile', dataFile);

    let displayFile = null;

    if (!files || files.length === 0) {
      throw new Error('No files found in the folder.');
    }

    // can optimize this futher - temporary fix for now.
    let data_file_metadata = null;
    let display_file_metadata = null;

    for (const file of files){
      if (!data_file_metadata && file.name.startsWith('web')){
        dataFile = file;
      }
      else if (!display_file_metadata && file.name.startsWith('log')){
        displayFile = file;
      }
      if (dataFile && displayFile) break;
    }
    return {dataFile, displayFile}
  
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

      await new Promise((resolve, reject) => {
        response.on('data', chunk => {
          const chunkStr   = chunk.toString();
          const chunkLines = (currentLine + chunkStr).split('\n');
          currentLine = chunkLines.pop();   // last part may be incomplete
          lines.push(...chunkLines);
        });

        response.on('end', () => {
          if (currentLine) lines.push(currentLine); // push final partial
          resolve();
        });

        response.on('error', reject); // stream error
      });

      return lines; // success – return the collected lines

    } catch (err) {
      console.log(`Retry ${4 - retries}: ${err.message}`);
      retries--;

      if (retries === 0) {
        // Out of retries – bubble the error up
        throw err;
      }

      // Simple back-off (2 sec) before the next attempt
      await new Promise(res => setTimeout(res, 2000));
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
  try{
    data = {
      pressure: null,
      pressureTimestamp: null,
      safetyOutputDataFlags: null,
      safetyInputDataFlags: null,
      temperatures: null,
      vacuumBits: null
    };

    let jsonBlock = '';
    let bracesCount = 0;
    let jsonStart = false;

    // // Loop through each line in the log file
    for (const line of lines){
      if (!jsonStart && line.includes('{')){
        jsonStart = true;
        jsonBlock = '';
        bracesCount++;
      }
      if (jsonStart){
        jsonBlock += line;
        bracesCount += (line.match(/{/g) || []).length;
        bracesCount -= (line.match(/}/g) || []).length;
        if (bracesCount === 0){
          jsonStart = false;
        }
        if (line.includes('}')){
          jsonStart = false;
          try{
            const jsonData = JSON.parse(jsonBlock);

            // const nowSec = secondsSinceMidnightChicago();
            // let diff = nowSec - jsonData.timestamp;
            // if (diff < 0) diff += 24 * 3600;

            if (jsonData.status.pressure != null) {
              data.pressure          = jsonData.status.pressure;
              data.pressureTimestamp = jsonData.timestamp;
            }
            if (jsonData.status.safetyOutputDataFlags !== null){
              data.safetyOutputDataFlags = jsonData.status.safetyOutputDataFlags;
            }
            if (jsonData.status.safetyInputDataFlags !== null){
              data.safetyInputDataFlags = jsonData.status.safetyInputDataFlags;
            }
            if (jsonData.status.temperatures !== null){
              data.temperatures = jsonData.status.temperatures;
            }
            if (jsonData.status.vacuumBits !== null){
              data.vacuumBits = jsonData.status.vacuumBits;
              if (typeof jsonData.status.vacuumBits === 'string') {
               data.vacuumBits = jsonData.status.vacuumBits
                  .split('')
                  .map(bit => bit === '1');
              }
            }
          }
      
          
          catch(e){
            console.log("Error parsing JSON: ", e);
          }
          jsonBlock = '';
          bracesCount = 0;
        }
      }
    }
    
      // If all fields are filled, stop early to save processing time
      if (
        data.pressure !== null &&
        data.pressureTimestamp !== null &&
        data.safetyOutputDataFlags !== null &&
        data.safetyInputDataFlags !== null &&
        data.temperatures !== null &&
        data.vacuumBits !== null
      ) {
        console.log(" All data fields found within 1 hour. Exiting early.");
      }
    
    return true; // success
  }catch(e) {
    console.log("Error: ", e);
    throw new Error("extraction failed: pattern not found: ", e); // rethrow with message
  }}

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
  let release; // used if you implement lock control (e.g. mutex/fmutex)

  try {
    // Step 1: Get the most recent file from Drive
    const {dataFile, displayFile} = await getMostRecentFile();

    if (!dataFile){
      console.log("No data file found!")
    }

    if (!displayFile){
      console.log("No display file found!")
    }

    let fileModifiedTime = null;
    if (dataFile && dataFile.modifiedTime) {
      fileModifiedTime = new Date(dataFile.modifiedTime).getTime();
    }

    
    const currentTime = Date.now(); // Get current time in ms

    // Step 2: Check experiment activity status
    if (currentTime - fileModifiedTime > INACTIVE_THRESHOLD) { // More than 15 minutes old?
      experimentRunning = false;

      // Reset data to nulls — consistent fallback structure
      data = {
        pressure: null,
        pressureTimestamp: null,
        safetyOutputDataFlags: null,
        safetyInputDataFlags: null,
        temperatures: null, 
        vacuumBits: null
      };

      // If we don't even have a reversed file, just log and continue
      if (!fs.existsSync(REVERSED_FILE_PATH)) {
        console.log("Experiment not running but passing through");
      }
      // } else {
      //   console.log("Experiment not running - no updates in 15 minutes");
      //   return false;
      // }
    }

    // Step 3: No change detected — skip processing
    if (lastModifiedTime === dataFile.modifiedTime) {
      console.log("No new updates. Using cached data.");
      experimentRunning = true;
      return false;
    }

    // Step 4: File has changed → proceed to fetch contents
    console.log("Fetching new file...");
    // let displayLines = 
    let displayLines = null;
    try {
      displayLines = await fetchFileContents(displayFile.id);
      displayLines.reverse();
    } catch (e) {
      console.error("Log file failed:", e);
    }
    let dataExtractionLines = null;
    try {
      dataExtractionLines = await fetchFileContents(dataFile.id);
      dataExtractionLines.reverse();
    } catch (e) {
      console.error("WebMonitor file failed:", e);
    }
    
    // Step 5: Run extraction and file write in parallel
    const extractPromise = extractData(dataExtractionLines); // Parse data from logs
    const writePromise = writeToFile(displayLines);   // Save reversed lines to local file

    const [extractionResult, writeResult] = await Promise.allSettled([
      extractPromise,
      writePromise
    ]);

    // Step 6: Handle extraction result
    if (extractionResult.status === 'fulfilled') {
      console.log("Extraction complete:", data);
    } else {
      console.error("Extraction failed:", extractionResult.reason);
    }

    // Step 7: Handle write result
    if (writeResult.status === 'fulfilled') {
      console.log("File write complete.");
      lastModifiedTime = dataFile.modifiedTime; // Update in-memory cache
      logFileName = dataFile.name;
      experimentRunning = true;
    } else {
      console.error("File write failed:", writeResult.reason);
      // You could reset experimentRunning = false here if desired
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
      temperatures: null, 
      vacuumBits: null
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
  res.json({
    pressure: data.pressure,                         // Most recent pressure value
    pressureTimestamp: data.pressureTimestamp,       // Timestamp associated with pressure reading
    safetyOutputDataFlags: data.safetyOutputDataFlags, // Output flags as parsed from logger
    safetyInputDataFlags: data.safetyInputDataFlags,   // Input flags from logger
    temperatures: data.temperatures,                   // Object of PMON temperature readings
    vacuumBits: data.vacuumBits                        // 8-bit vacuum/interlock state array
  });
});


/**
 * Startup routine
 * 
 * Immediately fetches and processes the latest available log file when the app starts,
 * and sets up a repeating fetch every 60 seconds to keep data updated.
 */
fetchAndUpdateFile();               // Initial call to fetch and parse the latest file
setInterval(fetchAndUpdateFile, 60000); // Repeats every 60 sec = 1 minute



app.get('/', async (req, res) => {
try {
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
  // Accessing each data field:
  // add logic for setting pressure to null if we have crossed the pressure threshold
  // let pressure = null;
  // let timeStampDebug = data.pressureTimestamp;
  let pressure = null;
 //  if (data && data.differenceTimestamp != null && data.differenceTimestamp <= 75) {
 //    // pressure = data.pressure;
 //    pressure = Number(data.pressure).toExponential(3);
 //  }

  const safeData = data || {
  pressure: null,
  pressureTimestamp: null,
  safetyOutputDataFlags: null,
  safetyInputDataFlags: null,
  temperatures: null, 
  vacuumBits: null
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

  pressure = Number(data.pressure).toExponential(3);


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


  let vacuumPowerColor = getVacuumPower(data.safetyInputDataFlags);
  let vacuumPressureColor = getVacuumPressure(data.safetyInputDataFlags);
  let waterColor = getWaterStatus(data.safetyInputDataFlags);
  let doorColor = getDoorStatus(data.safetyInputDataFlags);
  let oilHighColor = getOilHigh(data.safetyInputDataFlags);
  let oilLowColor = getOilLow(data.safetyInputDataFlags);
  let hvoltColor = getHvoltOn(data.safetyInputDataFlags);
  let estopIntColor = getEStopInternal(data.safetyInputDataFlags);
  let estopExtColor = getEStopExternal(data.safetyInputDataFlags);
  let allInterlocksColor = getAllInterlocksStatus(data.safetyOutputDataFlags);
  let G9OutputColor = getG9Output(data.safetyOutputDataFlags);

  let vacColors = (bits => [
  varBitToColour(bits, 0),
  varBitToColour(bits, 1),
  varBitToColour(bits, 2),
  varBitToColour(bits, 3),
  varBitToColour(bits, 4),
  varBitToColour(bits, 5),
  varBitToColour(bits, 6),
  varBitToColour(bits, 7),
    ])(data.vacuumBits);




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
        // .gauge-cover {
        //   width: 100%;
        //   height: 100%;
        //   border-radius: 50%;
        //   background: rgba(0, 0, 0, 0.4);
        //   display: flex;
        //   align-items: center;
        //   justify-content: center;
        //   font-size: 1em;
        //   color: #fff;
        // }
        // .sensor-label { font-weight: bold; }
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
          transition: background-color 0.3s ease;
          float: right;
          margin-top: -3.5em;
          margin-bottom: 10px;
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
    </head>
    <body>
      <div class="container-fluid mt-4">
        <!-- If experiment isn't running, show a neon warning. In the alternate case, show a neon success -->
        ${!experimentRunning ? `<div class="neon-warning fixed-top-right">Dashboard is not running</div>` : `<div class="neon-success fixed-top-right">Dashboard is running</div>`}
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
              <div class="circle" style="background-color:${doorColor}"></div>
              <div>Door</div>
            </div>
            <div class="interlock-item">
              <div class="circle" style="background-color:${waterColor}"></div>
              <div>Water</div>
            </div>
            <div class="interlock-item">
              <div class="circle" style="background-color:${vacuumPowerColor}"></div>
              <div>Vacuum Power</div>
            </div>
            <div class="interlock-item">
              <div class="circle" style="background-color:${vacuumPressureColor}"></div>
              <div>Vacuum Pressure</div>
            </div>
            <div class="interlock-item">
              <div class="circle" style="background-color:${oilLowColor}"></div>
              <div>Low Oil</div>
            </div>
            <div class="interlock-item">
              <div class="circle" style="background-color:${oilHighColor}"></div>
              <div>High Oil</div>
            </div>
            <div class="interlock-item">
              <div class="circle" style="background-color:${estopIntColor}"></div>
              <div>E-STOP Int</div>
            </div>
            <div class="interlock-item">
              <div class="circle" style="background-color:${estopExtColor}"></div>
              <div>E-STOP Ext</div>
            </div>
            <div class="interlock-item">
              <div class="circle" style="background-color:${allInterlocksColor}"></div>
              <div>All Interlocks</div>
            </div>
            <div class="interlock-item">
              <div class="circle" style="background-color:${G9OutputColor}"></div>
              <div>G9 Output</div>
            </div>
            <div class="interlock-item">
              <div class="circle" style="background-color:${hvoltColor}"></div>
              <div>HVolt ON</div>
            </div>
          </div>
        </div>
        <!-- Vacuum Indicators Section -->
        <div class="vacuum-indicators">
          <h3 class="dashboard-subtitle vacuum-indicators-title">Vacuum Indicators; ${pressure !== null ? pressure + ' mbar' : '--'}</h3>
          <div class="vacuum-indicators-container">
            <div class="vacuum-indicators-item">
              <div class="vacuum-indicators-circle" style="background-color:${vacColors[0]}"></div>
              <div>Pumps Power ON</div>
            </div>
            <div class="vacuum-indicators-item">
              <div class="vacuum-indicators-circle" style="background-color:${vacColors[1]}"></div>
              <div>Turbo Rotor ON</div>
            </div>
            <div class="vacuum-indicators-item">
              <div class="vacuum-indicators-circle" style="background-color:${vacColors[2]}"></div>
              <div>Turbo Vent Open</div>
            </div>
            <div class="vacuum-indicators-item">
              <div class="vacuum-indicators-circle" style="background-color:${vacColors[3]}"></div>
              <div>972b Power On</div>
            </div>
            <div class="vacuum-indicators-item">
              <div class="vacuum-indicators-circle" style="background-color:${vacColors[4]}"></div>
              <div>Turbo Gate Closed</div>
            </div>
            <div class="vacuum-indicators-item">
              <div class="vacuum-indicators-circle" style="background-color:${vacColors[5]}"></div>
              <div>Turbo Gate Open</div>
            </div>
            <div class="vacuum-indicators-item">
              <div class="vacuum-indicators-circle" style="background-color:${vacColors[6]}"></div>
              <div>Argon Gate Open</div>
            </div>
            <div class="vacuum-indicators-item">
              <div class="vacuum-indicators-circle" style="background-color:${vacColors[7]}"></div>
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


         setInterval(() => {
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


app.listen(PORT, () => {
console.log(`Server running on port ${PORT}`);
});