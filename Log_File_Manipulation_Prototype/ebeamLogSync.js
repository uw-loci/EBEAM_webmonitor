/* global process */
/* global Buffer */
/**
 * EBEAM Log Sync - Standalone MVP
 * 
 * A single-file solution that combines Google Drive syncing and log reversal
 * functionality for easy integration into other applications.
 * 
 * Usage:
 *   const LogSync = require('./ebeamLogSync.js');
 *   const sync = new LogSync(config);
 *   await sync.initialize();
 *   await sync.sync(); // Perform sync
 *   const lines = await sync.getPaginatedLines(1, 100); // Get logs
 */

const fs = require('fs-extra');
const path = require('path');
const os = require('os');

// ============================================================================
// Configuration Helper
// ============================================================================

function expandPath(filePath) {
  if (filePath && filePath.startsWith('~')) {
    return path.join(os.homedir(), filePath.slice(1));
  }
  return filePath;
}

function getDefaultConfig() {
  return {
    // Google Drive File ID
    googleDriveFileId: process.env.GOOGLE_DRIVE_FILE_ID || '',
    
    // Credentials (priority: config.credentials → env var)
    credentials: {
      GOOGLE_APPLICATION_CREDENTIALS: process.env.GOOGLE_APPLICATION_CREDENTIALS || ''
    },
    
    // Local file paths
    localLogFile: './data/live_log.txt',
    reversedLogFile: './data/live_log_reversed.txt',
    
    // Pagination defaults
    defaultPageSize: 100
  };
}

// ============================================================================
// Google Drive Sync Module
// ============================================================================

class DriveSync {
  constructor(config) {
    this.config = config;
    this.drive = null;
    this.initialized = false;
    this.google = null;
  }

  /**
   * Lazy load googleapis module
   */
  loadGoogleApis() {
    if (!this.google) {
      console.log('[DriveSync] Loading googleapis module (this may take 5-15 seconds, please wait)...');
      const startTime = Date.now();
      
      try {
        // Check if module exists first
        try {
          require.resolve('googleapis');
        } catch (resolveError) {
          throw new Error('googleapis module not found. Please run: npm install googleapis');
        }
        
        const googleapisModule = require('googleapis');
        const loadTime = Date.now() - startTime;
        console.log(`[DriveSync] googleapis module loaded in ${loadTime}ms`);
        
        this.google = googleapisModule.google || googleapisModule.default?.google || googleapisModule;
        
        if (!this.google) {
          throw new Error('Failed to extract google object from googleapis module');
        }
        
        console.log('[DriveSync] googleapis initialized successfully');
      } catch (error) {
        console.error('[DriveSync] Error loading googleapis:', error.message);
        throw error;
      }
    }
    return this.google;
  }

