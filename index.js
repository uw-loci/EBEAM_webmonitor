import Fastify from 'fastify';
import { google } from 'googleapis';
import { promises as fs } from 'fs';
import path from 'path';
import https from 'https';
import dotenv from 'dotenv';

// Configure environment variables
dotenv.config();

const FOLDER_ID = process.env.FOLDER_ID;
const API_KEY = process.env.API_KEY;
const PORT = process.env.PORT || 3000;
const REVERSED_FILE_PATH = path.join(__dirname, 'reversed.txt');
const INACTIVE_THRESHOLD = 15 * 60 * 1000; // 15 minutes in milliseconds

// Initialize Fastify
const fastify = Fastify({
  logger: true
});

// Initialize Google Drive API
const drive = google.drive({ version: 'v3', auth: API_KEY });

// State variables
let lastModifiedTime = null;
let logFileName = null;
let experimentRunning = false;

/**
 * Fetch the most recent file from Google Drive.
 */
const getMostRecentFile = async () => {
  try {
    const res = await drive.files.list({
      q: `'${FOLDER_ID}' in parents and mimeType='text/plain'`,
      orderBy: 'modifiedTime desc',
      pageSize: 1,
      fields: 'files(id, name, modifiedTime)',
    });

    const files = res.data.files;
    if (!files?.length) {
      throw new Error('No files found in the folder.');
    }

    return files[0];
  } catch (err) {
    fastify.log.error(`Google Drive API Error: ${err.message}`);
    return null;
  }
};

/**
 * Fetches file contents from Google Drive using streaming
 * @param {string} fileId - The Google Drive file ID
 * @returns {Promise<string[]>} Array of lines from the file
 */
const fetchFileContents = async (fileId) => {
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
      fastify.log.error(`Retry ${4 - retries}: ${err.message}`);
      retries--;
      if (retries === 0) throw err;
      await new Promise(res => setTimeout(res, 2000));
    }
  }
};

/**
 * Fetches and updates the log file if there's a new version
 * @returns {Promise<boolean>} True if file was updated, false otherwise
 */
const fetchAndUpdateFile = async () => {
  try {
    const mostRecentFile = await getMostRecentFile();
    if (!mostRecentFile) {
      experimentRunning = false;
      return false;
    }

    const fileModifiedTime = new Date(mostRecentFile.modifiedTime).getTime();
    
    // Check if file hasn't been modified in last 15 minutes
    // Uncomment for production use
    /*
    if (Date.now() - fileModifiedTime > INACTIVE_THRESHOLD) {
      experimentRunning = false;
      fastify.log.info("Experiment not running - no updates in 15 minutes");
      return false;
    }
    */

    if (lastModifiedTime && lastModifiedTime === mostRecentFile.modifiedTime) {
      fastify.log.info("No new updates. Using cached file.");
      experimentRunning = true;
      return false;
    }

    fastify.log.info("Fetching new file...");
    
    const lines = await fetchFileContents(mostRecentFile.id);
    // Write reversed lines in one operation
    await fs.writeFile(REVERSED_FILE_PATH, lines.reverse().join('\n'));
    
    lastModifiedTime = mostRecentFile.modifiedTime;
    logFileName = mostRecentFile.name;
    experimentRunning = true;

    fastify.log.info("File updated successfully.");
    return true;
  } catch (err) {
    fastify.log.error(`Error processing file: ${err.message}`);
    experimentRunning = false;
    return false;
  }
};

// Route handlers
fastify.get('/', async (request, reply) => {
  if (!experimentRunning) {
    return reply.type('text/html').send(`
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
  }

  let reversedContents = "No data available.";

  try {
    if (fs.existsSync(REVERSED_FILE_PATH)) {
      reversedContents = fs.readFileSync(REVERSED_FILE_PATH, 'utf8');
    }

    return reply.type('text/html').send(`
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
    request.log.error(err);
    throw err;
  }
});

fastify.get('/dashboard', async (request, reply) => {
  return reply.send('Hi; I am Log System Dashboard. I am being built so bare with me until then. (::)');
});

fastify.get('/raw', async (request, reply) => {
  try {
    if (await fs.access(REVERSED_FILE_PATH).then(() => true).catch(() => false)) {
      const contents = await fs.readFile(REVERSED_FILE_PATH, 'utf8');
      return reply.type('text/plain').send(contents);
    }
    return reply.code(404).send("No file found.");
  } catch (err) {
    request.log.error(err);
    throw err;
  }
});

// Initialize file fetching
const start = async () => {
  try {
    await fetchAndUpdateFile(); // Initial fetch
    setInterval(fetchAndUpdateFile, 60000); // Check every minute
    
    await fastify.listen({ port: PORT });
    fastify.log.info(`Server running on port ${PORT}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
