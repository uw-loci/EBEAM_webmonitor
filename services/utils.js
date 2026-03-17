const state = require('./state');

function getTimestamp() {
  const now = new Date();
  return now.toISOString().replace('T', ' ').substring(0, 19);
}

function randomPressure() {
  const min = 7.60e-8;
  const max = 1.20e+3;
  const pressure = Math.random() * (max - min) + min;
  return pressure.toExponential(2);
}

function generateLogLine() {
  return {
    timestamp: getTimestamp(),
    status: {
      pressure: randomPressure(),
      ...state.baseStatus
    }
  };
}

function addLogs() {
  if (state.sampleDataLines.length < 10) {
    for (let i = 0; i < 1; i++) {
      const line = generateLogLine();
      state.sampleDataLines.unshift(JSON.stringify(line));
    }
  }
}

const chicagoTimeFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
  hour12: false
});

function secondsSinceMidnightChicago() {
  const parts = chicagoTimeFormatter.formatToParts(new Date());
  let hours = 0, minutes = 0, seconds = 0;

  for (const part of parts) {
    if (part.type === 'hour') hours = parseInt(part.value, 10);
    else if (part.type === 'minute') minutes = parseInt(part.value, 10);
    else if (part.type === 'second') seconds = parseInt(part.value, 10);
  }

  return hours * 3600 + minutes * 60 + seconds;
}

module.exports = {
  getTimestamp,
  randomPressure,
  generateLogLine,
  addLogs,
  secondsSinceMidnightChicago,
};
