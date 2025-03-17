const express = require('express');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const https = require('https');
const lockFile = require('proper-lockfile');


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

    /////uncomment this after the development of the webpage///////
    // 
    // Check if file hasn't been modified in last 15 minutes
    // KEEP THIS FOR FUTURE NEED FOR AFTER DEVELOPMENT FINISHED
    // if (currentTime - fileModifiedTime > INACTIVE_THRESHOLD) {
    //   experimentRunning = false;
    //   console.log("Experiment not running - no updates in 15 minutes");
    //   return false;
    // }
    //////////////////////////////////////////////////////////////

    if (lastModifiedTime && lastModifiedTime === mostRecentFile.modifiedTime) {
      console.log("No new updates. Using cached file.");
      experimentRunning = true;
      return false;
    }

    console.log("Fetching new file...");
    let lines = await fetchFileContents(mostRecentFile.id);
    lines.reverse(); // Reverse file contents

    if (!fs.existsSync(REVERSED_FILE_PATH)) {
      fs.writeFileSync(REVERSED_FILE_PATH, '', { flag: 'w' });
    }

    // Acquire a lock before modifying the file
    release = await lockFile.lock(REVERSED_FILE_PATH); //Don't redeclare `release`

    // Create a writable stream
    const writeStream = fs.createWriteStream(REVERSED_FILE_PATH, { flags: 'w' });
    let hasError = false; // Track if an error occurs

    // FIXED: Ensure function waits for the stream to finish
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

// /**
//  * GET / : Serve the HTML page with reversed log lines.
//  */
// app.get('/', async (req, res) => {
//   try {
//     if (!experimentRunning) {
//       res.send(`
//         <!DOCTYPE html>
//         <html>
//         <head>
//           <meta charset="utf-8" />
//           <title>Reversed Log Viewer</title>
//           <script type="text/javascript">
//             setTimeout(function() {
//               location.reload();
//             }, 60000);
//           </script>
//         </head>
//         <body>
//           <h1>Experiment Status</h1>
//           <p style="font-size: 1.5em; color: red;">Experiment is not running.</p>
//         </body>
//         </html>
//       `);
//       return;
//     }

//     let reversedContents = "No data available.";

//     // Fetch the latest file in the background
//     // fetchAndUpdateFile();

//     // Serve cached file if available
//     if (fs.existsSync(REVERSED_FILE_PATH)) {
//       reversedContents = fs.readFileSync(REVERSED_FILE_PATH, 'utf8');
//     }

