
const express = require('express');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const https = require('https');
const lockFile = require('proper-lockfile');
const { PassThrough } = require('stream');

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
  let release; // Declare lock variable before try block

  try {
    const mostRecentFile = await getMostRecentFile();
    if (!mostRecentFile) {
      experimentRunning = false;
      return false;
    }

    const fileModifiedTime = new Date(mostRecentFile.modifiedTime).getTime();
    const currentTime = new Date().getTime();

    // Check if file hasn't been modified in last 15 minutes
    if (currentTime - fileModifiedTime > INACTIVE_THRESHOLD) {
      experimentRunning = false;
      
      if (!fs.existsSync(REVERSED_FILE_PATH)) { console.log("Experiment not running but passing through"); // just pass through for once
      } else {
      console.log("Experiment not running - no updates in 15 minutes");
      return false;
      }
    }
    if (lastModifiedTime && lastModifiedTime === mostRecentFile.modifiedTime) {
      console.log("No new updates. Using cached file.");
      experimentRunning = true;
      return false;
    }

    // Making sure there is reverse.txt on server
    if (!fs.existsSync(REVERSED_FILE_PATH)) { 
      fs.writeFileSync(REVERSED_FILE_PATH, '', { flag: 'w' });
    }

    console.log("Fetching new file...");
    let lines = await fetchFileContents(mostRecentFile.id);
    lines.reverse(); // Reverse file contents

    // Acquire a lock before modifying the file
    release = await lockFile.lock(REVERSED_FILE_PATH);

    // Create a writable stream
    const writeStream = fs.createWriteStream(REVERSED_FILE_PATH, { flags: 'w' });
    let hasError = false; // Track if an error occurs

    // Ensure function waits for the stream to finish
    return await new Promise((resolve, reject) => { 
      let i = 0;

      function writeNext() {
        if (hasError) return; // Stop writing if an error occurred

        let ok = true;
        while (i < lines.length && ok) {
          ok = writeStream.write(lines[i] + '\n');
          i++;
        }
        if (i < lines.length) {
          writeStream.once('drain', writeNext); // Wait for stream to be ready
        } else {
          writeStream.end(); // Close stream after writing everything
        }
      }

      writeNext(); // Start writing

      // Handle successful completion
      writeStream.on('finish', async () => {
        console.log('Finished writing reversed lines.');
        lastModifiedTime = mostRecentFile.modifiedTime;
        logFileName = mostRecentFile.name;
        experimentRunning = true;
        
        if (release) await release(); // Release lock only after writing completes
        resolve(true);
      });

      // Handle errors
      writeStream.on('error', async (err) => {
        console.error('Error writing file:', err);
        hasError = true;
        
        if (release) await release(); // Ensure lock is released even on error
        reject(false);
      });
    });

  } catch (err) {
    console.error(`Error processing file: ${err.message}`);
    experimentRunning = false;
    return false;
  }
  //  finally {
  //   if (release) {
  //     await release(); // Ensure lock is always released
  //   }
  // }
}

// Schedule updates
fetchAndUpdateFile(); // Initial fetch
setInterval(fetchAndUpdateFile, 60000); // Check every minute

/**
 * GET/: Implement the log file dashboard to this end point.
 */
