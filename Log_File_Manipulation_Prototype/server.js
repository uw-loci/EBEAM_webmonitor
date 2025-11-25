/* global process */
/* global __dirname */
// In CommonJS, __dirname and __filename are available directly
console.error('[Server] ========================================');
console.error('[Server] SERVER STARTING');
console.error('[Server] ========================================');
console.error(`[Server] Node version: ${process.version}`);
console.error(`[Server] Process ID: ${process.pid}`);
console.error(`[Server] Working directory: ${process.cwd()}`);
console.error('[Server] Loading modules...');

const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const os = require('os');

console.error('[Server] Core modules would be imported here');

console.error('[Server] Loading config...');
const config = require('./config.js');
console.error('[Server] Config loaded');

console.error('[Server] Loading DriveSync...');
const DriveSync = require('./driveSync.js');
console.error('[Server] DriveSync loaded');

console.error('[Server] Loading LogReverser...');
const LogReverser = require('./logReverser.js');
console.error('[Server] LogReverser loaded');

console.error('[Server] All modules loaded successfully!');

const app = express();
const driveSync = new DriveSync(config);
const logReverser = new LogReverser(config);

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Diagnostic endpoint to test Google Drive connectivity
app.get('/api/test-drive', async (req, res) => {
  const results = {
    timestamp: new Date().toISOString(),
    tests: [],
    success: false
  };

  try {
    // Test 1: Check if credentials are set (priority: config.js, then env var)
    let credsPath = null;
    let credsSource = 'none';
    
    if (config.credentials && config.credentials.GOOGLE_APPLICATION_CREDENTIALS) {
      credsPath = config.credentials.GOOGLE_APPLICATION_CREDENTIALS;
      credsSource = 'config.js';
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      credsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
      credsSource = 'environment variable';
    }
    
    results.tests.push({
      name: 'Credentials Source',
      status: credsPath ? 'found' : 'missing',
      source: credsSource,
      value: credsPath || 'Not set',
      passed: !!credsPath
    });

    // Test 2: Check if credentials file exists
    if (credsPath) {
      // Expand ~ to home directory if present
      let expandedPath = credsPath;
      if (credsPath.startsWith('~')) {
        expandedPath = credsPath.replace('~', os.homedir());
      }
      
      const exists = await fs.pathExists(expandedPath);
      results.tests.push({
        name: 'Credentials File Exists',
        status: exists ? 'found' : 'not found',
        originalPath: credsPath,
        expandedPath: expandedPath,
        passed: exists
      });
    }

    // Test 3: Check if DriveSync is initialized
    results.tests.push({
      name: 'DriveSync Initialized',
      status: driveSync.initialized ? 'yes' : 'no',
      passed: driveSync.initialized
    });

    // Test 4: Try to initialize if not already initialized
    if (!driveSync.initialized) {
      try {
        console.log('[Server] Attempting to initialize DriveSync for test...');
        await driveSync.initialize();
        results.tests.push({
          name: 'DriveSync Initialization',
          status: 'success',
          passed: true
        });
      } catch (initError) {
        results.tests.push({
          name: 'DriveSync Initialization',
          status: 'failed',
          error: initError.message,
          stack: initError.stack,
          passed: false
        });
      }
    }

    // Test 5: Try to get remote file size
    if (driveSync.initialized) {
      try {
        console.log('[Server] Attempting to get remote file size for test...');
        const remoteSize = await driveSync.getRemoteFileSize();
        results.tests.push({
          name: 'Get Remote File Size',
          status: 'success',
          fileSize: remoteSize,
          fileId: config.googleDriveFileId,
          passed: true
        });
        results.success = true;
      } catch (sizeError) {
        results.tests.push({
          name: 'Get Remote File Size',
          status: 'failed',
          error: sizeError.message,
          fileId: config.googleDriveFileId,
          passed: false
        });
      }
    }

    // Test 6: Check local file status
    try {
      const localSize = await driveSync.getLocalFileSize(config.localLogFile);
      results.tests.push({
        name: 'Local Log File',
        status: localSize > 0 ? 'exists' : 'empty',
        size: localSize,
        path: config.localLogFile,
        passed: true
      });
    } catch (localError) {
      results.tests.push({
        name: 'Local Log File',
        status: 'not found',
        path: config.localLogFile,
        error: localError.message,
        passed: false
      });
    }

    res.json(results);
  } catch (error) {
    console.error('[Server] Error in test-drive endpoint:', error);
    results.tests.push({
      name: 'Test Endpoint Error',
      status: 'failed',
      error: error.message,
      stack: error.stack,
      passed: false
    });
    res.status(500).json(results);
  }
});

