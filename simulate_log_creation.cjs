// log_generator.js

const logs = [];

// Base template (everything except timestamp and pressure)
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

// Add 5 lines every minute
function addLogs() {
  for (let i = 0; i < 2; i++) {
    const line = generateLogLine();
    logs.push(line);
    console.log(JSON.stringify(line));
  }
  console.log(`→ Added 2 new log lines. Total: ${logs.length}`);
}

// Start interval (every 60 seconds)
console.log("Log generator started...");
addLogs(); // Generate first batch immediately
setInterval(addLogs, 60 * 1000);
