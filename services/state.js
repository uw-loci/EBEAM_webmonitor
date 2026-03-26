// Shared mutable state — all modules read/write through this object

const state = {
  lastModifiedTime: null,
  webMonitorLastModified: null,
  displayLogLastModified: null,
  displayLogFileId: null,
  experimentRunning: false,
  lastShortTermCursor: null,
  lastLongTermCursor: null,
  dataLines: null,
  debugLogs: [],
  sampleDataLines: [],
  timestamps: [],
  extractLines: [],

  // Base status used for sample data generation
  baseStatus: {
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
  },

  // Main data object holding all extracted experimental values
  data: {
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
  },
};

module.exports = state;
