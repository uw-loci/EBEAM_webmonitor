// extract-log-data.js
const fs = require('fs');
const readline = require('readline');

// Reuse this extractData() function exactly as we built it earlier
async function extractData(lines) {
  try {
    const data = {
      pressure: null,
      pressureTimestamp: null,
      safetyInputDataFlags: null,
      safetyOutputDataFlags: null,
      safetyInputStatusFlags: null,
      safetyOutputStatusFlags: null,
      temperatures: null,
      vacuumBits: null,
    };

    let firstTimestamp = null;

    // Loop through each line in the log file
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let jsonData;

      try {
        jsonData = JSON.parse(line);
      } catch (e) {
        console.log(`Error parsing JSON at line ${i}:`, line, e);
        continue;
      }

      if (firstTimestamp === null && jsonData.timestamp) {
        firstTimestamp = new Date(jsonData.timestamp);
      }

      if (firstTimestamp && jsonData.timestamp) {
        const currentTimestamp = new Date(jsonData.timestamp);
        const elapsedSeconds = (currentTimestamp - firstTimestamp) / 1000;

        if (elapsedSeconds > 60) {
          console.log("Reached 1-minute window. Stopping.");
          break;
        }
      }

      const status = jsonData.status || {};

      if (status.pressure != null && data.pressure === null) {
        data.pressure = parseFloat(status.pressure);
        data.pressureTimestamp = jsonData.timestamp;
      }
      if (status.safetyOutputDataFlags && data.safetyOutputDataFlags === null) {
        data.safetyOutputDataFlags = status.safetyOutputDataFlags;
      }
      if (status.safetyInputDataFlags && data.safetyInputDataFlags === null) {
        data.safetyInputDataFlags = status.safetyInputDataFlags;
      }
      if (status.safetyOutputStatusFlags && data.safetyOutputStatusFlags === null) {
        data.safetyOutputStatusFlags = status.safetyOutputStatusFlags;
      }
      if (status.safetyInputStatusFlags && data.safetyInputStatusFlags === null) {
        data.safetyInputStatusFlags = status.safetyInputStatusFlags;
      }
      if (status.temperatures && data.temperatures === null) {
        data.temperatures = status.temperatures;
      }
      if (status.vacuumBits && data.vacuumBits === null) {
        if (typeof status.vacuumBits === 'string') {
          data.vacuumBits = status.vacuumBits.split('').map(bit => bit === '1');
        } else {
          data.vacuumBits = status.vacuumBits;
        }
      }

      if (Object.values(data).every(value => value !== null)) {
        console.log("✅ All fields found. Exiting early.");
        return data;
      }
    }

    return data;

  } catch (e) {
    console.log("Error:", e);
    throw new Error("Extraction failed: pattern not found");
  }
}

// ==== MAIN PROGRAM ====

async function main() {
  const filePath = process.argv[2];

  if (!filePath) {
    console.error("❌ Usage: node extract-log-data.js <path_to_log_file>");
    process.exit(1);
  }

  const lines = [];

  try {
    const rl = readline.createInterface({
      input: fs.createReadStream(filePath),
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      if (line.trim()) {
        lines.push(line.trim());
      }
    }

    const result = await extractData(lines);
    console.log("✅ Extracted Data:");
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error("❌ Failed to read or process the file:", err);
  }
}

main();
