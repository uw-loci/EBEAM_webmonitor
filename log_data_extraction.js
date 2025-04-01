// Function to get the current time in HH:mm format
const getCurrentTime = () => {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  };
  
  // Function to check if the timestamp is within one minute of the current time
  const isWithinOneMinute = (timestamp) => {
    const currentTime = getCurrentTime();
    // Compare only hours and minutes (ignoring seconds for one-minute difference)
    return currentTime === timestamp.substring(0, 5);
  };
  
  // Store temperature data
  let tempData = {};
  
  // Function to handle each log line
  const handleLogLine = (logLine) => {
    // Extract timestamp (HH:mm:ss) and log type
    const timestampRegex = /^\[(\d{2}:\d{2}:\d{2})\]/;
    const timestampMatch = logLine.match(timestampRegex);
    if (!timestampMatch) {
      console.log("Invalid log format:", logLine);
      return;
    }
    const timestamp = timestampMatch[1];
  
    // If timestamp is not within the last minute, skip processing
    if (!isWithinOneMinute(timestamp)) {
      return;
    }
  
    // Extract log type and value from the log line
    const logTypeRegex = / - (DEBUG: .+?):/;
    const logTypeMatch = logLine.match(logTypeRegex);
    if (!logTypeMatch) {
      console.log("Unknown log type:", logLine);
      return;
    }
    const logType = logTypeMatch[1];
    let value = null;
  
    // Handle different log types
    switch (logType) {
      case "DEBUG: GUI updated with pressure":
        const pressureRegex = /DEBUG: GUI updated with pressure: ([\d\.E\+]+)/;
        const pressureMatch = logLine.match(pressureRegex);
        if (pressureMatch) {
          value = parseFloat(pressureMatch[1]);
          console.log("Pressure:", value);
        }
        break;
  
      case "DEBUG: Safety Output Terminal Data Flags":
        const flagsRegex = /DEBUG: Safety Output Terminal Data Flags: (\[.*\])/;
        const flagsMatch = logLine.match(flagsRegex);
        if (flagsMatch) {
          value = JSON.parse(flagsMatch[1]);
          console.log("Safety Flags:", value);
        }
        break;
  
        case "DEBUG: PMON temps":
            const tempsRegex = /DEBUG: PMON temps: (\{.*\})/;
            const tempsMatch = logLine.match(tempsRegex);
            if (tempsMatch) {
                // Replace single quotes with double quotes to parse as valid JSON
                let tempsStr = tempsMatch[1];
                // Replace single quotes with double quotes
                tempsStr = tempsStr.replace(/'/g, '"');
                
                // Optional: Ensure that the keys are converted to strings (even numbers should be quoted)
                tempsStr = tempsStr.replace(/(\d+):/g, '"$1":'); // Convert number keys to string keys
                
                try {
                value = JSON.parse(tempsStr);
                console.log("PMON Temps:", value);
                // Replace old temp data with new data
                tempData = { ...value }; // New temps replace the old ones
                } catch (error) {
                console.error("Error parsing temps:", error);
                }
            }
            break;
  
      default:
        console.log("Unknown log type:", logType);
        break;
    }
  
    // Output the processed data
    if (value !== null) {
      console.log("Timestamp:", timestamp);
      console.log("Type:", logType);
      console.log("Value:", value);
    }
  };
  
  // Simulate reading log lines
  const simulateLogLines = () => {
    // Example log lines
    const logLines = [
      "[11:27:30] - DEBUG: GUI updated with pressure: 1.20E+3 mbar",
      "[11:27:30]] - DEBUG: Safety Output Terminal Data Flags: [0, 0, 0, 0, 0, 0, 1]",
      "[11:27:30] - DEBUG: PMON temps: {1: '18.94', 2: '19.00', 3: '22.83', 4: '20.38', 5: '21.88', 6: '19.31'}"
    ];
  
    // Process each log line (simulate log line arrival)
    logLines.forEach(logLine => handleLogLine(logLine));
};
  
// Simulate log line processing
simulateLogLines();
  