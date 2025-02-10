// const express = require('express');
// const fetch = require('node-fetch');
// const { google } = require('googleapis'); // Google Drive API

// // Public folder ID
// const FOLDER_ID = '1-1PKnmvtWe6ErDyhP2MXGGy60sm2hz84'; // Just the folder ID from the URL

// const PORT = process.env.PORT || 3000; // Port
// const app = express();

// /**
//  * Initialize Google Drive API with API Key
//  */
// const drive = google.drive({
//   version: 'v3',
//   auth: 'AIzaSyDxLmrOSK6DZ8Njc-NPnndynw6Wuf7vC2w', // API Key
// });

// /**
//  * Fetch the most recent file in the specified Google Drive folder.
//  */
// async function getMostRecentFileId() { // Get the most recent file in the folder
//   try {
//     const res = await drive.files.list({
//       q: `'${FOLDER_ID}' in parents and mimeType='text/plain'`,
//       orderBy: 'modifiedTime desc',
//       pageSize: 1,
//       fields: 'files(id, name)',
//     });

//     const files = res.data.files; // Get the files list in the folder
//     if (!files || files.length === 0) {
//       throw new Error('No files found in the folder.');
//     }

//     // Return the most recent file's ID and name
//     return files[0]; // Most recent file
//   } catch (err) {
//     throw new Error(`Error retrieving files: ${err.message}`);
//   }
// }

// /**
//  * Fetch and reverse the contents of the most recent file.
//  */
// async function fetchReversedFileContents() {
//   try {
//     const mostRecentFile = await getMostRecentFileId();

//     // Fetch the file's content
//     const fileResponse = await fetch(
//       `https://www.googleapis.com/drive/v3/files/${mostRecentFile.id}?alt=media&key=AIzaSyDxLmrOSK6DZ8Njc-NPnndynw6Wuf7vC2w` // API Key
//     );
//     if (!fileResponse.ok) {
//       throw new Error(`File fetch failed with status ${fileResponse.status}`);
//     }

//     const fileContents = await fileResponse.text();

//     // Split and reverse lines
//     const lines = fileContents.split('\n').reverse();
//     return { fileName: mostRecentFile.name, reversedContents: lines.join('\n') };
//   } catch (err) {
//     throw new Error(`Error processing file: ${err.message}`);
//   }
// }

// /**
//  * GET / : Displays an HTML page with reversed log lines.
//  */
// app.get('/', async (req, res) => {
//   try {
//     const { fileName, reversedContents } = await fetchReversedFileContents();

//     res.send(`
//       <!DOCTYPE html>
//       <html>
//       <head>
//         <meta charset="utf-8" />
//         <title>Reversed Log Viewer</title>
//       </head>
//       <body>
//         <h1>Reversed Log Viewer</h1>
//         <p>Most Recent File: ${fileName}</p>
//         <pre style="white-space: pre-wrap; font-family: monospace;">
// ${reversedContents}
//         </pre>
//       </body>
//       </html>
//     `);
//   } catch (err) {
//     console.error(err);
//     res.status(500).send(`Error: ${err.message}`);
//   }
// });

// /**
//  * GET /raw : Returns just the reversed text (newest at top).
//  */
// app.get('/raw', async (req, res) => {
//   try {
//     const { reversedContents } = await fetchReversedFileContents();
//     res.type('text/plain').send(reversedContents);
//   } catch (err) {
//     console.error(err);
//     res.status(500).send(`Error: ${err.message}`);
//   }
// });

// // Start the server
// app.listen(PORT, () => {
//   console.log(`Server running on port ${PORT}`);
// });




const express = require('express');
const fetch = require('node-fetch');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// We'll store the *latest* data in a file or an in-memory variable.
const LOCAL_LOG_FILE = 'log_file.txt';

// 1. Define the function that fetches from Google Drive and caches data:
async function updateLocalLogFile() {
  try {
    console.log('Fetching from Google Drive...');
    const response = await fetch("https://docs.google.com/document/d/18aY0E2KcBNw4XVbaV3tekjj6B1f6jyK84UrfT0Lx7AU/export?format=txt");
    if (!response.ok) {
      throw new Error(`Failed to fetch file: ${response.statusText}`);
    }

    const content = await response.text();
    const reversed = content.split('\n').reverse().join('\n');
    fs.writeFileSync(LOCAL_LOG_FILE, reversed, 'utf8');
    console.log('Updated local log file');
  } catch (err) {
    console.error('Error updating local log file:', err);
  }
}

// 2. Immediately call it once on server startup:
updateLocalLogFile();

// 3. Schedule it to run once a minute (60,000 ms):
setInterval(updateLocalLogFile, 60_000);

// 4. In your route, read the local file and respond:
app.get('/', (req, res) => {
  let content = 'No data yet.';
  try {
    content = fs.readFileSync(LOCAL_LOG_FILE, 'utf8');
  } catch (e) {
    console.error('Error reading local log file:', e.message);
  }

  // Reverse the lines if desired:
  // const reversed = content.split('\n').reverse().join('\n');

  res.send(`
    <html>
      <head><title>Log Viewer</title></head>
      <body>
        <h1>Latest Log (Reversed)</h1>
        <pre>${content}</pre>
      </body>
    </html>
  `);
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});