// Get paginated log lines
app.get('/api/logs', async (req, res) => {
  const requestStartTime = Date.now();
  try {
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.pageSize) || config.defaultPageSize;
    
    console.log(`[Server] GET /api/logs - page=${page}, pageSize=${pageSize}`);
    
    if (page < 1) {
      console.warn(`[Server] Invalid page number: ${page}`);
      return res.status(400).json({ error: 'Page must be >= 1' });
    }
    if (pageSize < 1 || pageSize > 1000) {
      console.warn(`[Server] Invalid page size: ${pageSize}`);
      return res.status(400).json({ error: 'Page size must be between 1 and 1000' });
    }
    
    const result = await logReverser.getPaginatedLines(page, pageSize);
    const duration = Date.now() - requestStartTime;
    console.log(`[Server] GET /api/logs completed in ${duration}ms - ${result.lines.length} lines returned`);
    res.json(result);
  } catch (error) {
    const duration = Date.now() - requestStartTime;
    console.error('[Server] Error fetching logs:', {
      message: error.message,
      code: error.code,
      page: req.query.page,
      pageSize: req.query.pageSize,
      duration: duration,
      stack: error.stack
    });
    res.status(500).json({ error: 'Failed to fetch logs', message: error.message });
  }
});

// Get log statistics
app.get('/api/stats', async (req, res) => {
  const requestStartTime = Date.now();
  try {
    console.log('[Server] GET /api/stats');
    
    let localSize = 0;
    let reversedSize = 0;
    let totalLines = 0;
    
    try {
      localSize = await fs.stat(config.localLogFile).then(s => s.size);
      console.log(`[Server] Local log file size: ${localSize} bytes`);
    } catch (e) {
      if (e.code !== 'ENOENT') {
        console.error('[Server] Error getting local log file stats:', {
          message: e.message,
          code: e.code,
          file: config.localLogFile,
          stack: e.stack
        });
      } else {
        console.log(`[Server] Local log file does not exist: ${config.localLogFile}`);
      }
    }
    
    try {
      const stats = await fs.stat(config.reversedLogFile);
      reversedSize = stats.size;
      console.log(`[Server] Reversed log file size: ${reversedSize} bytes`);
      
      const content = await fs.readFile(config.reversedLogFile, 'utf8');
      totalLines = content.split('\n').filter(l => l.length > 0).length;
      console.log(`[Server] Total lines in reversed log: ${totalLines}`);
    } catch (e) {
      if (e.code !== 'ENOENT') {
        console.error('[Server] Error getting reversed log file stats:', {
          message: e.message,
          code: e.code,
          file: config.reversedLogFile,
          stack: e.stack
        });
      } else {
        console.log(`[Server] Reversed log file does not exist: ${config.reversedLogFile}`);
      }
    }
    
    let remoteSize = 0;
    try {
      remoteSize = await driveSync.getRemoteFileSize();
      console.log(`[Server] Remote file size: ${remoteSize} bytes`);
    } catch (e) {
      console.error('[Server] Error getting remote file size:', {
        message: e.message,
        code: e.code,
        fileId: config.googleDriveFileId,
        stack: e.stack
      });
    }
    
    const duration = Date.now() - requestStartTime;
    console.log(`[Server] GET /api/stats completed in ${duration}ms`);
    
    res.json({
      localSize,
      reversedSize,
      remoteSize,
      totalLines,
      lastSync: lastSyncTime,
      syncInProgress: syncInProgress,
    });
  } catch (error) {
    const duration = Date.now() - requestStartTime;
    console.error('[Server] Error getting stats:', {
      message: error.message,
      code: error.code,
      duration: duration,
      stack: error.stack
    });
    res.status(500).json({ error: 'Failed to get stats', message: error.message });
  }
});

