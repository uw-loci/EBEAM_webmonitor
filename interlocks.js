// Interlock status inference functions
// Each returns "green", "red", or "grey" based on flag arrays

function getDoorStatus(inputFlags, statusFlags) {
  if (!Array.isArray(inputFlags) || !Array.isArray(statusFlags)) return "grey";
  if (!inputFlags || inputFlags.length < 13 || !statusFlags || statusFlags.length < 13) return "grey";
  const data = inputFlags[4] && inputFlags[5];
  const status_f = statusFlags[4] && statusFlags[5];
  return (data && status_f)? "green" : "red";
}

function getVacuumPower(inputFlags, statusFlags) {
  if (!Array.isArray(inputFlags) || !Array.isArray(statusFlags)) return "grey";
  if (!inputFlags || inputFlags.length < 13 || !statusFlags || statusFlags.length < 13) return "grey";
  const data = inputFlags[6];
  const status_f = statusFlags[6];
  return (data && status_f)? "green" : "red";
}

function getVacuumPressure(inputFlags, statusFlags) {
  if (!Array.isArray(inputFlags) || !Array.isArray(statusFlags)) return "grey";
  if (!inputFlags || inputFlags.length < 13 || !statusFlags || statusFlags.length < 13) return "grey";
  const data = inputFlags[7];
  const status_f = statusFlags[7];
  return (data && status_f)? "green" : "red";
}

function getAllInterlocksStatus(outputFlags) {
 if (!Array.isArray(outputFlags) || !Array.isArray(outputFlags)) return "grey";
 if (!outputFlags || outputFlags.length < 7) return "grey";
 if (outputFlags[6]) return "red";
 return outputFlags[5] ? "green" : "red";
}

function getWaterStatus(inputFlags, statusFlags) {
  if (!Array.isArray(inputFlags) || !Array.isArray(statusFlags)) return "grey";
  if (!inputFlags || inputFlags.length < 13 || !statusFlags || statusFlags.length < 13) return "grey";
  const data = inputFlags[10];
  const status_f = statusFlags[10];
  return (data && status_f)? "green" : "red";
}

function getG9Output(outputFlags) {
 if (!Array.isArray(outputFlags) || !Array.isArray(outputFlags)) return "grey";
 if (!outputFlags || outputFlags.length < 7) return "grey";
 return outputFlags[4] ? "green" : "red";
}

function getEStopInternal(inputFlags, statusFlags) {
  if (!Array.isArray(inputFlags) || !Array.isArray(statusFlags)) return "grey";
  if (!inputFlags || inputFlags.length < 13 || !statusFlags || statusFlags.length < 13) return "grey";
  const data = inputFlags[0] && inputFlags[1];
  const status_f = statusFlags[0] && statusFlags[1];
  return (data && status_f)? "green" : "red";
}

function getEStopExternal(inputFlags, statusFlags) {
  if (!Array.isArray(inputFlags) || !Array.isArray(statusFlags)) return "grey";
  if (!inputFlags || inputFlags.length < 13 || !statusFlags || statusFlags.length < 13) return "grey";
  const data = inputFlags[2] && inputFlags[3];
  const status_f = statusFlags[2] && statusFlags[3];
  return (data && status_f)? "green" : "red";
}

function getOilLow(inputFlags, statusFlags) {
  if (!Array.isArray(inputFlags) || !Array.isArray(statusFlags)) return "grey";
  if (!inputFlags || inputFlags.length < 13 || !statusFlags || statusFlags.length < 13) return "grey";
  const data = inputFlags[9];
  const status_f = statusFlags[9];
  return (data && status_f)? "green" : "red";
}

function getOilHigh(inputFlags, statusFlags) {
  if (!Array.isArray(inputFlags) || !Array.isArray(statusFlags)) return "grey";
  if (!inputFlags || inputFlags.length < 13 || !statusFlags || statusFlags.length < 13) return "grey";
  const data = inputFlags[8];
  const status_f = statusFlags[8];
  return (data && status_f)? "green" : "red";
}

function getHvoltOn(inputFlags, statusFlags) {
  if (!Array.isArray(inputFlags) || !Array.isArray(statusFlags)) return "grey";
  if (!inputFlags || inputFlags.length < 13 || !statusFlags || statusFlags.length < 13) return "grey";
  const data = inputFlags[11];
  const status_f = statusFlags[11];
  if (data == 0 && status_f == 1){
    return "green"
  }
  else{
    return "red"
  }
}

// Vacuum Indicators
function varBitToColor(bits, index) {
  if (!Array.isArray(bits) || bits.length < 8) return "grey";
  return bits[index] ? "green" : "red";
}

/**
 * Compute all interlock and vacuum colors in one call.
 * Eliminates duplication between the / and /data routes.
 */
function computeAllColors(data, experimentRunning) {
  const inF  = data.safetyInputDataFlags || null;
  const outF = data.safetyOutputDataFlags || null;
  const inSF = data.safetyInputStatusFlags || null;

  const sicColors = experimentRunning ? [
    getDoorStatus(inF, inSF),
    getWaterStatus(inF, inSF),
    getVacuumPower(inF, inSF),
    getVacuumPressure(inF, inSF),
    getOilLow(inF, inSF),
    getOilHigh(inF, inSF),
    getEStopInternal(inF, inSF),
    getEStopExternal(inF, inSF),
    getAllInterlocksStatus(outF),
    getG9Output(outF),
    getHvoltOn(inF, inSF),
  ] : Array(11).fill("grey");

  const vacColors = experimentRunning
    ? Array.from({ length: 8 }, (_, i) =>
        data.vacuumBits ? varBitToColor(data.vacuumBits, i) : 'grey'
      )
    : Array(8).fill("grey");

  return { sicColors, vacColors };
}

module.exports = {
  getDoorStatus,
  getVacuumPower,
  getVacuumPressure,
  getAllInterlocksStatus,
  getWaterStatus,
  getG9Output,
  getEStopInternal,
  getEStopExternal,
  getOilLow,
  getOilHigh,
  getHvoltOn,
  varBitToColor,
  computeAllColors,
};