//     // HTML Response
//     res.send(`
//       <!DOCTYPE html>
//       <html>
//       <head>
//         <meta charset="utf-8" />
//         <title>Reversed Log Viewer</title>
//         <script type="text/javascript">
//           setTimeout(function() {
//             location.reload();
//           }, 60000);
//         </script>
//       </head>
//       <body>
//         <h1>Reversed Log Viewer</h1>
//         <p>Most Recent File: ${logFileName}</p>
//         <p>File Last Modified: ${lastModifiedTime}</p>
//         <p>Last Updated: ${new Date().toLocaleString('en-US', {
//             timeZone: 'America/Chicago',
//             weekday: 'long',
//             year: 'numeric',
//             month: 'long',
//             day: 'numeric',
//             hour: '2-digit',
//             minute: '2-digit',
//             second: '2-digit',
//             hour12: true
//           })}
//         </p>
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

    // Truncate very large content for debugging
    const displayContent = reversedContents.length > 1000 
      ? reversedContents.substring(0, 1000) + "... (content truncated for display)"
      : reversedContents;

    // HTML Response with extensive debugging
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

          /* Debug panel */
          .debug-panel {
            background: rgba(255, 255, 0, 0.2);
            border: 1px solid yellow;
            color: white;
            padding: 10px;
            margin: 15px 0;
            border-radius: 8px;
            text-align: left;
            font-family: monospace;
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

          /* Refresh Button */
          .btn-load {
            background: rgba(0, 255, 255, 0.5);
            color: white;
            border: 1px solid rgba(0, 255, 255, 0.8);
            border-radius: 8px;
            padding: 12px 25px;
            font-size: 1.1em;
            transition: background 0.3s ease, box-shadow 0.3s ease;
          }
          .btn-load:hover {
            background: rgba(0, 255, 255, 0.8);
            box-shadow: 0px 0px 15px rgba(0, 255, 255, 1);
          }
        </style>
      </head>
      <body>
        <div class="container-fluid mt-4">
          <h2 class="dashboard-title">E-beam Web Monitor</h2>
          <p id="experimentRunning" style="display:none;"></p>
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
                <!-- Debug panel to show what's happening -->
                <div id="debug-panel" class="debug-panel">
                  Debug information will appear here
                </div>
                
                <!-- Button to manually update content -->
                <button id="update-button" class="btn btn-primary mb-3">Update Content</button>
                
                <pre id="reversedtext">Loading text...</pre>
              </div>
            </div>
          </div>
        </div>
        
        <script>
          // Debug helper
          function debugLog(message) {
            const debugPanel = document.getElementById('debug-panel');
            if (debugPanel) {
              debugPanel.innerHTML += "<div>" + message + "</div>";
            }
            console.log(message); // Also log to console
          }
          
          // Direct approach - set content immediately
          (function() {
            try {
              debugLog("🔍 Script loaded and executing");
              
              // Directly set content (no waiting for DOMContentLoaded)
              const directElement = document.getElementById('reversedtext');
              if (directElement) {
                debugLog("✅ Found element directly");
                directElement.textContent = "${displayContent.replace(/"/g, '\\"').replace(/\n/g, '\\n')}";
                debugLog("✅ Set content directly");
              } else {
                debugLog("❌ Element not found directly");
              }
            } catch (err) {
              debugLog("❌ Error in direct execution: " + err.message);
            }
          })();
          
          // Add event listener for update button
          document.getElementById('update-button').addEventListener('click', function() {
            try {
              debugLog("🔘 Update button clicked");
              const element = document.getElementById('reversedtext');
              if (element) {
                element.textContent = "${displayContent.replace(/"/g, '\\"').replace(/\n/g, '\\n')}";
                debugLog("✅ Content updated via button click");
              } else {
                debugLog("❌ Element not found in button handler");
              }
            } catch (err) {
              debugLog("❌ Error in button handler: " + err.message);
            }
          });
          
          // DOMContentLoaded approach
          document.addEventListener('DOMContentLoaded', function() {
            try {
              debugLog("🌐 DOMContentLoaded event fired");
              
              const domElement = document.getElementById('reversedtext');
              if (domElement) {
                debugLog("✅ Found element in DOMContentLoaded");
                domElement.textContent = "${displayContent.replace(/"/g, '\\"').replace(/\n/g, '\\n')}";
                debugLog("✅ Set content in DOMContentLoaded");
              } else {
                debugLog("❌ Element not found in DOMContentLoaded");
              }
              
              // Auto-refresh
              setTimeout(function() {
                debugLog("⏱️ Auto-refresh timer triggered");
                // location.reload(); // Uncomment for production
              }, 60000);
              
              // Show experiment status if needed
              if(!${experimentRunning}) {
                debugLog("⚠️ Experiment not running");
                const contentDiv = document.getElementById('experimentRunning');
                if (contentDiv) {
                  contentDiv.style.display = 'block';
                  contentDiv.style.cssText = 'font-size: 1.5em; color: red;';
                  contentDiv.textContent = 'Experiment is not running';
                  debugLog("✅ Experiment status updated");
                }
              }
            } catch (err) {
              debugLog("❌ Error in DOMContentLoaded: " + err.message);
            }
          });
          
          // Window load approach
          window.onload = function() {
            try {
              debugLog("🏁 Window onload event fired");
              
              const windowElement = document.getElementById('reversedtext');
              if (windowElement) {
                debugLog("✅ Found element in window.onload");
                windowElement.textContent = "${displayContent.replace(/"/g, '\\"').replace(/\n/g, '\\n')}";
                debugLog("✅ Set content in window.onload");
              } else {
                debugLog("❌ Element not found in window.onload");
              }
            } catch (err) {
              debugLog("❌ Error in window.onload: " + err.message);
            }
          };
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
