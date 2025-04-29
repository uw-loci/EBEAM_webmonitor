const express = require('express');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const router = express.Router();

const LOG_DATA_EXTRACTION_KEY = process.env.LOG_DATA_EXTRACTION_KEY;

// Precompile regex patterns for better performance
const TIMESTAMP_REGEX = /^\[(\d{2}:\d{2}:\d{2})\]/;
const LOG_TYPE_REGEX = / - (DEBUG: .+?):/;
const PRESSURE_REGEX = /DEBUG: GUI updated with pressure: ([\d\.E\+]+)/;
const FLAGS_REGEX = /DEBUG: Safety Output Terminal Data Flags: (\[.*\])/;
const TEMPS_REGEX = /DEBUG: PMON temps: (\{.*\})/;

// Store current interval data
let currentData = {
  pressure: null,
  safetyFlags: null,
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
        // // Extract timestamp
        // const timestampMatch = logLine.match(TIMESTAMP_REGEX);
        // if (!timestampMatch) continue;
        
        // const timestamp = timestampMatch[1];
        // const timestampInSeconds = timeToSeconds(timestamp);
        
        // // Check if log is within 60 seconds of current interval time
        // const difference = Math.abs(currentTimeInSeconds - timestampInSeconds);
        
        // // Handle the case where the difference spans midnight, allowing for a 24-hour wraparound
        // const adjustedDifference = difference > 43200 ? 86400 - difference : difference;
        
        // // Only process if within 60 seconds
        // if (adjustedDifference > 60) {
        //     console.log(`Stopping log processing: timestamp ${timestamp} is out of interval.`);
        //     break;
        // }
        
        // Extract log type
        const logTypeMatch = logLine.match(LOG_TYPE_REGEX);
        if (!logTypeMatch) return;
        
        const logType = logTypeMatch[1];
        
        // Process based on log type
        switch(logType) {
            case "DEBUG: GUI updated with pressure":
                const pressureMatch = logLine.match(PRESSURE_REGEX);
                if (pressureMatch) {
                    currentData.pressure = parseFloat(pressureMatch[1]);
                }
                break;
                
            case "DEBUG: Safety Output Terminal Data Flags":
                const flagsMatch = logLine.match(FLAGS_REGEX);
                if (flagsMatch) {
                    try {
                        currentData.safetyFlags = JSON.parse(flagsMatch[1]);
                    } catch (error) {}
                }
                break;
                
            case "DEBUG: PMON temps":
                const tempsMatch = logLine.match(TEMPS_REGEX);
                if (tempsMatch) {
                    try {
                        let tempsStr = tempsMatch[1]
                            .replace(/'/g, '"')
                            .replace(/(\d+):/g, '"$1":');
                        
                        currentData.temperatures = JSON.parse(tempsStr);
                    } catch (error) {}
                }
                break;
        }

        // if currentData object has been filled with valid values stop processing log lines
        if (Object.values(currentData).every(value => value !== null)) {
            console.log(`data object has been filled`)
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
        res.json(currentData);

        currentData = {
            pressure: null,
            safetyFlags: null,
            temperatures: null
        };
    });
});

module.exports = router;