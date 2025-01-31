const express = require('express');
const fetch = require('node-fetch');
const { google } = require('googleapis'); // Google Drive API

// Public folder ID
const FOLDER_ID = '1-1PKnmvtWe6ErDyhP2MXGGy60sm2hz84'; // Just the folder ID from the URL

const PORT = process.env.PORT || 3000; // Port
const app = express();

/**
 * Initialize Google Drive API with API Key
 */
const drive = google.drive({
  version: 'v3',
  auth: 'AIzaSyB4xcno460ZzujbuDQ5h2bkklbChXx2AFo', // API Key
});

/**
 * Fetch the most recent file in the specified Google Drive folder.
 */
async function getMostRecentFileId() { // Get the most recent file in the folder
  try {
    const res = await drive.files.list({
      q: `'${FOLDER_ID}' in parents and mimeType='text/plain'`,
      orderBy: 'modifiedTime desc',
      pageSize: 1,
      fields: 'files(id, name)',
    });

    const files = res.data.files; // Get the files list in the folder
    if (!files || files.length === 0) {
      throw new Error('No files found in the folder.');
    }

    // Return the most recent file's ID and name
    return files[0]; // Most recent file
  } catch (err) {
    throw new Error(`Error retrieving files: ${err.message}`);
  }
}

/**
 * Fetch and reverse the contents of the most recent file.
 */
async function fetchReversedFileContents() {
  try {
    const mostRecentFile = await getMostRecentFileId();

    // Fetch the file's content
    const fileResponse = await fetch(
      `https://www.googleapis.com/drive/v3/files/${mostRecentFile.id}?alt=media&key=AIzaSyB4xcno460ZzujbuDQ5h2bkklbChXx2AFo` // API Key
    );
    if (!fileResponse.ok) {
      throw new Error(`File fetch failed with status ${fileResponse.status}`);
    }

    const fileContents = await fileResponse.text();

    // Split and reverse lines
    const lines = fileContents.split('\n').reverse();
    return { fileName: mostRecentFile.name, reversedContents: lines.join('\n') };
  } catch (err) {
    throw new Error(`Error processing file: ${err.message}`);
  }
}

/**
 * GET / : Displays an HTML page with reversed log lines.
 */
app.get('/', async (req, res) => {
  try {
    const { fileName, reversedContents } = await fetchReversedFileContents();

    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8" />
        <title>Reversed Log Viewer</title>
      </head>
      <body>
        <h1>Reversed Log Viewer</h1>
        <p>Most Recent File: ${fileName}</p>
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
 * GET /raw : Returns just the reversed text (newest at top).
 */
app.get('/raw', async (req, res) => {
  try {
    const { reversedContents } = await fetchReversedFileContents();
    res.type('text/plain').send(reversedContents);
  } catch (err) {
    console.error(err);
    res.status(500).send(`Error: ${err.message}`);
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

