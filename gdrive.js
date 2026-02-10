const fs = require('fs');
const https = require('https');
const { drive, FOLDER_ID, API_KEY, REVERSED_FILE_PATH } = require('./config');
const state = require('./state');

/**
 * Fetch the most recent plain-text log files from Google Drive.
 * Returns { dataFile, displayFile } where either may be null.
 */
async function getMostRecentFile() {
  try {
    const res = await drive.files.list({
      q: `'${FOLDER_ID}' in parents and mimeType='text/plain'`,
      orderBy: 'modifiedTime desc',
      pageSize: 5,
      fields: 'files(id, name, modifiedTime)',
    });

    const files = res.data.files;
    console.log("Latest files seen:", files.map(f => f.name));

    let displayFile = null;

    if (!files || files.length === 0) {
      throw new Error('No files found in the folder.');
    }

    let dataFile = null;

    for (const file of files){
      if (file.name.startsWith('webMonitor')){
        dataFile = file;
        console.log(dataFile);
        console.log("DATA FILE'S ID: ", dataFile.id)
      }
      else if (file.name.startsWith('log_')){
        displayFile = file;
      }
      if (dataFile) break;
    }
    return {dataFile, displayFile};

  } catch (err) {
    console.error(`Google Drive API Error: ${err.message}`);
    return {dataFile: null, displayFile: null};
  }
}

/**
 * Stream-downloads a text file from Google Drive and returns its lines.
 */
async function fetchFileContents(fileId) {
  let retries = 3;

  while (retries > 0) {
    try {
      const response = await new Promise((resolve, reject) => {
        https
          .get(
            `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&key=${API_KEY}`,
            { headers: { Accept: 'text/plain' } },
            res => {
              if (res.statusCode !== 200) {
                reject(new Error(`Google API Failed: ${res.statusCode}`));
                return;
              }
              resolve(res);
            }
          )
          .on('error', reject);
      });

      const lines = [];
      let currentLine = '';

      await new Promise((resolve, reject) => {
        response.on('data', chunk => {
          const chunkStr   = chunk.toString();
          const chunkLines = (currentLine + chunkStr).split('\n');
          currentLine = chunkLines.pop();
          lines.push(...chunkLines);
        });

        response.on('end', () => {
          if (currentLine){
            lines.push(currentLine);
          }
          resolve();
        });

        response.on('error', reject);
      });

      return lines;

    } catch (err) {
      console.log(`Retry ${4 - retries}: ${err.message}`);
      return false;
    }
  }
}

/**
 * Writes an array of lines to a local file using a writable stream.
 */
function writeToFile(lines) {
  return new Promise((resolve, reject) => {
    const writeStream = fs.createWriteStream(REVERSED_FILE_PATH, { flags: 'w' });
    let i = 0;

    function writeNext() {
      let ok = true;
      while (i < lines.length && ok) {
        ok = writeStream.write(lines[i] + '\n');
        i++;
      }
      if (i < lines.length) {
        writeStream.once('drain', writeNext);
      } else {
        writeStream.end();
      }
    }

    writeStream.on('finish', async () => {
      console.log('Reversed log updated successfully.');
      resolve(true);
    });

    writeStream.on('error', (err) => {
      console.error("Write error:", err);
      reject(err);
    });

    writeNext();
  });
}

/**
 * Fetch display log from Google Drive, reverse it, and write to local file.
 */
async function fetchDisplayFileContents() {
  try {
    const { dataFile, displayFile } = await getMostRecentFile();

    if (!displayFile){
      console.log("No display file found!");
      return false;
    }

    console.log("Fetching new display log file...");
    let displayLines = null;
    try {
      displayLines = await fetchFileContents(displayFile.id);
      if (!Array.isArray(displayLines)) {
        console.warn("Display File fetch failed or returned no lines. Skipping extraction.");
        return false;
      }
      displayLines.reverse();
      displayLines = displayLines.slice(0, 100000);
    } catch (e) {
      console.error("Log file failed:", e);
    }

    const writePromise = writeToFile(displayLines);

    const [writeResult] = await Promise.allSettled([
      writePromise
    ]);

    if (writeResult.status === 'fulfilled') {
      console.log("File write complete.");
      if (dataFile) {
        state.lastModifiedTime = dataFile.modifiedTime;
      }
    } else {
      console.error("File write failed:", writeResult.reason);
    }

  } catch (err) {
    console.error(`Error processing file: ${err.message}`);
    return false;
  }
}

module.exports = {
  getMostRecentFile,
  fetchFileContents,
  writeToFile,
  fetchDisplayFileContents,
};