  /**
   * Initialize Google Drive API client
   */
  async initialize() {
    try {
      // Get credentials path (priority: config → env var)
      let credsPath = null;
      let credsSource = '';
      
      if (this.config.credentials && this.config.credentials.GOOGLE_APPLICATION_CREDENTIALS) {
        credsPath = this.config.credentials.GOOGLE_APPLICATION_CREDENTIALS;
        credsSource = 'config';
      } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        credsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
        credsSource = 'environment variable';
      }
      
      if (!credsPath) {
        throw new Error('No credentials found. Set GOOGLE_APPLICATION_CREDENTIALS in config or environment variable.');
      }
      
      // Expand ~ to home directory
      credsPath = expandPath(credsPath);
      console.log(`[DriveSync] Using credentials from: ${credsPath}`);
      
      // Verify credentials file exists
      if (!fs.existsSync(credsPath)) {
        throw new Error(`Credentials file not found: ${credsPath}`);
      }
      console.log('[DriveSync] Credentials file found');
      
      // Load googleapis and authenticate
      console.log('[DriveSync] Loading Google APIs...');
      const google = this.loadGoogleApis();
      
      console.log('[DriveSync] Creating authentication client...');
      const auth = new google.auth.GoogleAuth({
        keyFile: credsPath,
        scopes: ['https://www.googleapis.com/auth/drive.readonly'],
      });
      
      console.log('[DriveSync] Initializing Drive API client...');
      this.drive = google.drive({ version: 'v3', auth });
      this.initialized = true;
      console.log(`[DriveSync] ✓ Initialized successfully using ${credsSource}`);
    } catch (error) {
      console.error('[DriveSync] Initialization failed:', error.message);
      throw error;
    }
  }

  /**
   * Get remote file size from Google Drive
   */
  async getRemoteFileSize() {
    if (!this.initialized) await this.initialize();

    const response = await this.drive.files.get({
      fileId: this.config.googleDriveFileId,
      fields: 'size',
    });

    if (!response.data || !response.data.size) {
      throw new Error('Invalid response from Google Drive API: size field missing');
    }

    const size = parseInt(response.data.size, 10);
    if (isNaN(size)) {
      throw new Error(`Invalid file size returned: ${response.data.size}`);
    }

    return size;
  }

  /**
   * Download a byte range from Google Drive file
   */
  async downloadRange(startByte, endByte) {
    if (!this.initialized) await this.initialize();

    const rangeHeader = `bytes=${startByte}-${endByte}`;
    
    const response = await this.drive.files.get(
      {
        fileId: this.config.googleDriveFileId,
        alt: 'media',
      },
      {
        responseType: 'arraybuffer',
        headers: { Range: rangeHeader },
      }
    );

    // Convert response to Buffer
    let buffer;
    if (response.data instanceof ArrayBuffer) {
      buffer = Buffer.from(response.data);
    } else if (Buffer.isBuffer(response.data)) {
      buffer = response.data;
    } else {
      // Handle stream
      const chunks = [];
      for await (const chunk of response.data) {
        chunks.push(chunk);
      }
      buffer = Buffer.concat(chunks);
    }

    if (!buffer || buffer.length === 0) {
      throw new Error('Received empty buffer from Google Drive');
    }

    return buffer;
  }

  /**
   * Get local file size
   */
  async getLocalFileSize(filePath) {
    try {
      const stats = await fs.stat(filePath);
      return stats.size;
    } catch (error) {
      if (error.code === 'ENOENT') {
        return 0;
      }
      throw error;
    }
  }

  /**
   * Append data to local file
   */
  async appendToFile(filePath, data) {
    const dirPath = path.dirname(filePath);
    await fs.ensureDir(dirPath);
    await fs.appendFile(filePath, data);
  }

  /**
   * Perform incremental sync: download only new bytes
   */
  async syncIncremental() {
    const remoteSize = await this.getRemoteFileSize();
    const localSize = await this.getLocalFileSize(this.config.localLogFile);

    if (remoteSize < localSize) {
      console.warn('[DriveSync] Remote file is smaller than local file');
      return { downloaded: false, bytesDownloaded: 0, newChunk: null };
    }

    if (remoteSize === localSize) {
      return { downloaded: false, bytesDownloaded: 0, newChunk: null };
    }

    const bytesToDownload = remoteSize - localSize;
    const newChunk = await this.downloadRange(localSize, remoteSize - 1);

    if (!newChunk || newChunk.length === 0) {
      throw new Error('Downloaded chunk is empty');
    }

    await this.appendToFile(this.config.localLogFile, newChunk);

    return {
      downloaded: true,
      bytesDownloaded: newChunk.length,
      newChunk: newChunk,
    };
  }
}

// ============================================================================
// Log Reverser Module
// ============================================================================

class LogReverser {
  constructor(config) {
    this.config = config;
  }

