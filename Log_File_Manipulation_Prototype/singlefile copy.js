/* global process */
// Standalone sync script - core logic extracted from server.js

const fs = require('fs-extra');
const config = require('./config.js');
const DriveSync = require('./driveSync.js');
const LogReverser = require('./logReverser.js');

// Initialize components
const driveSync = new DriveSync(config);
const logReverser = new LogReverser(config);

// Sync state
let syncInProgress = false;
let lastSyncTime = null;

/**
 * Perform a complete sync cycle: download new data and reverse it
 */
async function performSync() {
  if (syncInProgress) {
    console.log('[Sync] Sync already in progress, skipping...');
    return;
  }
  
  syncInProgress = true;
  const startTime = Date.now();
  
  try {
    console.log('[Sync] Starting sync cycle...');
    
    // Step 1: Download incremental changes
    const downloadStartTime = Date.now();
    const syncResult = await driveSync.syncIncremental();
    const downloadDuration = Date.now() - downloadStartTime;
    console.log(`[Sync] Download step completed in ${downloadDuration}ms`);
    
    // Step 2: If new data was downloaded, reverse and prepend it
    if (syncResult.downloaded && syncResult.newChunk) {
      console.log(`[Sync] New data downloaded (${syncResult.bytesDownloaded} bytes), starting reversal...`);
      const reverseStartTime = Date.now();
      await logReverser.reverseAndPrepend(syncResult.newChunk);
      const reverseDuration = Date.now() - reverseStartTime;
      console.log(`[Sync] Reversal step completed in ${reverseDuration}ms`);
    } else {
      console.log('[Sync] No new data to process');
    }
    
    lastSyncTime = new Date().toISOString();
    const duration = Date.now() - startTime;
    console.log(`[Sync] Sync cycle completed successfully in ${duration}ms`);
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error('[Sync] Sync cycle error:', {
      message: error.message,
      code: error.code,
      duration: duration,
      stack: error.stack
    });
    throw error;
  } finally {
    syncInProgress = false;
    console.log('[Sync] Sync cycle finished, syncInProgress set to false');
  }
}

/**
 * Initialize the system and perform sync
 */
async function initialize() {
  const initStartTime = Date.now();
  try {
    console.log('[Sync] ========================================');
    console.log('[Sync] Initializing EBEAM Log Monitor...');
    console.log('[Sync] ========================================');
    console.log('[Sync] Configuration:');
    console.log(`[Sync]   - File ID: ${config.googleDriveFileId}`);
    console.log(`[Sync]   - Local Log: ${config.localLogFile}`);
    console.log(`[Sync]   - Reversed Log: ${config.reversedLogFile}`);
    console.log('[Sync] ========================================');
    
    // Initialize Google Drive API
    const driveInitStartTime = Date.now();
    await driveSync.initialize();
    const driveInitDuration = Date.now() - driveInitStartTime;
    console.log(`[Sync] Google Drive API initialization completed in ${driveInitDuration}ms`);
    
    // Perform initial sync
    console.log('[Sync] Performing sync...');
    const initialSyncStartTime = Date.now();
    await performSync();
    const initialSyncDuration = Date.now() - initialSyncStartTime;
    console.log(`[Sync] Sync completed in ${initialSyncDuration}ms`);
    
    const initDuration = Date.now() - initStartTime;
    console.log(`[Sync] Initialization completed successfully in ${initDuration}ms`);
  } catch (error) {
    const initDuration = Date.now() - initStartTime;
    console.error('[Sync] Initialization error:', {
      message: error.message,
      code: error.code,
      duration: initDuration,
      stack: error.stack
    });
    throw error;
  }
}

// Run if executed directly
if (require.main === module) {
  initialize()
    .then(() => {
      console.log('[Sync] Script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('[Sync] Script failed:', error);
      process.exit(1);
    });
}

module.exports = {
  performSync,
  initialize,
  driveSync,
  logReverser
};

