const { supabase } = require('../config');

// Random-walk state
let pressure = 0.001;
let clamp_temperature_A = 50.0;
let clamp_temperature_B = 50.0;
let clamp_temperature_C = 50.0;
let temperatures = { "1": 25.0, "2": 25.0, "3": 25.0, "4": 25.0, "5": 25.0, "6": 25.0 };
let heaterCurrent_A = 1.0, heaterCurrent_B = 1.0, heaterCurrent_C = 1.0;
let heaterVoltage_A = 5.0, heaterVoltage_B = 5.0, heaterVoltage_C = 5.0;

function walk(val, delta, min, max) {
  const next = val + (Math.random() * 2 - 1) * delta;
  return Math.min(max, Math.max(min, next));
}

async function tick() {
  // Apply random walks
  pressure = walk(pressure, pressure * 0.01, 0.0001, 0.01);
  clamp_temperature_A = walk(clamp_temperature_A, 0.5, 20, 120);
  clamp_temperature_B = walk(clamp_temperature_B, 0.5, 20, 120);
  clamp_temperature_C = walk(clamp_temperature_C, 0.5, 20, 120);
  for (const k of Object.keys(temperatures)) {
    temperatures[k] = walk(temperatures[k], 0.2, 10, 80);
  }
  heaterCurrent_A = walk(heaterCurrent_A, 0.02, 0, 5);
  heaterCurrent_B = walk(heaterCurrent_B, 0.02, 0, 5);
  heaterCurrent_C = walk(heaterCurrent_C, 0.02, 0, 5);
  heaterVoltage_A = walk(heaterVoltage_A, 0.05, 0, 20);
  heaterVoltage_B = walk(heaterVoltage_B, 0.05, 0, 20);
  heaterVoltage_C = walk(heaterVoltage_C, 0.05, 0, 20);

  const r = v => Math.round(v * 1000) / 1000;

  const data = {
    pressure: r(pressure),
    pressureTimestamp: new Date().toISOString(),
    vacuumBits: "00000000",
    safetyInputDataFlags: [false, false, false, false, false, false, false, false],
    safetyOutputDataFlags: [false, false, false, false, false, false, false, false],
    safetyInputStatusFlags: [false, false, false, false, false, false, false, false],
    safetyOutputStatusFlags: [false, false, false, false, false, false, false, false],
    temperatures: Object.fromEntries(Object.entries(temperatures).map(([k, v]) => [k, r(v)])),
    clamp_temperature_A: r(clamp_temperature_A),
    clamp_temperature_B: r(clamp_temperature_B),
    clamp_temperature_C: r(clamp_temperature_C),
    "Cathode A - Heater Current:": r(heaterCurrent_A),
    "Cathode B - Heater Current:": r(heaterCurrent_B),
    "Cathode C - Heater Current:": r(heaterCurrent_C),
    "Cathode A - Heater Voltage:": r(heaterVoltage_A),
    "Cathode B - Heater Voltage:": r(heaterVoltage_B),
    "Cathode C - Heater Voltage:": r(heaterVoltage_C),
  };

  const { error } = await supabase.from('short_term_logs').insert({ data });
  if (error) {
    console.error('[SIMULATION] Insert error:', error.message);
  } else {
    console.log(`[SIMULATION] Inserted row — pressure: ${pressure.toExponential(3)} mbar`);
  }
}

function startSimulation() {
  setInterval(tick, 3000);
}

module.exports = { startSimulation };