// Manual sync trigger
app.post('/api/sync', async (req, res) => {
  const requestStartTime = Date.now();
  try {
    console.log('[Server] POST /api/sync - Manual sync requested');
    
    if (syncInProgress) {
      console.warn('[Server] Sync already in progress, rejecting manual sync request');
      return res.status(429).json({ error: 'Sync already in progress' });
    }
    
    await performSync();
    const duration = Date.now() - requestStartTime;
    console.log(`[Server] POST /api/sync completed successfully in ${duration}ms`);
    res.json({ success: true, message: 'Sync completed' });
  } catch (error) {
    const duration = Date.now() - requestStartTime;
    console.error('[Server] Manual sync error:', {
      message: error.message,
      code: error.code,
      duration: duration,
      stack: error.stack
    });
    res.status(500).json({ error: 'Sync failed', message: error.message });
  }
});

// Serve frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Sync state
let syncInProgress = false;
let lastSyncTime = null;

/**
 * Perform a complete sync cycle: download new data and reverse it
 */
async function performSync() {
  if (syncInProgress) {
    console.log('[Server] Sync already in progress, skipping...');
    return;
  }
  
  syncInProgress = true;
  const startTime = Date.now();
  
  try {
    console.log('[Server] Starting sync cycle...');
    
    // Step 1: Download incremental changes
    const downloadStartTime = Date.now();
    const syncResult = await driveSync.syncIncremental();
    const downloadDuration = Date.now() - downloadStartTime;
    console.log(`[Server] Download step completed in ${downloadDuration}ms`);
    
    // Step 2: If new data was downloaded, reverse and prepend it
    if (syncResult.downloaded && syncResult.newChunk) {
      console.log(`[Server] New data downloaded (${syncResult.bytesDownloaded} bytes), starting reversal...`);
      const reverseStartTime = Date.now();
      await logReverser.reverseAndPrepend(syncResult.newChunk);
      const reverseDuration = Date.now() - reverseStartTime;
      console.log(`[Server] Reversal step completed in ${reverseDuration}ms`);
    } else {
      console.log('[Server] No new data to process');
    }
    
    lastSyncTime = new Date().toISOString();
    const duration = Date.now() - startTime;
    console.log(`[Server] Sync cycle completed successfully in ${duration}ms`);
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error('[Server] Sync cycle error:', {
      message: error.message,
      code: error.code,
      duration: duration,
      stack: error.stack
    });
    throw error;
  } finally {
    syncInProgress = false;
    console.log('[Server] Sync cycle finished, syncInProgress set to false');
  }
}

// Store interval ID for cleanup
let syncIntervalId = null;

/**
 * Initialize the system and start periodic syncing
 * This function will not exit the process on failure - server will continue running
 */
