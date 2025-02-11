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
const METADATA_FILE_PATH = path.join(__dirname, 'metadata.json');

// Initialize Express app
const app = express();

// Initialize Google Drive API
const drive = google.drive({ version: 'v3', auth: API_KEY });

/**
 * Fetch the most recent file in the specified Google Drive folder.
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

    return files[0]; // Returns the most recent file
  } catch (err) {
    throw new Error(`Error retrieving files: ${err.message}`);
  }
}

/**
 * Fetch, reverse, and save the latest file if updated.
 */
async function fetchAndUpdateFile() {
  try {
    const mostRecentFile = await getMostRecentFile();

    // Load last known file metadata
    let lastModifiedTime = null;
    if (fs.existsSync(METADATA_FILE_PATH)) {
      const metadata = JSON.parse(fs.readFileSync(METADATA_FILE_PATH, 'utf8'));
      lastModifiedTime = metadata.modifiedTime;
    }

    // If file is unchanged, skip fetching
    if (lastModifiedTime && lastModifiedTime === mostRecentFile.modifiedTime) {
      console.log("No new updates. Using cached file.");
      return false;
    }

    console.log("Fetching new file...");

    // Download the latest file
    const fileResponse = await fetch(
      `https://www.googleapis.com/drive/v3/files/${mostRecentFile.id}?alt=media&key=${API_KEY}`
    );

    if (!fileResponse.ok) {
      throw new Error(`File fetch failed with status ${fileResponse.status}`);
    }

    const fileContents = await fileResponse.text();
    const reversedContents = fileContents.split('\n').reverse().join('\n');

    // Save the reversed file locally
    fs.writeFileSync(REVERSED_FILE_PATH, reversedContents);
    
    // Save metadata (last modified time)
    fs.writeFileSync(METADATA_FILE_PATH, JSON.stringify({ modifiedTime: mostRecentFile.modifiedTime }));

    console.log("File updated successfully.");
    return true; // File was updated
  } catch (err) {
    console.error(`Error processing file: ${err.message}`);
    return false;
  }
}

/**
 * GET / : Serve the HTML page with reversed log lines.
 */
app.get('/', async (req, res) => {
  try {
    let reversedContents = "No data available.";

    // If the file exists, serve it immediately
    if (fs.existsSync(REVERSED_FILE_PATH)) {
      reversedContents = fs.readFileSync(REVERSED_FILE_PATH, 'utf8');
    }

    // Fetch the latest file in the background
    const updated = await fetchAndUpdateFile();

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
        <p>Most Recent File: ${fs.existsSync(METADATA_FILE_PATH) ? JSON.parse(fs.readFileSync(METADATA_FILE_PATH)).modifiedTime : 'Unknown'}</p>
        <pre style="white-space: pre-wrap; font-family: monospace;">
${reversedContents}
        </pre>
        <p>Last Updated: ${new Date().toLocaleString()}</p>
      </body>
      </html>
    `);
  } catch (err) {
    console.error(err);
    res.status(500).send(`Error: ${err.message}`);
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
