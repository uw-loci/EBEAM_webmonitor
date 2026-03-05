const { google } = require('googleapis');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config();

// Validate environment variables
if (!process.env.SIMULATE && (!process.env.FOLDER_ID || !process.env.API_KEY)) {
  console.error("Missing FOLDER_ID or API_KEY in environment variables. Exiting...");
  process.exit(1);
}

if (!process.env.SUPABASE_API_URL || !process.env.SUPABASE_API_KEY) {
  console.error("Missing SUPABASE_API_URL or SUPABASE_API_KEY in environment variables. Exiting...");
  process.exit(1);
}

const FOLDER_ID = process.env.FOLDER_ID;
const API_KEY = process.env.API_KEY;
const PORT = process.env.PORT || 3000;
const REVERSED_FILE_PATH = path.join(__dirname, 'reversed.txt');
const INACTIVE_THRESHOLD = 15 * 60 * 1000; // 15 min in ms

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_API_URL,
  process.env.SUPABASE_API_KEY
);

// Initialize Google Drive API
const drive = process.env.SIMULATE ? null : google.drive({ version: 'v3', auth: API_KEY });

module.exports = {
  supabase,
  drive,
  FOLDER_ID,
  API_KEY,
  PORT,
  REVERSED_FILE_PATH,
  INACTIVE_THRESHOLD,
};
