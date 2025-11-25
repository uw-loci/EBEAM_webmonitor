/* global process */
// Configuration file
// Copy this to config.local.js and fill in your values

const os = require("os");
const path = require("path");

function expandPath(filePath) {
  if (filePath.startsWith("~")) {
    return path.join(os.homedir(), filePath.slice(1));
  }
  return filePath;
}

module.exports = {
  // Google Drive File ID of the log file
  googleDriveFileId: process.env.GOOGLE_DRIVE_FILE_ID || '113U8T4O7fN2onSeOTudNTQCxZ7g2Xjgd',
  
  // Google Drive API credentials
  // You can use service account credentials or OAuth2
  // For service account, set GOOGLE_APPLICATION_CREDENTIALS environment variable
  // Or provide credentials object here
  credentials: {
    // If using service account JSON file, set GOOGLE_APPLICATION_CREDENTIALS env var
    // Otherwise, you can provide credentials here (not recommended for production)
    GOOGLE_APPLICATION_CREDENTIALS: expandPath("~/ebeam-web-log-poc-a64b5e13f829.json")
  },
  
  // Local file paths
  localLogFile: './data/live_log.txt',
  reversedLogFile: './data/live_log_reversed.txt',
  
  // Update interval in milliseconds (default: 1 minute)
  updateInterval: 60000,
  
  // Server configuration
  port: process.env.PORT || 3000,
  
  // Pagination defaults
  defaultPageSize: 100
};

