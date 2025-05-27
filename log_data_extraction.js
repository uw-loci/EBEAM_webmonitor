const express = require('express');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const router = express.Router();

const LOG_DATA_EXTRACTION_KEY = process.env.LOG_DATA_EXTRACTION_KEY;
// const LOG_DATA_EXTRACTION_KEY = 'my-secret-key';

// Precompile regex patterns for better performance
const TIMESTAMP_REGEX = /^\[(\d{2}:\d{2}:\d{2})\]/;
const LOG_TYPE_REGEX = / - (DEBUG: .+?):/;
const PRESSURE_REGEX = /DEBUG: GUI updated with pressure: ([\d\.E\+]+)/;
const FLAGS_REGEX = /DEBUG: Safety Output Terminal Data Flags: (\[.*\])/;
const TEMPS_REGEX = /DEBUG: PMON temps: (\{.*\})/;

// Store current interval data
let currentData = {
  pressure: null,
  pressureTimestamp: null,
  safetyFlags: null,
  temperatures: null
};

function getCurrentTimeInSeconds(){
    const now = new Date();
    const chicagoTime = new Date(now.toLocaleString("en-US", { timeZone: "America/Chicago" }));
    return chicagoTime.getHours() * 3600 + chicagoTime.getMinutes() * 60 + chicagoTime.getSeconds();
  }

// Function to convert HH:MM:SS to total seconds
function timeToSeconds(time) {
    const hours = (time[0] - '0') * 10 + (time[1] - '0');   // First two characters for hours
    const minutes = (time[3] - '0') * 10 + (time[4] - '0'); // Characters at index 3 and 4 for minutes
    const seconds = (time[6] - '0') * 10 + (time[7] - '0'); // Characters at index 6 and 7 for seconds
    return hours * 3600 + minutes * 60 + seconds;
}

// Process log lines for current interval
function processLogLines(logLines) {

    // Process each log line
    for (const logLine of logLines) {
        // Extract timestamp
        const timestampMatch = logLine.match(TIMESTAMP_REGEX);
        if (!timestampMatch) continue;

        const timestamp = timestampMatch[1];
        const timestampInSeconds = timeToSeconds(timestamp);

        const currentTimeInSeconds = getCurrentTimeInSeconds(); // Get current time ONCE

        // Calculate the difference in seconds
        let difference = currentTimeInSeconds - timestampInSeconds;

        // Handle the case where the log timestamp is from the previous day
        if (difference < 0) {
            difference += 86400; // Add 24 hours in seconds
        }

        // Only process if the log is within the last 60 seconds; I switched it to 300 for temperatures to show up on the dashboard.

        /*
        IMP: commenting it out for now 
        */

        if (difference > 300) {
            console.log(`Stopping log processing: timestamp ${timestamp}, difference: ${difference}`);
            break; // Exit the loop since logs are in descending order
        }
        
        // Extract log type
        const logTypeMatch = logLine.match(LOG_TYPE_REGEX);
        if (!logTypeMatch) continue;
        const logType = logTypeMatch[1];        // trim might be necessary but not important for now
        
        // Process based on log type
        switch(logType) {
            case "DEBUG: GUI updated with pressure":
                if (currentData.pressure === null) {
                    const pressureMatch = logLine.match(PRESSURE_REGEX);
                    if (pressureMatch && pressureMatch[1]) {
                        const parsedPressure_val = parseFloat(pressureMatch[1]);
                        if (difference <= 120){
                            currentData.pressure = parsedPressure_val;
                            currentData.pressureTimestamp = timestampInSeconds;
                            console.log("Timestamp being assigned to pressureTimestamp:", timestamp);
                            // if currentData object has been filled with valid values stop processing log lines
                        }
                        else {
                            console.log(`Skipping pressure value due to stale timestamp (${difference} seconds ago)`);
                            currentData.pressure = null;
                            currentData.pressureTimestamp = null;
                        }
                        if (Object.values(currentData).every(value => value !== null)) {
                            console.log(`data object has been filled`)
                            return;
                        }
                        }
                    }
                break;
                
            case "DEBUG: Safety Output Terminal Data Flags":
                if (currentData.safetyFlags === null) {
                    const flagsMatch = logLine.match(FLAGS_REGEX);
                    if (flagsMatch && flagsMatch[1]) {
                        try {
                            currentData.safetyFlags = JSON.parse(flagsMatch[1]);
                            // if currentData object has been filled with valid values stop processing log lines
                            if (Object.values(currentData).every(value => value !== null)) {
                                console.log(`data object has been filled`)
                                return;
                            }
                        } catch (error) {}
                    }
                    break;
                }
                
            case "DEBUG: PMON temps":
                console.log("Found PMON log line:", logLine);
                if (currentData.temperatures === null) {
                    const tempsMatch = logLine.match(TEMPS_REGEX);
                    if (tempsMatch && tempsMatch[1]) {
                        try {
                            let tempsStr = tempsMatch[1]
                                .replace(/'/g, '"')
                                .replace(/(\d+):/g, '"$1":');
                            
                            currentData.temperatures = JSON.parse(tempsStr);
                            // if currentData object has been filled with valid values stop processing log lines
                            if (Object.values(currentData).every(value => value !== null)) {
                                console.log(`data object has been filled`)
                                return;
                            }
                        } catch (error) {}
                    }
                }
                break;

            default:
                break;
        }
    }
}

// Middleware to check the secret key in the request headers
// router.use('/data', (req, res, next) => {
//     // If the API key doesn't match the expected key, deny access
//     if (req.headers['x-api-key'] !== LOG_DATA_EXTRACTION_KEY) {
//       return res.status(403).json({ error: 'Forbidden: Invalid API Key' });
//     }
    
//     // If the key matches, proceed to the actual API route handler
//     next();
// });

// Define the /api/data endpoint that returns the JSON object
router.get('/data', (req, res) => {
    // 'reversed.txt'
    // 'test_logs', 'sample_logs.txt'
    const logFilePath = path.join(__dirname, 'reversed.txt'); // change this for sample log reading
    // const logFilePath = './test_logs/sample_logs.txt'
    fs.readFile(logFilePath, 'utf-8', (err, data) => {
        if (err) {
            console.error('Failed to read log file:', err);
            return res.status(500).json({ error: 'Failed to read log file' });
        }

        const logLines = data.split('\n').filter(line => line.trim() !== '');
        
        console.log(logLines)
        processLogLines(logLines);

        // Send back the processed interval data
        console.log(currentData)
        res.json(currentData);

        currentData = {
            pressure: null,
            pressureTimestamp: null,
            safetyFlags: null,
            temperatures: null
        };
    });
});

module.exports = router;