  /**
   * Reverse lines in a buffer chunk (newest first)
   */
  reverseChunk(chunk) {
    if (!chunk || chunk.length === 0) {
      return '';
    }

    const text = chunk.toString('utf8');
    const originalEndsWithNewline = text.endsWith('\n');
    const lines = text.split('\n');
    
    // Filter out trailing empty lines, preserve others
    const filteredLines = [];
    let trailingEmpty = true;
    
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].length > 0) {
        trailingEmpty = false;
      }
      if (!trailingEmpty || lines[i].length > 0) {
        filteredLines.push(lines[i]);
      }
    }
    
    // Join with newlines, preserve original trailing newline behavior
    return filteredLines.length > 0
      ? filteredLines.join('\n') + (originalEndsWithNewline ? '\n' : '')
      : '';
  }

  /**
   * Reverse and prepend new chunk to reversed log file
   */
  async reverseAndPrepend(newChunk) {
    if (!newChunk || newChunk.length === 0) {
      return;
    }

    const reversedChunk = this.reverseChunk(newChunk);
    
    if (reversedChunk.length === 0) {
      return;
    }

    await this.prependToReversedFile(reversedChunk);
  }

  /**
   * Prepend content to reversed log file
   */
  async prependToReversedFile(content) {
    const filePath = this.config.reversedLogFile;
    const dirPath = path.dirname(filePath);
    await fs.ensureDir(dirPath);
    
    let existingContent = '';
    try {
      existingContent = await fs.readFile(filePath, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
    
    // Handle newline management
    const newEndsWithNewline = content.endsWith('\n');
    const existingEndsWithNewline = existingContent.length > 0 && existingContent.endsWith('\n');
    
    let newContent;
    if (existingContent.length === 0) {
      newContent = content;
    } else if (newEndsWithNewline && existingEndsWithNewline) {
      newContent = content.slice(0, -1) + '\n' + existingContent;
    } else if (newEndsWithNewline && !existingEndsWithNewline) {
      newContent = content + existingContent;
    } else if (!newEndsWithNewline && existingEndsWithNewline) {
      newContent = content + '\n' + existingContent;
    } else {
      newContent = content + '\n' + existingContent;
    }
    
    await fs.writeFile(filePath, newContent);
  }

  /**
   * Get paginated lines from reversed log file (newest first)
   */
  async getPaginatedLines(page = 1, pageSize = 100) {
    const filePath = this.config.reversedLogFile;
    
    try {
      const content = await fs.readFile(filePath, 'utf8');
      const lines = content.split('\n');
      
      // Filter out trailing empty lines
      const filteredLines = lines.filter((line, index) => {
        return line.length > 0 || index < lines.length - 1;
      });
      
      const totalLines = filteredLines.length;
      const startIndex = (page - 1) * pageSize;
      const endIndex = startIndex + pageSize;
      const paginatedLines = filteredLines.slice(startIndex, endIndex);
      const hasMore = endIndex < totalLines;
      
      return {
        lines: paginatedLines,
        totalLines: totalLines,
        hasMore: hasMore,
        page: page,
        pageSize: pageSize,
      };
    } catch (error) {
      if (error.code === 'ENOENT') {
        return {
          lines: [],
          totalLines: 0,
          hasMore: false,
          page: page,
          pageSize: pageSize,
        };
      }
      throw error;
    }
  }
}

// ============================================================================
// Main LogSync Class - Combines DriveSync and LogReverser
// ============================================================================

class LogSync {
  /**
   * Create a new LogSync instance
   * @param {Object} config - Configuration object (optional, will use defaults + env vars)
   */
  constructor(config = {}) {
    // Merge user config with defaults
    const defaultConfig = getDefaultConfig();
    this.config = {
      ...defaultConfig,
      ...config,
      credentials: {
        ...defaultConfig.credentials,
        ...(config.credentials || {})
      }
    };

    this.driveSync = new DriveSync(this.config);
    this.logReverser = new LogReverser(this.config);
    this.lastSyncTime = null;
    this.syncInProgress = false;
  }

  /**
   * Initialize the sync system (authenticate with Google Drive)
   */
  async initialize() {
    await this.driveSync.initialize();
  }

  /**
   * Perform a complete sync: download new data and reverse it
   * @returns {Promise<Object>} Sync result with status and statistics
   */
  async sync() {
    if (this.syncInProgress) {
      throw new Error('Sync already in progress');
    }

    this.syncInProgress = true;
    const startTime = Date.now();

    try {
      // Step 1: Download incremental changes
      const syncResult = await this.driveSync.syncIncremental();

      // Step 2: If new data was downloaded, reverse and prepend it
      if (syncResult.downloaded && syncResult.newChunk) {
        await this.logReverser.reverseAndPrepend(syncResult.newChunk);
      }

      this.lastSyncTime = new Date().toISOString();
      const duration = Date.now() - startTime;

      return {
        success: true,
        downloaded: syncResult.downloaded,
        bytesDownloaded: syncResult.bytesDownloaded || 0,
        duration: duration,
        timestamp: this.lastSyncTime
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error('[LogSync] Sync error:', error.message);
      throw {
        success: false,
        error: error.message,
        duration: duration
      };
    } finally {
      this.syncInProgress = false;
    }
  }

  /**
   * Get paginated log lines (newest first)
   * @param {number} page - Page number (1-indexed, default: 1)
   * @param {number} pageSize - Lines per page (default: from config)
   * @returns {Promise<Object>} Paginated log lines
   */
  async getPaginatedLines(page = 1, pageSize = null) {
    const size = pageSize || this.config.defaultPageSize;
    return await this.logReverser.getPaginatedLines(page, size);
  }

  /**
   * Get system statistics
   * @returns {Promise<Object>} Statistics object
   */
  async getStats() {
    let localSize = 0;
    let reversedSize = 0;
    let totalLines = 0;
    let remoteSize = 0;

    try {
      localSize = await this.driveSync.getLocalFileSize(this.config.localLogFile);
    } catch (e) {
      // File doesn't exist, size remains 0
    }

    try {
      const stats = await fs.stat(this.config.reversedLogFile);
      reversedSize = stats.size;
      const content = await fs.readFile(this.config.reversedLogFile, 'utf8');
      totalLines = content.split('\n').filter(l => l.length > 0).length;
    } catch (e) {
      // File doesn't exist, sizes remain 0
    }

    try {
      remoteSize = await this.driveSync.getRemoteFileSize();
    } catch (e) {
      // Error getting remote size
    }

    return {
      localSize,
      reversedSize,
      remoteSize,
      totalLines,
      lastSync: this.lastSyncTime,
      syncInProgress: this.syncInProgress
    };
  }

  /**
   * Check if system is initialized
   * @returns {boolean}
   */
  isInitialized() {
    return this.driveSync.initialized;
  }
}

// ============================================================================
// Export
// ============================================================================

module.exports = LogSync;

// ============================================================================
// Example Usage (commented out)
// ============================================================================

/*
// Example 1: Basic usage with environment variables
const LogSync = require('./ebeamLogSync.js');

const sync = new LogSync({
  googleDriveFileId: 'your-file-id-here'
});

async function main() {
  await sync.initialize();
  await sync.sync();
  const lines = await sync.getPaginatedLines(1, 100);
  console.log(lines);
}

main().catch(console.error);

// Example 2: With full configuration
const sync = new LogSync({
  googleDriveFileId: 'your-file-id-here',
  credentials: {
    GOOGLE_APPLICATION_CREDENTIALS: '/path/to/credentials.json'
  },
  localLogFile: './data/log.txt',
  reversedLogFile: './data/log_reversed.txt',
  defaultPageSize: 50
});

// Example 3: Periodic syncing
setInterval(async () => {
  try {
    await sync.sync();
  } catch (error) {
    console.error('Periodic sync failed:', error);
  }
}, 60000); // Every minute

// Example 4: Integration with Express
const express = require('express');
const app = express();
const sync = new LogSync({ googleDriveFileId: 'your-file-id' });

await sync.initialize();

app.get('/api/logs', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.pageSize) || 100;
  const result = await sync.getPaginatedLines(page, pageSize);
  res.json(result);
});

app.post('/api/sync', async (req, res) => {
  const result = await sync.sync();
  res.json(result);
});

app.get('/api/stats', async (req, res) => {
  const stats = await sync.getStats();
  res.json(stats);
});
*/

