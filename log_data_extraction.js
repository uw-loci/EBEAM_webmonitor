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
  safetyFlags: [],
  temperatures: null
};

// Current interval time in seconds since start of day
let currentTimeInSeconds = 0;

// Function to convert HH:MM:SS to total seconds
function timeToSeconds(time) {
    const hours = (time[0] - '0') * 10 + (time[1] - '0');   // First two characters for hours
    const minutes = (time[3] - '0') * 10 + (time[4] - '0'); // Characters at index 3 and 4 for minutes
    const seconds = (time[6] - '0') * 10 + (time[7] - '0'); // Characters at index 6 and 7 for seconds
    return hours * 3600 + minutes * 60 + seconds;
}

// Get current time in seconds since start of day
function getCurrentTimeInSeconds() {
    const now = new Date();
    return now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
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
        
        // Check if log is within 60 seconds of current interval time
        let difference = currentTimeInSeconds - timestampInSeconds;

        // // Handle midnight wraparound (only need to check for "yesterday")
        // if (difference < -43200) { // Log is from "yesterday" relative to currentTime
        //     difference += 86400;
        // }

        // const adjustedDifference = Math.abs(difference);

        // console.log(adjustedDifference)

        // // Only process if within 60 seconds
        // if (adjustedDifference > 60) {
        //     console.log(`Stopping log processing: timestamp ${timestamp} is out of interval.`);
        //     break;
        // }

        // Handle midnight wraparound
        if (currentTimeInSeconds < 60 && timestampInSeconds > 86400 - 60) {
            difference += 86400;
        }




        // currentData.pressure = currentTimeInSeconds;
        // currentData.safetyFlags = timestampInSeconds;
        // currentData.temperatures = difference;
        




        // Only process if the difference is between 0 and 60 seconds (inclusive)
        // if (difference < 0 || difference > 60) {
        //     console.log(`Stopping log processing: timestamp ${timestamp} is out of interval.`);
        //     currentData.safetyFlags.push(`Stopping log processing: timestamp ${timestamp} is out of interval.`);
        //     return; // Use 'return' to exit the loop iteration
        // }
        
        // Extract log type
        const logTypeMatch = logLine.match(LOG_TYPE_REGEX);
        if (!logTypeMatch) {
            // currentData.safetyFlags.push(`no log type match`);
            continue;
        }
        
        const logType = logTypeMatch[1];

        //currentData.safetyFlags.push(`log type: ${logType}`)
        
        // Process based on log type
        switch(logType) {
            case "DEBUG: GUI updated with pressure":
                if (currentData.pressure === null) {
                    const pressureMatch = logLine.match(PRESSURE_REGEX);
                    if (pressureMatch && pressureMatch[1]) {
                        currentData.pressure = parseFloat(pressureMatch[1]);
                        // if currentData object has been filled with valid values stop processing log lines
                        if (Object.values(currentData).every(value => value !== null)) {
                            console.log(`data object has been filled`)
                            return;
                        }
                    }
                }
                break;
                
            // case "DEBUG: Safety Output Terminal Data Flags":
            //     if (currentData.safetyFlags === null) {
            //         const flagsMatch = logLine.match(FLAGS_REGEX);
            //         if (flagsMatch && flagsMatch[1]) {
            //             try {
            //                 currentData.safetyFlags = JSON.parse(flagsMatch[1]);
            //                 // if currentData object has been filled with valid values stop processing log lines
            //                 if (Object.values(currentData).every(value => value !== null)) {
            //                     console.log(`data object has been filled`)
            //                     return;
            //                 }
            //             } catch (error) {}
            //         }
            //     }
            //     break;
                
            case "DEBUG: PMON temps":
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
router.use('/data', (req, res, next) => {
    // If the API key doesn't match the expected key, deny access
    if (req.headers['x-api-key'] !== LOG_DATA_EXTRACTION_KEY) {
      return res.status(403).json({ error: 'Forbidden: Invalid API Key' });
    }
    
    // If the key matches, proceed to the actual API route handler
    next();
});

// Define the /api/data endpoint that returns the JSON object
router.get('/data', (req, res) => {
    // const data = {
    //   message: 'Hello from the API!',
    //   success: true,
    //   timestamp: new Date().toISOString()
    // };
  
    // // Send the JSON object as the response
    // res.json(data);

    // Reset data for next interval
    
    
    // Set the new interval time (in seconds)
    currentTimeInSeconds = getCurrentTimeInSeconds();
    
    // 'reversed.txt'
    // 'test_logs', 'sample_logs.txt'
    const logFilePath = path.join(__dirname, 'reversed.txt'); // change this for sample log reading
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
            safetyFlags: [],
            temperatures: null
        };
    });
});

module.exports = router;