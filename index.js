const express = require('express');
const fetch = require('node-fetch');

// Use your direct-download URL from Google Drive:
const FILE_URL = 'https://drive.google.com/uc?export=download&id=1-EUNY-noM9UhiIdNVP5Zu4O46-UkOY0u';

const PORT = process.env.PORT || 3000;
const app = express();

/**
 * Helper function to fetch the Drive file and reverse its line order.
 */
async function fetchReversedFileContents() {
  // Fetch the text from Google Drive
  const response = await fetch(FILE_URL);
  if (!response.ok) {
    throw new Error(`Drive fetch failed with status ${response.status}`);
  }

  // Original file contents (oldest line first)
  const fileContents = await response.text();

  // Split into lines
  let lines = fileContents.split('\n');

  // Reverse so the newest lines appear at the top
  lines.reverse();

  // Re-join into a single string
  const reversedContents = lines.join('\n');
  return reversedContents;
}

/**
 * GET / : Displays an HTML page with reversed log lines (newest at top).
 */
app.get('/', async (req, res) => {
  try {
    const reversedLog = await fetchReversedFileContents();

    // Simple HTML with a <pre> block to show reversed logs
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8" />
        <title>Reversed Log Viewer</title>
      </head>
      <body>
        <h1>Experiment Log - Newest Entries on Top</h1>
        <p>File URL: ${FILE_URL}</p>
        <pre style="white-space: pre-wrap; font-family: monospace;">
${reversedLog}
        </pre>
      </body>
      </html>
    `);
  } catch (err) {
    console.error(err);
    res.status(500).send(`Error fetching or processing file: ${err.message}`);
  }
});

/**
 * GET /raw : Returns just the reversed text (newest at top), no HTML.
 */
app.get('/raw', async (req, res) => {
  try {
    const reversedLog = await fetchReversedFileContents();
    res.type('text/plain').send(reversedLog);
  } catch (err) {
    console.error(err);
    res.status(500).send(`Error fetching or processing file: ${err.message}`);
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
