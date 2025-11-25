/* global process */
/**
 * Example usage of ebeamLogSync.js standalone module
 * 
 * This demonstrates how to use the standalone LogSync class
 * for easy integration into your own applications.
 */

const LogSync = require('./ebeamLogSync.js');

// ============================================================================
// Example 1: Basic Usage
// ============================================================================

async function basicExample() {
  console.log('=== Example 1: Basic Usage ===\n');

  // Create instance with minimal config (uses env vars for credentials)
  // You can also import config.js: const config = require('./config.js');
  const sync = new LogSync({
    googleDriveFileId: process.env.GOOGLE_DRIVE_FILE_ID || '113U8T4O7fN2onSeOTudNTQCxZ7g2Xjgd' // Default from config.js
  });

  try {
    // Initialize (authenticates with Google Drive)
    console.log('Initializing...');
    await sync.initialize();
    console.log('✓ Initialized\n');

    // Perform sync
    console.log('Syncing...');
    const syncResult = await sync.sync();
    console.log('Sync result:', syncResult);
    console.log('');

    // Get paginated logs (newest first)
    console.log('Fetching logs...');
    const logs = await sync.getPaginatedLines(1, 10);
    console.log(`Total lines: ${logs.totalLines}`);
    console.log(`First ${logs.lines.length} lines (newest first):`);
    logs.lines.forEach((line, i) => {
      console.log(`  ${i + 1}. ${line.substring(0, 80)}${line.length > 80 ? '...' : ''}`);
    });
    console.log('');

    // Get statistics
    const stats = await sync.getStats();
    console.log('Statistics:', stats);
  } catch (error) {
    console.error('Error:', error);
  }
}

// ============================================================================
// Example 2: With Full Configuration
// ============================================================================

async function fullConfigExample() {
  console.log('=== Example 2: Full Configuration ===\n');

  const sync = new LogSync({
    googleDriveFileId: 'your-file-id-here',
    credentials: {
      GOOGLE_APPLICATION_CREDENTIALS: '~/.ssh/your-credentials.json'
    },
    localLogFile: './data/custom_log.txt',
    reversedLogFile: './data/custom_log_reversed.txt',
    defaultPageSize: 50
  });

  await sync.initialize();
  await sync.sync();
}

// ============================================================================
// Example 3: Periodic Syncing
// ============================================================================

async function periodicSyncExample() {
  console.log('=== Example 3: Periodic Syncing ===\n');

  const sync = new LogSync({
    googleDriveFileId: process.env.GOOGLE_DRIVE_FILE_ID
  });

  await sync.initialize();

  // Perform initial sync
  await sync.sync();

  // Set up periodic sync (every minute)
  const intervalId = setInterval(async () => {
    try {
      console.log(`[${new Date().toISOString()}] Starting periodic sync...`);
      const result = await sync.sync();
      if (result.downloaded) {
        console.log(`  ✓ Downloaded ${result.bytesDownloaded} bytes`);
      } else {
        console.log('  ✓ No new data');
      }
    } catch (error) {
      console.error('  ✗ Sync failed:', error.message || error.error);
    }
  }, 60000); // 60 seconds

  console.log('Periodic sync started. Press Ctrl+C to stop.');

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    clearInterval(intervalId);
    process.exit(0);
  });
}

// ============================================================================
// Example 4: Integration with Express API
// ============================================================================

async function expressIntegrationExample() {
  console.log('=== Example 4: Express Integration ===\n');

  const express = require('express');
  const app = express();
  const sync = new LogSync({
    googleDriveFileId: process.env.GOOGLE_DRIVE_FILE_ID
  });

  // Initialize once
  await sync.initialize();

  // API endpoints
  app.get('/api/logs', async (req, res) => {
    try {
      const page = parseInt(req.query.page) || 1;
      const pageSize = parseInt(req.query.pageSize) || 100;
      const result = await sync.getPaginatedLines(page, pageSize);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/sync', async (req, res) => {
    try {
      const result = await sync.sync();
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message || error.error });
    }
  });

  app.get('/api/stats', async (req, res) => {
    try {
      const stats = await sync.getStats();
      res.json(stats);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

// ============================================================================
// Run Example
// ============================================================================

// Uncomment the example you want to run:

// For basic usage (recommended to start here):
basicExample().catch(console.error);

// For full configuration:
// fullConfigExample().catch(console.error);

// For periodic syncing (runs continuously):
// periodicSyncExample();

// For Express API integration:
// expressIntegrationExample().catch(console.error);