async function initialize() {
  const initStartTime = Date.now();
  try {
    console.log('[Server] ========================================');
    console.log('[Server] Initializing EBEAM Log Monitor...');
    console.log('[Server] ========================================');
    console.log('[Server] Configuration:');
    console.log(`[Server]   - File ID: ${config.googleDriveFileId}`);
    console.log(`[Server]   - Local Log: ${config.localLogFile}`);
    console.log(`[Server]   - Reversed Log: ${config.reversedLogFile}`);
    console.log(`[Server]   - Update Interval: ${config.updateInterval}ms (${config.updateInterval / 1000}s)`);
    console.log(`[Server]   - Port: ${config.port}`);
    // Show credentials source
    let credsSource = 'none';
    let credsPath = 'NOT SET';
    if (config.credentials && config.credentials.GOOGLE_APPLICATION_CREDENTIALS) {
      credsSource = 'config.js';
      credsPath = config.credentials.GOOGLE_APPLICATION_CREDENTIALS;
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      credsSource = 'environment variable';
      credsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    }
    console.log(`[Server]   - Credentials Source: ${credsSource}`);
    console.log(`[Server]   - Credentials Path: ${credsPath}`);
    console.log('[Server] ========================================');
    
    // Initialize Google Drive API
    const driveInitStartTime = Date.now();
    await driveSync.initialize();
    const driveInitDuration = Date.now() - driveInitStartTime;
    console.log(`[Server] Google Drive API initialization completed in ${driveInitDuration}ms`);
    
    // Perform initial sync
    console.log('[Server] Performing initial sync...');
    const initialSyncStartTime = Date.now();
    await performSync();
    const initialSyncDuration = Date.now() - initialSyncStartTime;
    console.log(`[Server] Initial sync completed in ${initialSyncDuration}ms`);
    
    // Set up periodic sync
    syncIntervalId = setInterval(async () => {
      try {
        console.log('[Server] Periodic sync triggered');
        await performSync();
      } catch (error) {
        console.error('[Server] Periodic sync error:', {
          message: error.message,
          code: error.code,
          stack: error.stack
        });
        // Don't throw - we want periodic syncs to continue even if one fails
      }
    }, config.updateInterval);
    
    const initDuration = Date.now() - initStartTime;
    console.log(`[Server] Initialization completed successfully in ${initDuration}ms`);
    console.log(`[Server] Periodic sync enabled (every ${config.updateInterval / 1000} seconds)`);
    console.log(`[Server] Server ready on port ${config.port}`);
  } catch (error) {
    const initDuration = Date.now() - initStartTime;
    console.error('[Server] Initialization error:', {
      message: error.message,
      code: error.code,
      duration: initDuration,
      stack: error.stack
    });
    console.error('[Server] WARNING: Server will continue running but sync functionality may not work.');
    console.error('[Server] Please check your configuration and try manual sync via POST /api/sync');
    // Don't exit - let the server continue running so users can still access the web interface
  }
}

// Start server
const PORT = config.port;

// Immediate test output
console.error('[Server] ========================================');
console.error('[Server] SERVER STARTING - If you see this, output is working!');
console.error('[Server] ========================================');
console.log(`[Server] Starting server on port ${PORT}...`);
console.log(`[Server] Process ID: ${process.pid}`);
console.log(`[Server] Working directory: ${process.cwd()}`);
console.log('');

app.listen(PORT, () => {
  console.log(`[Server] ========================================`);
  console.log(`[Server] EBEAM Log Monitor server running!`);
  console.log(`[Server] Process ID: ${process.pid}`);
  console.log(`[Server] Web interface: http://localhost:${PORT}`);
  console.log(`[Server] Health check: http://localhost:${PORT}/api/health`);
  console.log(`[Server] Test Drive: http://localhost:${PORT}/api/test-drive`);
  console.log(`[Server] ========================================`);
  console.log(`[Server] Starting initialization...`);
  initialize();
}).on('error', (err) => {
  console.error('[Server] ========================================');
  console.error('[Server] ERROR: Failed to start server!');
  console.error('[Server] ========================================');
  console.error('[Server] Error details:', {
    message: err.message,
    code: err.code,
    port: PORT,
    stack: err.stack
  });
  process.exit(1);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('[Server] Uncaught Exception:', {
    message: error.message,
    code: error.code,
    stack: error.stack
  });
  // Don't exit immediately - log the error and let the process continue
  // In production, you might want to exit here
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('[Server] Unhandled Rejection at:', {
    promise: promise,
    reason: reason,
    stack: reason?.stack
  });
  // Don't exit immediately - log the error and let the process continue
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[Server] SIGINT received, shutting down gracefully...');
  if (syncIntervalId) {
    clearInterval(syncIntervalId);
  }
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n[Server] SIGTERM received, shutting down gracefully...');
  if (syncIntervalId) {
    clearInterval(syncIntervalId);
  }
  process.exit(0);
});

