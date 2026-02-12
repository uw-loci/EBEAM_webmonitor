const { supabase } = require('../config');
const state = require('./state');

/**
 * Fetches the most recent entry from Supabase beam_logs table
 * @returns {Object|null} Most recent log entry or null if error/no data
 */
async function fetchLatestSupabaseEntry() {
  try {
    const { data, error } = await supabase
      .from('beam_logs')
      .select('experiment_time, created_at, log_data')
      .order('experiment_time', { ascending: false })
      .limit(1);

    if (error) {
      console.error('Supabase query error:', error);
      return null;
    }

    if (!data || data.length === 0) {
      console.log('No data found in Supabase table');
      return null;
    }

    return data[0];
  } catch (err) {
    console.error('Error fetching from Supabase:', err);
    return null;
  }
}

/**
 * Maps Supabase log_data JSON to the application's data object format
 * @param {Object} logData - The log_data JSON from Supabase
 * @returns {Object} Mapped data object
 */
function mapSupabaseDataToAppFormat(logData) {
  if (!logData) return null;

  return {
    pressure: logData.pressure || null,
    pressureTimestamp: logData.pressureTimestamp || null,
    safetyInputDataFlags: logData.safetyInputDataFlags || null,
    safetyOutputDataFlags: logData.safetyOutputDataFlags || null,
    safetyInputStatusFlags: logData.safetyInputStatusFlags || null,
    safetyOutputStatusFlags: logData.safetyOutputStatusFlags || null,
    temperatures: logData.temperatures || null,
    vacuumBits: typeof logData.vacuumBits === 'string'
      ? logData.vacuumBits.split('').map(bit => bit === '1')
      : (logData.vacuumBits || null),
    heaterCurrent_A: logData["Cathode A - Heater Current:"] ?? null,
    heaterCurrent_B: logData["Cathode B - Heater Current:"] ?? null,
    heaterCurrent_C: logData["Cathode C - Heater Current:"] ?? null,
    heaterVoltage_A: logData["Cathode A - Heater Voltage:"] ?? null,
    heaterVoltage_B: logData["Cathode B - Heater Voltage:"] ?? null,
    heaterVoltage_C: logData["Cathode C - Heater Voltage:"] ?? null,
    clamp_temperature_A: logData.clamp_temperature_A ?? null,
    clamp_temperature_B: logData.clamp_temperature_B ?? null,
    clamp_temperature_C: logData.clamp_temperature_C ?? null
  };
}

/**
 * Reset data when experiment is inactive
 */
function resetData() {
  state.data = {
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
  };
}

module.exports = {
  fetchLatestSupabaseEntry,
  mapSupabaseDataToAppFormat,
  resetData,
};
