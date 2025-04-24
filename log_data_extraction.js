const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();

const LOG_DATA_EXTRACTION_KEY = 'my-secret-key';

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
        // Extract timestamp
        const timestampMatch = logLine.match(TIMESTAMP_REGEX);
        if (!timestampMatch) continue;
        
        const timestamp = timestampMatch[1];
        const timestampInSeconds = timeToSeconds(timestamp);
        
        // Check if log is within 60 seconds of current interval time
        const difference = Math.abs(currentTimeInSeconds - timestampInSeconds);
        
        // Handle the case where the difference spans midnight, allowing for a 24-hour wraparound
        const adjustedDifference = difference > 43200 ? 86400 - difference : difference;
        
        // Only process if within 60 seconds
        if (adjustedDifference > 60) {
            console.log(`Stopping log processing: timestamp ${timestamp} is out of interval.`);
            break;
        }
        
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
    }
}

// Format seconds to HH:MM:SS for display
function formatTimeFromSeconds(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

// Flush current data and reset for next interval
function flushAndReset() {
    // Log the collected data from the interval
    console.log(`Interval completed at ${formatTimeFromSeconds(currentTimeInSeconds)}. Data collected:`);
    console.log("Pressure:", currentData.pressure);
    console.log("Safety Flags:", currentData.safetyFlags);
    console.log("Temperatures:", currentData.temperatures);
    
    // Reset data for next interval
    currentData = {
        pressure: null,
        safetyFlags: null,
        temperatures: null
    };
    
    // Set the new interval time (in seconds)
    currentTimeInSeconds = getCurrentTimeInSeconds();
    
    // Schedule next flush
    const logFilePath = path.join(__dirname, 'reversed.txt');
    fs.readFile(logFilePath, 'utf-8', (err, data) => {
        if (err) {
            console.error('Failed to read log file:', err);
        } else {
            const logLines = data.split('\n').filter(line => line.trim() !== '');
            console.log(logLines)
            processLogLines(logLines);
        }
        
        // Schedule the next interval
        setTimeout(flushAndReset, 60 * 1000); // 60 seconds
        console.log(`New interval started at: ${formatTimeFromSeconds(currentTimeInSeconds)}`);
    });
}

// Start processing
function startProcessing() {
    // Flush any existing data
    if (currentData.pressure !== null || 
        currentData.safetyFlags !== null || 
        currentData.temperatures !== null) {
        console.log("Flushing existing data before starting new interval");
        console.log("Pressure:", currentData.pressure);
        console.log("Safety Flags:", currentData.safetyFlags);
        console.log("Temperatures:", currentData.temperatures);
        
        // Reset data
        currentData = {
            pressure: null,
            safetyFlags: null,
            temperatures: null
        };
    }
    
    // Set interval time once for the current interval (in seconds)
    currentTimeInSeconds = getCurrentTimeInSeconds();
    console.log(`Starting new interval at: ${formatTimeFromSeconds(currentTimeInSeconds)}`);
    
    // Schedule the next interval
    flushAndReset();
}

// Function to simulate log lines being processed
function simulateLogProcessing() {
    // Example log lines
    const logLines = [
        "[10:03:30] - DEBUG: GUI updated with pressure: 1.20E+3 mbar",
        "[10:03:35] - DEBUG: Safety Output Terminal Data Flags: [0, 0, 0, 0, 0, 0, 1]",
        "[10:03:40] - DEBUG: PMON temps: {1: '18.94', 2: '19.00', 3: '22.83', 4: '20.38', 5: '21.88', 6: '19.31'}"
    ];
    
    // Process the current batch
    processLogLines(logLines);
    
    // Simulate more logs coming in later
    setTimeout(() => {
        const moreLogs = [
            "[10:04:10] - DEBUG: GUI updated with pressure: 1.21E+3 mbar",
            "[10:04:15] - DEBUG: PMON temps: {1: '18.99', 2: '19.05', 3: '22.88', 4: '20.43', 5: '21.93', 6: '19.36'}"
        ];
        processLogLines(moreLogs);
        
        // Display current data after processing the additional logs
        console.log("Current data after processing additional logs:");
        console.log("Pressure:", currentData.pressure);
        console.log("Safety Flags:", currentData.safetyFlags);
        console.log("Temperatures:", currentData.temperatures);
    }, 2000);
}

// Start the processing
//startProcessing();

// Simulate log processing (in a real scenario, you'd process logs as they arrive)
//simulateLogProcessing();

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
    
    const logFilePath = path.join(__dirname, 'test_logs', 'reversed.txt');
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