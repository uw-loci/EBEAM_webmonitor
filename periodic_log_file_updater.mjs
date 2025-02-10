import express from 'express';
import fetch from 'node-fetch';
import fs from 'fs';

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