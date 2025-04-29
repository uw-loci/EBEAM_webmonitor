const axios = require('axios');
require('dotenv').config();

// const LOG_DATA_EXTRACTION_KEY = process.env.LOG_DATA_EXTRACTION_KEY;
const LOG_DATA_EXTRACTION_KEY = 'my-secret-key';

async function testLogDataExtraction() {
  try {
    const response = await axios.get("https://ebeam-webmonitor.onrender.com/log-data-extraction/data", {
      headers: {
        'x-api-key': LOG_DATA_EXTRACTION_KEY
      }
    });

    console.log('API Response:', response.data);
  } catch (error) {
    console.error('Error calling the API:', error.message);
    if (error.response) {
      console.error('Error Response Data:', error.response.data);
    }
  }
}

testLogDataExtraction();



// // Format seconds to HH:MM:SS for display
// function formatTimeFromSeconds(seconds) {
//     const hours = Math.floor(seconds / 3600);
//     const minutes = Math.floor((seconds % 3600) / 60);
//     const secs = seconds % 60;
//     return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
// }

// // Flush current data and reset for next interval
// function flushAndReset() {
//     // Log the collected data from the interval
//     console.log(`Interval completed at ${formatTimeFromSeconds(currentTimeInSeconds)}. Data collected:`);
//     console.log("Pressure:", currentData.pressure);
//     console.log("Safety Flags:", currentData.safetyFlags);
//     console.log("Temperatures:", currentData.temperatures);
    
//     // Reset data for next interval
//     currentData = {
//         pressure: null,
//         safetyFlags: null,
//         temperatures: null
//     };
    
//     // Set the new interval time (in seconds)
//     currentTimeInSeconds = getCurrentTimeInSeconds();
    
//     // Schedule next flush
//     const logFilePath = path.join(__dirname, 'reversed.txt');
//     fs.readFile(logFilePath, 'utf-8', (err, data) => {
//         if (err) {
//             console.error('Failed to read log file:', err);
//         } else {
//             const logLines = data.split('\n').filter(line => line.trim() !== '');
//             console.log(logLines)
//             processLogLines(logLines);
//         }
        
//         // Schedule the next interval
//         setTimeout(flushAndReset, 60 * 1000); // 60 seconds
//         console.log(`New interval started at: ${formatTimeFromSeconds(currentTimeInSeconds)}`);
//     });
// }

// // Start processing
// function startProcessing() {
//     // Flush any existing data
//     if (currentData.pressure !== null || 
//         currentData.safetyFlags !== null || 
//         currentData.temperatures !== null) {
//         console.log("Flushing existing data before starting new interval");
//         console.log("Pressure:", currentData.pressure);
//         console.log("Safety Flags:", currentData.safetyFlags);
//         console.log("Temperatures:", currentData.temperatures);
        
//         // Reset data
//         currentData = {
//             pressure: null,
//             safetyFlags: null,
//             temperatures: null
//         };
//     }
    
//     // Set interval time once for the current interval (in seconds)
//     currentTimeInSeconds = getCurrentTimeInSeconds();
//     console.log(`Starting new interval at: ${formatTimeFromSeconds(currentTimeInSeconds)}`);
    
//     // Schedule the next interval
//     flushAndReset();
// }

// // Function to simulate log lines being processed
// function simulateLogProcessing() {
//     // Example log lines
//     const logLines = [
//         "[10:03:30] - DEBUG: GUI updated with pressure: 1.20E+3 mbar",
//         "[10:03:35] - DEBUG: Safety Output Terminal Data Flags: [0, 0, 0, 0, 0, 0, 1]",
//         "[10:03:40] - DEBUG: PMON temps: {1: '18.94', 2: '19.00', 3: '22.83', 4: '20.38', 5: '21.88', 6: '19.31'}"
//     ];
    
//     // Process the current batch
//     processLogLines(logLines);
    
//     // Simulate more logs coming in later
//     setTimeout(() => {
//         const moreLogs = [
//             "[10:04:10] - DEBUG: GUI updated with pressure: 1.21E+3 mbar",
//             "[10:04:15] - DEBUG: PMON temps: {1: '18.99', 2: '19.05', 3: '22.88', 4: '20.43', 5: '21.93', 6: '19.36'}"
//         ];
//         processLogLines(moreLogs);
        
//         // Display current data after processing the additional logs
//         console.log("Current data after processing additional logs:");
//         console.log("Pressure:", currentData.pressure);
//         console.log("Safety Flags:", currentData.safetyFlags);
//         console.log("Temperatures:", currentData.temperatures);
//     }, 2000);
// }

// Start the processing
//startProcessing();

// Simulate log processing (in a real scenario, you'd process logs as they arrive)
//simulateLogProcessing();