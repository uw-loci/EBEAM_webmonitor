const express = require('express');
const fetch = require('node-fetch');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

// Load environment variables
require('dotenv').config();

const FOLDER_ID = process.env.FOLDER_ID;
const API_KEY = process.env.API_KEY;
const PORT = process.env.PORT || 3000;

// File paths for local storage
const REVERSED_FILE_PATH = path.join(__dirname, 'reversed.txt');

// Initialize Express app
const app = express();

// Initialize Google Drive API
const drive = google.drive({ version: 'v3', auth: API_KEY });

let lastModifiedTime = null;  // Store last modified time in memory
let logFileName = null;

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

/**
 * Fetch and update the reversed file only if there's a new version.
 */
async function fetchAndUpdateFile() {
  try {
    const mostRecentFile = await getMostRecentFile();
    if (!mostRecentFile) return false; // API failure, avoid crashing

    // Skip fetching if the file is unchanged
    if (lastModifiedTime && lastModifiedTime === mostRecentFile.modifiedTime) {
      console.log("No new updates. Using cached file.");
      return false;
    }

    console.log("Fetching new file...");

    // Retry logic for fetching file contents
    let retries = 3;
    let fileResponse;
    while (retries > 0) {
      fileResponse = await fetch(
        `https://www.googleapis.com/drive/v3/files/${mostRecentFile.id}?alt=media&key=${API_KEY}`
      );

      if (fileResponse.ok) break; // Exit loop if successful
      console.log(`Retrying... (${4 - retries} attempt)`);
      retries--;
      await new Promise(res => setTimeout(res, 2000)); // Wait before retrying
    }

    if (!fileResponse.ok) throw new Error(`Google API Fetch Failed`);

    const fileContents = await fileResponse.text();
    const reversedContents = fileContents.split('\n').reverse().join('\n');

    // Save the reversed file locally
    fs.writeFileSync(REVERSED_FILE_PATH, reversedContents);

    // Update metadata (last modified time)
    lastModifiedTime = mostRecentFile.modifiedTime;
    logFileName = mostRecentFile.name;

    console.log("File updated successfully.");
    return true; // File was updated
  } catch (err) {
    console.error(`Error processing file: ${err.message}`);
    return false;
  }
}

// Fetch the latest file on server startup
setTimeout(fetchAndUpdateFile, 2000);  // Small delay to allow startup
setInterval(fetchAndUpdateFile, 60000);  // Fetch every 60 seconds

/**
 * GET / : Serve the HTML page with reversed log lines.
 */
app.get('/', async (req, res) => {
  try {
    let reversedContents = "No data available.";

    // Serve cached file if available
    if (fs.existsSync(REVERSED_FILE_PATH)) {
      reversedContents = fs.readFileSync(REVERSED_FILE_PATH, 'utf8');
    }

    // HTML Response with smart reload logic
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8" />
        <title>Reversed Log Viewer</title>
        <script type="text/javascript">
          async function checkForUpdate() {
            try {
              const response = await fetch('/last-modified');  
              const data = await response.json();

              if (localStorage.getItem('lastModified') !== data.lastModified) {
                localStorage.setItem('lastModified', data.lastModified);
                location.reload();  // Reload only if the file has changed
              }
            } catch (error) {
              console.error("Error checking for updates:", error);
            }
          }
          
          setInterval(checkForUpdate, 60000);  // Check every 60 seconds
        </script>
      </head>
      <body>
        <h1>Reversed Log Viewer</h1>
        <p>Most Recent File: ${logFileName || "Unknown"}</p>
        <p>File Last Modified: ${lastModifiedTime || "Unknown"}</p>
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
          })}</p>
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
 * GET /last-modified : Return the last modified time.
 */
app.get('/last-modified', (req, res) => {
  res.json({ lastModified: lastModifiedTime || "Unknown" });
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
