const express = require('express');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const https = require('https');


// Load environment variables
require('dotenv').config();

const FOLDER_ID = process.env.FOLDER_ID;
const API_KEY = process.env.API_KEY;
const PORT = process.env.PORT || 3000;

// File paths for local storage
const REVERSED_FILE_PATH = path.join(__dirname, 'reversed.txt');

// 15 minutes in milliseconds
const INACTIVE_THRESHOLD = 15 * 60 * 1000;

// Initialize Express app
const app = express();

// Initialize Google Drive API
const drive = google.drive({ version: 'v3', auth: API_KEY });

/**
 * Fetch the most recent file from Google Drive.
 */
async function getMostRecentFile() {
  try {
    const res = await drive.files.list({
      q: `'${FOLDER_ID}' in parents and mimeType='text/plain'`,
      orderBy: 'modifiedTime desc',
      pageSize: 1,
      fields: 'files(id, name, modifiedTime)',
    });

    const files = res.data.files;
    if (!files || files.length === 0) {
      throw new Error('No files found in the folder.');
    }

    return files[0]; // Returns the most recent file (ID, name, modifiedTime)
  } catch (err) {
    console.error(`Google Drive API Error: ${err.message}`);
    return null;
  }
}

let lastModifiedTime = null;
let logFileName = null;
let experimentRunning = false;

/**
 * Fetches file contents from Google Drive using streaming
 * @param {string} fileId - The Google Drive file ID
 * @returns {Promise<string[]>} Array of lines from the file
 */
async function fetchFileContents(fileId) {
  let retries = 3;
  
  while (retries > 0) {
    try {
      const response = await new Promise((resolve, reject) => {
        https.get(
          `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&key=${API_KEY}`,
          {
            headers: {
              'Accept': 'text/plain'
            }
          },
          (res) => {
            if (res.statusCode !== 200) {
              reject(new Error(`Google API Failed: ${res.statusCode}`));
              return;
            }
            resolve(res);
          }
        ).on('error', reject);
      });

      // Process the stream line by line
      const lines = [];
      let currentLine = '';

      await new Promise((resolve, reject) => {
        response.on('data', chunk => {
          const chunkStr = chunk.toString();
          const chunkLines = (currentLine + chunkStr).split('\n');
          currentLine = chunkLines.pop();
          lines.push(...chunkLines);
        });

        response.on('end', () => {
          if (currentLine) lines.push(currentLine);
          resolve();
        });

        response.on('error', reject);
      });

      return lines;
    } catch (err) {
      console.log(`Retry ${4 - retries}: ${err.message}`);
      retries--;
      if (retries === 0) throw err;
      await new Promise(res => setTimeout(res, 2000));
    }
  }
}

/**
 * Fetches and updates the log file if there's a new version
 * @returns {Promise<boolean>} True if file was updated, false otherwise
 */
async function fetchAndUpdateFile() {
  try {
    const mostRecentFile = await getMostRecentFile();
    if (!mostRecentFile) {
      experimentRunning = false;
      return false;
    }
    
    const fileModifiedTime = new Date(mostRecentFile.modifiedTime).getTime();
    const currentTime = new Date().getTime(); // Ensures UTC comparison
    
    
    // Check if file hasn't been modified in last 15 minutes
    // KEEP THIS FOR FUTURE NEED FOR AFTER DEVELOPMENT FINISHED
    // if (currentTime - fileModifiedTime > INACTIVE_THRESHOLD) {
    //   experimentRunning = false;
    //   console.log("Experiment not running - no updates in 15 minutes");
    //   return false;
    // }

    if (lastModifiedTime && lastModifiedTime === mostRecentFile.modifiedTime) {
      console.log("No new updates. Using cached file.");
      experimentRunning = true; // Still running if within threshold
      return false;
    }

    console.log("Fetching new file...");
    
    const lines = await fetchFileContents(mostRecentFile.id);
    
    // Write reversed lines in one operation
    fs.writeFileSync(REVERSED_FILE_PATH, lines.reverse().join('\n'));
    
    lastModifiedTime = mostRecentFile.modifiedTime;
    logFileName = mostRecentFile.name;
    experimentRunning = true;

    console.log("File updated successfully.");
    return true;
  } catch (err) {
    console.error(`Error processing file: ${err.message}`);
    experimentRunning = false;
    return false;
  }
}

// Schedule updates
fetchAndUpdateFile(); // Initial fetch
setInterval(fetchAndUpdateFile, 60000); // Check every minute

/**
 * GET / : Serve the HTML page with reversed log lines.
 */
app.get('/', async (req, res) => {
  try {
    if (!experimentRunning) {
      res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8" />
          <title>Reversed Log Viewer</title>
          <script type="text/javascript">
            setTimeout(function() {
              location.reload();
            }, 60000);
          </script>
        </head>
        <body>
          <h1>Experiment Status</h1>
          <p style="font-size: 1.5em; color: red;">Experiment is not running.</p>
        </body>
        </html>
      `);
      return;
    }

    let reversedContents = "No data available.";

    // Fetch the latest file in the background
    // fetchAndUpdateFile();

    // Serve cached file if available
    if (fs.existsSync(REVERSED_FILE_PATH)) {
      reversedContents = fs.readFileSync(REVERSED_FILE_PATH, 'utf8');
    }

    // HTML Response
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8" />
        <title>Reversed Log Viewer</title>
        <script type="text/javascript">
          setTimeout(function() {
            location.reload();
          }, 60000);
        </script>
      </head>
      <body>
        <h1>Reversed Log Viewer</h1>
        <p>Most Recent File: ${logFileName}</p>
        <p>File Last Modified: ${lastModifiedTime}</p>
        <p>Last Updated: ${new Date().toLocaleString('en-US', {
            timeZone: 'America/Chicago',
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: true
          })}
        </p>
        <pre style="white-space: pre-wrap; font-family: monospace;">
${reversedContents}
        </pre>
      </body>
      </html>
    `);
  } catch (err) {
    console.error(err);
    res.status(500).send(`Error: ${err.message}`);
  }
});

/**
 * GET/dashboard: Implement the log file dashboard to this end point.
 */
app.get('/dashboard', async (req, res) => {
  try{
    res.send('Hi; I am Log System Dashboard. I am being built so bare with me until then. (::)');
  }catch (err) {
    // Handle any errors
    console.error(err);
    res.status(500).send('Internal Server Error');
  }
});


/**
 * GET /raw : Returns just the reversed text (newest at top).
 */
app.get('/raw', async (req, res) => {
  try {
    if (fs.existsSync(REVERSED_FILE_PATH)) {
      res.type('text/plain').send(fs.readFileSync(REVERSED_FILE_PATH, 'utf8'));
    } else {
      res.status(404).send("No file found.");
    }
  } catch (err) {
    console.error(err);
    res.status(500).send(`Error: ${err.message}`);
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