app.get('/', async (req, res) => {
  try {
    let reversedContents = "No data available.";

    // Serve cached file if available
    if (fs.existsSync(REVERSED_FILE_PATH)) {
      reversedContents = fs.readFileSync(REVERSED_FILE_PATH, 'utf8');
    }

    // Split content into lines for preview
    const contentLines = reversedContents.split('\n');
    const previewContent = contentLines.slice(0, 20).join('\n');
    
    // HTML Response with preview toggle functionality
    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Log System Dashboard</title>
        <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
        <style>
          /* Futuristic Animated Background */
          body {
            font-family: Arial, sans-serif;
            text-align: center;
            background: linear-gradient(-45deg, #001f3f, #003366, #005a9e);
            background-size: 400% 400%;
            animation: gradientMove 12s ease infinite;
            color: white;
            padding: 20px;
            margin: 0;
          }
          @keyframes gradientMove {
            0% { background-position: 0% 50%; }
            50% { background-position: 100% 50%; }
            100% { background-position: 0% 50%; }
          }

          /* Glassmorphism Effect */
          .glass-container {
            background: rgba(255, 255, 255, 0.08);
            backdrop-filter: blur(20px);
            -webkit-backdrop-filter: blur(20px);
            padding: 30px;
            border-radius: 15px;
            box-shadow: 0px 4px 25px rgba(255, 255, 255, 0.15);
            color: white;
            width: 100%;
            margin: 0;
          }

          /* Dashboard Title with Neon Glow */
          @keyframes flicker {
            0% { opacity: 1; text-shadow: 0px 0px 10px rgba(255, 255, 255, 0.6); }
            50% { opacity: 0.9; text-shadow: 0px 0px 15px rgba(255, 255, 255, 0.5); }
            100% { opacity: 1; text-shadow: 0px 0px 10px rgba(255, 255, 255, 0.6); }
          }
          .dashboard-title {
            font-size: 3.5em;
            font-weight: 900;
            color: #d6eaff;
            text-shadow: 0px 0px 12px rgba(214, 234, 255, 0.6),
                        0px 0px 20px rgba(214, 234, 255, 0.4);
          }
          .dashboard-title::after {
            content: "";
            display: block;
            width: 60%;
            height: 5px;
            background: rgba(0, 255, 255, 0.8);
            margin: 10px auto;
            box-shadow: 0px 0px 15px rgba(0, 255, 255, 1);
            border-radius: 10px;
          }

          /* Subtitle */
          .dashboard-subtitle {
            font-size: 1.2em;
            font-weight: normal;
            margin-bottom: 25px;
            opacity: 0.9;
            color: rgba(255, 255, 255, 0.8);
          }

          /* Neon Glow Cards */
          .card-container {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 20px;
            margin-bottom: 30px;
            padding: 20px;
            justify-content: center;
          }
          .card {
            background: rgba(0, 0, 0, 0.8);
            color: white;
            padding: 20px;
            border-radius: 12px;
            box-shadow: 0px 0px 15px rgba(0, 255, 255, 0.7);
            transition: transform 0.3s ease, box-shadow 0.3s ease;
            text-align: center;
            font-weight: bold;
          }
          .card:hover {
            transform: translateY(-5px);
            box-shadow: 0px 0px 25px rgba(0, 255, 255, 1);
          }

          /* Log Viewer with Higher Contrast */
          pre {
            white-space: pre-wrap;
            font-family: 'Courier New', monospace;
            text-align: left;
            background: rgba(10, 10, 10, 0.85);
            color: #ffffff;
            padding: 20px;
            border-radius: 12px;
            max-height: 600px;
            overflow-y: auto;
            font-size: 1.2em;
            box-shadow: 0px 0px 15px rgba(0, 255, 255, 0.3);
            border: 1px solid rgba(0, 255, 255, 0.5);
          }

          /* Content sections */
          .content-section {
            display: none; /* Hide by default */
          }
          
          .content-section.active {
            display: block; /* Show when active */
          }

          /* Toggle Button */
          .btn-toggle {
            background: rgba(0, 255, 255, 0.5);
            color: white;
            border: 1px solid rgba(0, 255, 255, 0.8);
            border-radius: 8px;
            padding: 12px 25px;
            font-size: 1.1em;
            margin-bottom: 20px;
            transition: background 0.3s ease, box-shadow 0.3s ease;
          }
          .btn-toggle:hover {
            background: rgba(0, 255, 255, 0.8);
            box-shadow: 0px 0px 15px rgba(0, 255, 255, 1);
          }

          /* Responsive Layout */
          @media (max-width: 992px) {
            .card-container {
              grid-template-columns: repeat(2, 1fr);
            }
          }
          @media (max-width: 600px) {
            .card-container {
              grid-template-columns: repeat(1, 1fr);
            }
          }
          .fixed-top-right {
            position: absolute;
            top: 20px;
            right: 25px;
            padding: 10px 20px;
            font-size: 1.3em;
            background-color: rgba(255, 0, 0, 0.2);
            border: 2px solid red;
            border-radius: 8px;
            box-shadow: 0 0 20px red;
            text-shadow: 0 0 15px red;
            color: white;
            font-weight: bold;
            animation: neonBlink 8s infinite alternate;
            z-index: 9999; /* Always on top */
          }

          @keyframes neonBlink {
            0% { opacity: 1; text-shadow: 0 0 10px red; }
            50% { opacity: 0.8; text-shadow: 0 0 5px red; }
            100% { opacity: 1; text-shadow: 0 0 10px red; }
          }

          /* Responsive adjustments for mobile */
          @media (max-width: 768px) {
            .fixed-top-right {
              position: static; /* Change from fixed to static position */
              display: block;
              margin: 10px auto 20px;
              width: fit-content;
              font-size: 1.1em;
              padding: 8px 16px;
            }
            
            /* Adjust dashboard title spacing on mobile */
            .dashboard-title {
              margin-top: 10px;
              font-size: 3.0em;
            }
          }
        </style>
      </head>
      <body>
        <div class="container-fluid mt-4">
          ${!experimentRunning ? `
            <div class="neon-warning fixed-top-right">
              Experiment is not running
            </div>
          ` : ''}
          <h2 class="dashboard-title">E-beam Web Monitor</h2>
          <p class="dashboard-subtitle">
            <strong>File Last Modified:</strong> ${new Date(lastModifiedTime).toLocaleString("en-US", { timeZone: "America/Chicago" })} | 
            <strong>Last Updated:</strong> ${new Date().toLocaleString("en-US", { timeZone: "America/Chicago" })}
          </p>

          <div class="card-container">
            <div class="card">Hi, I am Card 1</div>
            <div class="card">Hi, I am Card 2</div>
            <div class="card">Hi, I am Card 3</div>
            <div class="card">Hi, I am Card 4</div>
            <div class="card">Hi, I am Card 5</div>
            <div class="card">Hi, I am Card 6</div>
            <div class="card">Hi, I am Card 7</div>
            <div class="card">Hi, I am Card 8</div>
          </div>

          <div class="row justify-content-center">
            <div class="col-lg-12">
              <div class="glass-container p-4">
                <!-- Toggle button -->
                <button id="toggleButton" class="btn-toggle">Show Full Log</button>
                
                <!-- Content sections -->
                <div id="previewContent" class="content-section active">
                  <pre>${previewContent}</pre>
                  <p class="text-center text-info mt-2">Showing first 20 lines. Click the button above to see the full log.</p>
                </div>
                
                <div id="fullContent" class="content-section">
                  <pre>${reversedContents}</pre>
                  <p class="text-center text-info mt-2">Showing full log. Click the button above to see the preview.</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Simple toggling script -->
        <script>
          // Auto-refresh
          setTimeout(function() {
            location.reload();
          }, 60000);
          
          // Get elements
          const toggleButton = document.getElementById('toggleButton');
          const previewSection = document.getElementById('previewContent');
          const fullSection = document.getElementById('fullContent');
          
          // Initial state
          let showingFull = false;
          
          // Toggle function
          function toggleContent() {
            if (showingFull) {
              // Switch to preview
              previewSection.className = 'content-section active';
              fullSection.className = 'content-section';
              toggleButton.textContent = 'Show Full Log';
            } else {
              // Switch to full
              previewSection.className = 'content-section';
              fullSection.className = 'content-section active';
              toggleButton.textContent = 'Show Preview';
            }
            
            // Toggle state
            showingFull = !showingFull;
          }
          
          // Add click handler
          toggleButton.onclick = toggleContent;
        </script>
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
