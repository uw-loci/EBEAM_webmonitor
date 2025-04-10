// Precompile regex patterns for better performance
const TIMESTAMP_REGEX = /^\[(\d{2}:\d{2}:\d{2})\]/;
const LOG_TYPE_REGEX = / - (DEBUG: .+?):/;
const PRESSURE_REGEX = /DEBUG: GUI updated with pressure: ([\d\.E\+]+)/;
const FLAGS_REGEX = /DEBUG: Safety Output Terminal Data Flags: (\[.*\])/;
const TEMPS_REGEX = /DEBUG: PMON temps: (\{.*\})/;

// Store current interval data
let currentData = {
  pressureReadings: [],
  safetyFlags: [],
  temperatures: {}
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
    logLines.forEach(logLine => {
        // Extract timestamp
        const timestampMatch = logLine.match(TIMESTAMP_REGEX);
        if (!timestampMatch) return;
        
        const timestamp = timestampMatch[1];
        const timestampInSeconds = timeToSeconds(timestamp);
        
        // Check if log is within 60 seconds of current interval time
        const difference = Math.abs(currentTimeInSeconds - timestampInSeconds);
        
        // Handle the case where the difference spans midnight, allowing for a 24-hour wraparound
        const adjustedDifference = difference > 43200 ? 86400 - difference : difference;
        
        // Only process if within 60 seconds
        if (adjustedDifference > 60) return;
        
        // Extract log type
        const logTypeMatch = logLine.match(LOG_TYPE_REGEX);
        if (!logTypeMatch) return;
        
        const logType = logTypeMatch[1];
        
        // Process based on log type
        switch(logType) {
            case "DEBUG: GUI updated with pressure":
                const pressureMatch = logLine.match(PRESSURE_REGEX);
                if (pressureMatch) {
                    const value = parseFloat(pressureMatch[1]);
                    currentData.pressureReadings.push({ time: timestamp, value });
                }
                break;
                
            case "DEBUG: Safety Output Terminal Data Flags":
                const flagsMatch = logLine.match(FLAGS_REGEX);
                if (flagsMatch) {
                    try {
                        const value = JSON.parse(flagsMatch[1]);
                        currentData.safetyFlags.push({ time: timestamp, flags: value });
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
                        
                        const value = JSON.parse(tempsStr);
                        
                        // Store temperatures by sensor ID
                        for (const [sensorId, temp] of Object.entries(value)) {
                            if (!currentData.temperatures[sensorId]) {
                                currentData.temperatures[sensorId] = [];
                            }
                            currentData.temperatures[sensorId].push({
                                time: timestamp,
                                value: parseFloat(temp)
                            });
                        }
                    } catch (error) {}
                }
                break;
        }
    });
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
    console.log("Pressure readings:", currentData.pressureReadings.length);
    console.log("Safety flags:", currentData.safetyFlags.length);
    
    // Count total temperature readings
    let totalTempReadings = 0;
    for (const sensorId in currentData.temperatures) {
        totalTempReadings += currentData.temperatures[sensorId].length;
    }
    console.log("Temperature readings:", totalTempReadings);
    
    // Reset data for next interval
    currentData = {
        pressureReadings: [],
        safetyFlags: [],
        temperatures: {}
    };
    
    // Set the new interval time (in seconds)
    currentTimeInSeconds = getCurrentTimeInSeconds();
    
    // Schedule next flush
    setTimeout(flushAndReset, 60 * 1000); // 60 seconds
    
    console.log(`New interval started at: ${formatTimeFromSeconds(currentTimeInSeconds)}`);
}

// Start processing
function startProcessing() {
    // Flush any existing data
    if (currentData.pressureReadings.length > 0 || 
        currentData.safetyFlags.length > 0 || 
        Object.keys(currentData.temperatures).length > 0) {
        console.log("Flushing existing data before starting new interval");
        console.log("Pressure readings:", currentData.pressureReadings.length);
        console.log("Safety flags:", currentData.safetyFlags.length);
        
        // Count total temperature readings
        let totalTempReadings = 0;
        for (const sensorId in currentData.temperatures) {
            totalTempReadings += currentData.temperatures[sensorId].length;
        }
        console.log("Temperature readings:", totalTempReadings);
        
        // Reset data
        currentData = {
            pressureReadings: [],
            safetyFlags: [],
            temperatures: {}
        };
    }
    
    // Set interval time once for the current interval (in seconds)
    currentTimeInSeconds = getCurrentTimeInSeconds();
    console.log(`Starting new interval at: ${formatTimeFromSeconds(currentTimeInSeconds)}`);
    
    // Schedule the next interval
    setTimeout(flushAndReset, 60 * 1000); // 60 seconds
}

// Function to simulate log lines being processed
function simulateLogProcessing() {
    // Example log lines
    const logLines = [
        "[09:48:30] - DEBUG: GUI updated with pressure: 1.20E+3 mbar",
        "[09:48:35] - DEBUG: Safety Output Terminal Data Flags: [0, 0, 0, 0, 0, 0, 1]",
        "[09:48:40] - DEBUG: PMON temps: {1: '18.94', 2: '19.00', 3: '22.83', 4: '20.38', 5: '21.88', 6: '19.31'}"
    ];
    
    // Process the current batch
    processLogLines(logLines);
    
    // Simulate more logs coming in later
    setTimeout(() => {
        const moreLogs = [
            "[09:48:50] - DEBUG: GUI updated with pressure: 1.21E+3 mbar",
            "[09:48:55] - DEBUG: PMON temps: {1: '18.99', 2: '19.05', 3: '22.88', 4: '20.43', 5: '21.93', 6: '19.36'}"
        ];
        processLogLines(moreLogs);
    }, 2000);
}

// Start the processing
startProcessing();

// Simulate log processing (in a real scenario, you'd process logs as they arrive)
simulateLogProcessing();