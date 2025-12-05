/* global process */
/* global Buffer */
// Standalone sync script - all logic in one file

const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const https = require('https');
const { GoogleAuth } = require('google-auth-library');

// ============================================================================
// Configuration - embedded for standalone operation
// ============================================================================

function expandPath(filePath) {
  if (filePath.startsWith('~')) {
    return path.join(os.homedir(), filePath.slice(1));
  }
  return filePath;
}

const config = {
  // Google Drive Folder ID to search for the latest modified file
  // Set GOOGLE_DRIVE_FOLDER_ID environment variable or edit the default value below
  googleDriveFolderId: process.env.GOOGLE_DRIVE_FOLDER_ID || '1m7DSuDg87jxYum1pYE-3w2PRo8Qqozou',
  
  // Alternative: Direct file ID (if you want to use a specific file instead of folder)
  // If both are set, folder ID takes precedence
  googleDriveFileId: process.env.GOOGLE_DRIVE_FILE_ID || null,
  
  // Google Drive API credentials
  // You can use service account credentials or OAuth2
  // For service account, set GOOGLE_APPLICATION_CREDENTIALS environment variable
  // Or provide credentials object here
  credentials: {
    // If using service account JSON file, set GOOGLE_APPLICATION_CREDENTIALS env var
    // Otherwise, you can provide credentials here (not recommended for production)
    GOOGLE_APPLICATION_CREDENTIALS: expandPath('~/ebeam-web-log-poc-a64b5e13f829.json')
  },
  
  // Local file paths
  localLogFile: './data/live_log.txt',
  reversedLogFile: './data/live_log_reversed.txt',
  
  // State persistence file for tracking current file ID
  syncStateFile: './data/sync_state.json',
  
  // Update interval in milliseconds (default: 1 minute)
  updateInterval: 60000,
  
  // Pagination defaults
  defaultPageSize: 100
};

// ============================================================================
// FileStateManager - State persistence for tracking current file ID
// ============================================================================

class FileStateManager {
  constructor(config) {
    this.config = config;
    this.stateFile = config.syncStateFile;
  }

  /**
   * Load persisted state from file
   * @returns {Promise<Object|null>} State object or null if file doesn't exist
   */
  async loadState() {
    try {
      const statePath = this.stateFile;
      const stateDir = path.dirname(statePath);
      
      // Ensure directory exists
      await fs.ensureDir(stateDir);
      
      // Try to read state file
      const stateContent = await fs.readFile(statePath, 'utf8');
      const state = JSON.parse(stateContent);
      
      // Validate state structure
      if (!state || typeof state !== 'object') {
        console.warn('[FileStateManager] Invalid state structure, ignoring');
        return null;
      }
      
      if (!state.currentFileId || typeof state.currentFileId !== 'string') {
        console.warn('[FileStateManager] Missing or invalid currentFileId in state, ignoring');
        return null;
      }
      
      console.log(`[FileStateManager] Loaded state: currentFileId=${state.currentFileId}, lastChecked=${state.lastChecked || 'N/A'}`);
      return state;
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.log('[FileStateManager] State file does not exist, will create new state');
        return null;
      }
      
      // Handle JSON parse errors
      if (error instanceof SyntaxError) {
        console.warn('[FileStateManager] State file contains invalid JSON, ignoring:', error.message);
        return null;
      }
      
      console.error('[FileStateManager] Error loading state:', {
        message: error.message,
        code: error.code,
        stateFile: this.stateFile,
        stack: error.stack
      });
      return null;
    }
  }

  /**
   * Save state to file
   * @param {string} fileId - Current file ID
   * @returns {Promise<void>}
   */
  async saveState(fileId) {
    try {
      const statePath = this.stateFile;
      const stateDir = path.dirname(statePath);
      
      // Ensure directory exists
      await fs.ensureDir(stateDir);
      
      const state = {
        currentFileId: fileId,
        lastChecked: new Date().toISOString()
      };
      
      await fs.writeFile(statePath, JSON.stringify(state, null, 2), 'utf8');
      console.log(`[FileStateManager] Saved state: currentFileId=${fileId}`);
    } catch (error) {
      console.error('[FileStateManager] Error saving state:', {
        message: error.message,
        code: error.code,
        stateFile: this.stateFile,
        fileId: fileId,
        stack: error.stack
      });
      throw error;
    }
  }
}

// ============================================================================
// DriveSync - Google Drive synchronization logic
// ============================================================================

class DriveSync {
  constructor(config, stateManager) {
    this.config = config;
    this.stateManager = stateManager;
    this.auth = null;
    this.authClient = null;
    this.token = null;
    this.initialized = false;
    this.currentFileId = null; // Dynamically found file ID
  }

  /**
   * Initialize Google Drive API authentication
   */
  async initialize() {
    try {
      // Priority: 1. config.js credentials, 2. environment variable
      let credsPath = null;
      let credsSource = '';
      
      // Check config.js first
      if (this.config.credentials && this.config.credentials.GOOGLE_APPLICATION_CREDENTIALS) {
        credsPath = this.config.credentials.GOOGLE_APPLICATION_CREDENTIALS;
        credsSource = 'config.js';
        console.log(`[DriveSync] Using credentials from config.js: ${credsPath}`);
      } 
      // Fall back to environment variable
      else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        credsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
        credsSource = 'environment variable';
        console.log(`[DriveSync] Using credentials from environment variable: ${credsPath}`);
      }
      
      if (!credsPath) {
        const errorMsg = 'No credentials found. Please set GOOGLE_APPLICATION_CREDENTIALS in config.js or as an environment variable.';
        console.error('[DriveSync] Initialization failed:', errorMsg);
        throw new Error(errorMsg);
      }
      
      // Expand ~ to home directory if present
      if (credsPath.startsWith('~')) {
        credsPath = credsPath.replace('~', os.homedir());
        console.log(`[DriveSync] Expanded path to: ${credsPath}`);
      }
      
      try {
        // Create GoogleAuth instance (matching readDriveFile.js pattern exactly)
        this.auth = new GoogleAuth({
          keyFile: credsPath,
          scopes: ['https://www.googleapis.com/auth/drive.readonly'],
        });
        
        // Get authenticated client & token (matching readDriveFile.js pattern exactly)
        this.authClient = await this.auth.getClient();
        const tokenResult = await this.authClient.getAccessToken();
        this.token = tokenResult.token;
        
        if (!this.token) {
          throw new Error('Failed to obtain access token');
        }
        
        console.log('[DriveSync] Access token obtained successfully');
        console.log(`[DriveSync] Successfully authenticated using ${credsSource}`);
      } catch (authError) {
        console.error('[DriveSync] Authentication error:', {
          message: authError.message,
          code: authError.code,
          path: credsPath,
          source: credsSource,
          stack: authError.stack
        });
        throw new Error(`Failed to authenticate with Google Drive API: ${authError.message}`);
      }
      
      this.initialized = true;
      console.log('[DriveSync] Google Drive API initialized successfully');
      
      // Find and set the file ID after authentication
      await this.findAndSetFileId();
    } catch (error) {
      console.error('[DriveSync] Failed to initialize Google Drive API:', {
        message: error.message,
        code: error.code,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Ensure we have a valid token (refresh if needed)
   */
  async ensureToken() {
    if (!this.initialized) {
      await this.initialize();
    }
    
    // Refresh token if needed
    const tokenResult = await this.authClient.getAccessToken();
    this.token = tokenResult.token;
    
    if (!this.token) {
      throw new Error('Failed to obtain access token');
    }
  }

  /**
   * Make an HTTPS request to Google Drive API
   */
  async makeRequest(path, options = {}) {
    await this.ensureToken();
    
    return new Promise((resolve, reject) => {
      const requestOptions = {
        hostname: 'www.googleapis.com',
        path: path,
        method: options.method || 'GET',
        headers: {
          Authorization: `Bearer ${this.token}`,
          ...options.headers,
        },
      };

      const req = https.request(requestOptions, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const parsed = data ? JSON.parse(data) : {};
              resolve({
                statusCode: res.statusCode,
                data: parsed,
                headers: res.headers,
              });
            } catch {
              // If not JSON, return raw data
              resolve({
                statusCode: res.statusCode,
                data: data,
                headers: res.headers,
              });
            }
          } else {
            let errorData;
            try {
              errorData = JSON.parse(data);
            } catch {
              errorData = { message: data };
            }
            const error = new Error(errorData.error?.message || `HTTP ${res.statusCode}`);
            error.statusCode = res.statusCode;
            error.response = errorData;
            reject(error);
          }
        });
      });

      req.on('error', (err) => {
        reject(err);
      });

      if (options.body) {
        req.write(options.body);
      }

      req.end();
    });
  }

  /**
   * List files in a Google Drive folder
   * @param {string} folderId - Google Drive folder ID
   * @returns {Promise<Array>} Array of file objects
   */
  async listFilesInFolder(folderId) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      console.log(`[DriveSync] Listing files in folder: ${folderId}`);
      
      // Build query to get files in folder (not subfolders)
      // mimeType != 'application/vnd.google-apps.folder' excludes folders
      const query = `'${folderId}' in parents and trashed=false and mimeType!='application/vnd.google-apps.folder'`;
      
      // Build query parameters properly
      const params = new URLSearchParams({
        q: query,
        fields: 'files(id,name,modifiedTime,size)',
        orderBy: 'modifiedTime desc'
      });
      
      const path = `/drive/v3/files?${params.toString()}`;
      
      const response = await this.makeRequest(path);

      if (!response.data || !response.data.files) {
        console.error('[DriveSync] Invalid response from Drive API:', {
          folderId: folderId,
          responseData: response.data
        });
        throw new Error('Invalid response from Google Drive API: files array missing');
      }

      const files = response.data.files;
      console.log(`[DriveSync] Found ${files.length} files in folder`);
      return files;
    } catch (error) {
      console.error('[DriveSync] Error listing files in folder:', {
        message: error.message,
        statusCode: error.statusCode,
        folderId: folderId,
        response: error.response,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Find the latest modified file in a folder
   * @param {string} folderId - Google Drive folder ID
   * @returns {Promise<Object>} Object with id, name, and modifiedTime of latest file
   */
  async findLatestFileInFolder(folderId) {
    try {
      const files = await this.listFilesInFolder(folderId);
      
      if (files.length === 0) {
        throw new Error(`No files found in folder: ${folderId}`);
      }

      // Files are already sorted by modifiedTime desc from the API query
      // So the first file is the latest modified
      const latestFile = files[0];
      
      console.log(`[DriveSync] Latest modified file: ${latestFile.name} (ID: ${latestFile.id}, Modified: ${latestFile.modifiedTime})`);
      return {
        id: latestFile.id,
        name: latestFile.name,
        modifiedTime: latestFile.modifiedTime
      };
    } catch (error) {
      console.error('[DriveSync] Error finding latest file in folder:', {
        message: error.message,
        folderId: folderId,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Check if a new file has become the latest in the folder
   * @returns {Promise<Object>} Object with hasNewFile, newFileId, newFileName, oldFileId
   */
  async checkForNewFile() {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      // Only check if we're using folder-based sync
      if (!this.config.googleDriveFolderId || this.config.googleDriveFolderId === 'YOUR_FOLDER_ID_HERE') {
        // Using direct file ID, no need to check for new files
        return { hasNewFile: false, newFileId: null, newFileName: null, oldFileId: null };
      }

      if (!this.currentFileId) {
        console.log('[DriveSync] No current file ID set, cannot check for new file');
        return { hasNewFile: false, newFileId: null, newFileName: null, oldFileId: null };
      }

      console.log(`[DriveSync] Checking for new file in folder: ${this.config.googleDriveFolderId}`);
      const latestFile = await this.findLatestFileInFolder(this.config.googleDriveFolderId);
      
      if (latestFile.id !== this.currentFileId) {
        console.log(`[DriveSync] New file detected! Old: ${this.currentFileId}, New: ${latestFile.id} (${latestFile.name})`);
        return {
          hasNewFile: true,
          newFileId: latestFile.id,
          newFileName: latestFile.name,
          oldFileId: this.currentFileId
        };
      }

      console.log(`[DriveSync] No new file detected, still syncing: ${this.currentFileId}`);
      return { hasNewFile: false, newFileId: null, newFileName: null, oldFileId: null };
    } catch (error) {
      console.error('[DriveSync] Error checking for new file:', {
        message: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Switch to a new file ID
   * @param {string} newFileId - New file ID to switch to
   * @param {string} newFileName - New file name (for logging)
   * @returns {Promise<void>}
   */
  async switchToNewFile(newFileId, newFileName) {
    try {
      const oldFileId = this.currentFileId;
      this.currentFileId = newFileId;
      
      // Persist the new file ID
      if (this.stateManager) {
        await this.stateManager.saveState(newFileId);
      }
      
      console.log(`[DriveSync] Switched to new file: ${newFileName} (ID: ${newFileId}, was: ${oldFileId})`);
    } catch (error) {
      console.error('[DriveSync] Error switching to new file:', {
        message: error.message,
        newFileId: newFileId,
        newFileName: newFileName,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Find and set the current file ID
   * Uses persisted state if available, otherwise finds latest file in folder or uses direct file ID
   */
  async findAndSetFileId() {
    // Try to load persisted state first
    if (this.stateManager) {
      const state = await this.stateManager.loadState();
      if (state && state.currentFileId) {
        console.log(`[DriveSync] Loaded file ID from persisted state: ${state.currentFileId}`);
        this.currentFileId = state.currentFileId;
        
        // Validate that we still need to find the file (for folder-based sync)
        // If using folder ID, we'll verify it's still valid during sync
        if (this.config.googleDriveFolderId && this.config.googleDriveFolderId !== 'YOUR_FOLDER_ID_HERE') {
          // For folder-based sync, we'll check for new files during sync cycles
          // For now, just use the persisted ID
          console.log(`[DriveSync] Using persisted file ID, will check for new files during sync`);
          return;
        } else if (this.config.googleDriveFileId) {
          // For direct file ID, use it if it matches persisted state
          if (this.currentFileId === this.config.googleDriveFileId) {
            console.log(`[DriveSync] Persisted file ID matches config file ID`);
            return;
          } else {
            console.log(`[DriveSync] Persisted file ID differs from config, using config file ID`);
            this.currentFileId = this.config.googleDriveFileId;
            await this.stateManager.saveState(this.currentFileId);
            return;
          }
        }
      }
    }
    
    // No persisted state or invalid state, find file ID
    // If folder ID is provided, find the latest file in that folder
    if (this.config.googleDriveFolderId && this.config.googleDriveFolderId !== 'YOUR_FOLDER_ID_HERE') {
      console.log(`[DriveSync] Using folder ID to find latest file: ${this.config.googleDriveFolderId}`);
      const latestFile = await this.findLatestFileInFolder(this.config.googleDriveFolderId);
      this.currentFileId = latestFile.id;
    }
    // Otherwise, use direct file ID if provided
    else if (this.config.googleDriveFileId) {
      console.log(`[DriveSync] Using direct file ID: ${this.config.googleDriveFileId}`);
      this.currentFileId = this.config.googleDriveFileId;
    }
    else {
      throw new Error('Either googleDriveFolderId or googleDriveFileId must be provided in config');
    }
    
    // Save the file ID to state
    if (this.stateManager && this.currentFileId) {
      await this.stateManager.saveState(this.currentFileId);
    }
    
    console.log(`[DriveSync] Current file ID set to: ${this.currentFileId}`);
  }

  /**
   * Get the current size of the file on Google Drive
   */
  async getRemoteFileSize() {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.currentFileId) {
      await this.findAndSetFileId();
    }

    try {
      const fileId = this.currentFileId;
      console.log(`[DriveSync] Getting remote file size for file ID: ${fileId}`);
      
      const path = `/drive/v3/files/${fileId}?fields=size`;
      const response = await this.makeRequest(path);

      if (!response.data || !response.data.size) {
        console.error('[DriveSync] Invalid response from Drive API:', {
          fileId: fileId,
          responseData: response.data
        });
        throw new Error('Invalid response from Google Drive API: size field missing');
      }

      const size = parseInt(response.data.size, 10);
      if (isNaN(size)) {
        console.error('[DriveSync] Invalid size value:', {
          fileId: fileId,
          sizeValue: response.data.size
        });
        throw new Error(`Invalid file size returned: ${response.data.size}`);
      }

      console.log(`[DriveSync] Remote file size: ${size} bytes`);
      return size;
    } catch (error) {
      console.error('[DriveSync] Error getting remote file size:', {
        message: error.message,
        statusCode: error.statusCode,
        fileId: this.currentFileId,
        response: error.response,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Download a range of bytes from Google Drive file
   */
  async downloadRange(startByte, endByte) {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.currentFileId) {
      await this.findAndSetFileId();
    }

    try {
      const fileId = this.currentFileId;
      const rangeHeader = `bytes=${startByte}-${endByte}`;
      const expectedSize = endByte - startByte + 1;
      
      console.log(`[DriveSync] Downloading range: ${rangeHeader} (expected ${expectedSize} bytes)`);
      
      await this.ensureToken();
      
      return new Promise((resolve, reject) => {
        const requestOptions = {
          hostname: 'www.googleapis.com',
          path: `/drive/v3/files/${fileId}?alt=media`,
          method: 'GET',
          headers: {
            Authorization: `Bearer ${this.token}`,
            Range: rangeHeader,
          },
        };

        const req = https.request(requestOptions, (res) => {
          const chunks = [];

          res.on('data', (chunk) => {
            chunks.push(chunk);
          });

          res.on('end', () => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              const buffer = Buffer.concat(chunks);
              
              if (!buffer || buffer.length === 0) {
                console.error('[DriveSync] Empty buffer received:', {
                  fileId: fileId,
                  range: rangeHeader,
                });
                reject(new Error('Received empty buffer from Google Drive'));
                return;
              }

              console.log(`[DriveSync] Successfully downloaded ${buffer.length} bytes (expected ${expectedSize})`);
              
              if (buffer.length !== expectedSize) {
                console.warn('[DriveSync] Size mismatch:', {
                  expected: expectedSize,
                  actual: buffer.length,
                  difference: buffer.length - expectedSize
                });
              }

              resolve(buffer);
            } else {
              // Error response - data is already in chunks
              const errorBuffer = Buffer.concat(chunks);
              let parsedError;
              try {
                parsedError = JSON.parse(errorBuffer.toString());
              } catch {
                parsedError = { message: errorBuffer.toString() };
              }
              const error = new Error(parsedError.error?.message || `HTTP ${res.statusCode}`);
              error.statusCode = res.statusCode;
              error.response = parsedError;
              reject(error);
            }
          });
        });

        req.on('error', (err) => {
          reject(err);
        });

        req.end();
      });
    } catch (error) {
      console.error('[DriveSync] Error downloading range:', {
        message: error.message,
        statusCode: error.statusCode,
        fileId: this.currentFileId,
        startByte: startByte,
        endByte: endByte,
        range: `bytes=${startByte}-${endByte}`,
        response: error.response,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Get the local file size
   */
  async getLocalFileSize(filePath) {
    try {
      const stats = await fs.stat(filePath);
      console.log(`[DriveSync] Local file size for ${filePath}: ${stats.size} bytes`);
      return stats.size;
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.log(`[DriveSync] Local file does not exist: ${filePath}`);
        return 0;
      }
      console.error('[DriveSync] Error getting local file size:', {
        message: error.message,
        code: error.code,
        filePath: filePath,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Append data to a local file
   */
  async appendToFile(filePath, data) {
    try {
      const dirPath = path.dirname(filePath);
      console.log(`[DriveSync] Ensuring directory exists: ${dirPath}`);
      await fs.ensureDir(dirPath);
      
      console.log(`[DriveSync] Appending ${data.length} bytes to ${filePath}`);
      await fs.appendFile(filePath, data);
      console.log(`[DriveSync] Successfully appended data to ${filePath}`);
    } catch (error) {
      console.error('[DriveSync] Error appending to file:', {
        message: error.message,
        code: error.code,
        filePath: filePath,
        dataLength: data?.length,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Perform incremental sync: download only new bytes and append to local file
   */
  async syncIncremental() {
    const syncStartTime = Date.now();
    try {
      console.log('[DriveSync] Starting incremental sync...');
      
      const remoteSize = await this.getRemoteFileSize();
      const localSize = await this.getLocalFileSize(this.config.localLogFile);

      console.log(`[DriveSync] Size comparison - Remote: ${remoteSize} bytes, Local: ${localSize} bytes, Difference: ${remoteSize - localSize} bytes`);

      if (remoteSize < localSize) {
        console.warn('[DriveSync] WARNING: Remote file is smaller than local file!', {
          remoteSize: remoteSize,
          localSize: localSize,
          difference: localSize - remoteSize,
          localFile: this.config.localLogFile
        });
        return { downloaded: false, bytesDownloaded: 0, newChunk: null };
      }

      if (remoteSize === localSize) {
        console.log('[DriveSync] No new data to download - files are in sync');
        return { downloaded: false, bytesDownloaded: 0, newChunk: null };
      }

      const bytesToDownload = remoteSize - localSize;
      console.log(`[DriveSync] Downloading ${bytesToDownload} new bytes (from byte ${localSize} to ${remoteSize - 1})`);

      // Download the new range
      const downloadStartTime = Date.now();
      const newChunk = await this.downloadRange(localSize, remoteSize - 1);
      const downloadDuration = Date.now() - downloadStartTime;
      console.log(`[DriveSync] Download completed in ${downloadDuration}ms`);

      if (!newChunk || newChunk.length === 0) {
        console.error('[DriveSync] ERROR: Downloaded chunk is empty!', {
          expectedSize: bytesToDownload,
          actualSize: newChunk?.length || 0
        });
        throw new Error('Downloaded chunk is empty');
      }

      // Append to local file
      const appendStartTime = Date.now();
      await this.appendToFile(this.config.localLogFile, newChunk);
      const appendDuration = Date.now() - appendStartTime;
      console.log(`[DriveSync] File append completed in ${appendDuration}ms`);

      const totalDuration = Date.now() - syncStartTime;
      console.log(`[DriveSync] Incremental sync completed successfully in ${totalDuration}ms - Downloaded and appended ${newChunk.length} bytes`);

      return {
        downloaded: true,
        bytesDownloaded: newChunk.length,
        newChunk: newChunk,
      };
    } catch (error) {
      const totalDuration = Date.now() - syncStartTime;
      console.error('[DriveSync] Error during incremental sync:', {
        message: error.message,
        statusCode: error.statusCode,
        duration: totalDuration,
        localFile: this.config.localLogFile,
        fileId: this.currentFileId,
        stack: error.stack
      });
      throw error;
    }
  }
}

// ============================================================================
// LogReverser - Log reversal logic
// ============================================================================

class LogReverser {
  constructor(config) {
    this.config = config;
  }

  /**
   * Reverse lines in a buffer chunk
   */
  reverseChunk(chunk) {
    try {
      if (!chunk || chunk.length === 0) {
        console.warn('[LogReverser] Empty chunk provided to reverseChunk');
        return '';
      }

      const text = chunk.toString('utf8');
      const originalEndsWithNewline = text.endsWith('\n');
      const lines = text.split('\n');
      console.log(`[LogReverser] Reversing chunk: ${chunk.length} bytes, ${lines.length} lines, endsWithNewline: ${originalEndsWithNewline}`);
      
      // Filter out empty lines at the end (common when chunking)
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
      
      // Only add trailing newline if the original chunk ended with one
      const result = filteredLines.length > 0
        ? filteredLines.join('\n') + (originalEndsWithNewline ? '\n' : '')
        : '';
      console.log(`[LogReverser] Reversed chunk: ${filteredLines.length} lines, ${result.length} bytes, resultEndsWithNewline: ${result.endsWith('\n')}`);
      return result;
    } catch (error) {
      console.error('[LogReverser] Error reversing chunk:', {
        message: error.message,
        chunkLength: chunk?.length,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Incrementally reverse a new chunk and prepend to reversed log file
   */
  async reverseAndPrepend(newChunk) {
    const startTime = Date.now();
    try {
      if (!newChunk || newChunk.length === 0) {
        console.log('[LogReverser] No chunk provided or chunk is empty, skipping reversal');
        return;
      }

      console.log(`[LogReverser] Starting reversal and prepend for ${newChunk.length} bytes`);
      
      // Reverse the new chunk
      const reverseStartTime = Date.now();
      const reversedChunk = this.reverseChunk(newChunk);
      const reverseDuration = Date.now() - reverseStartTime;
      console.log(`[LogReverser] Chunk reversal completed in ${reverseDuration}ms`);
      
      if (reversedChunk.length === 0) {
        console.log('[LogReverser] No content to reverse in new chunk (empty after processing)');
        return;
      }

      // Prepend to reversed log file
      const prependStartTime = Date.now();
      await this.prependToReversedFile(reversedChunk);
      const prependDuration = Date.now() - prependStartTime;
      
      const totalDuration = Date.now() - startTime;
      console.log(`[LogReverser] Successfully reversed and prepended ${reversedChunk.length} bytes to reversed log (total: ${totalDuration}ms, prepend: ${prependDuration}ms)`);
    } catch (error) {
      const totalDuration = Date.now() - startTime;
      console.error('[LogReverser] Error reversing and prepending chunk:', {
        message: error.message,
        code: error.code,
        chunkLength: newChunk?.length,
        duration: totalDuration,
        reversedFile: this.config.reversedLogFile,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Prepend content to the reversed log file
   */
  async prependToReversedFile(content) {
    try {
      const filePath = this.config.reversedLogFile;
      const dirPath = path.dirname(filePath);
      
      console.log(`[LogReverser] Ensuring directory exists: ${dirPath}`);
      await fs.ensureDir(dirPath);
      
      let existingContent = '';
      let existingSize = 0;
      try {
        existingContent = await fs.readFile(filePath, 'utf8');
        existingSize = existingContent.length;
        console.log(`[LogReverser] Existing reversed file size: ${existingSize} bytes`);
      } catch (error) {
        if (error.code !== 'ENOENT') {
          console.error('[LogReverser] Error reading existing reversed file:', {
            message: error.message,
            code: error.code,
            filePath: filePath,
            stack: error.stack
          });
          throw error;
        }
        console.log(`[LogReverser] Reversed file does not exist, creating new: ${filePath}`);
      }
      
      // Handle prepending with proper newline management
      const newEndsWithNewline = content.endsWith('\n');
      const existingEndsWithNewline = existingContent.length > 0 && existingContent.endsWith('\n');
      
      let newContent;
      if (existingContent.length === 0) {
        newContent = content;
      } else if (newEndsWithNewline && existingEndsWithNewline) {
        // Both end with \n - remove one to avoid double newline
        newContent = content.slice(0, -1) + '\n' + existingContent;
      } else if (newEndsWithNewline && !existingEndsWithNewline) {
        newContent = content + existingContent;
      } else if (!newEndsWithNewline && existingEndsWithNewline) {
        newContent = content + '\n' + existingContent;
      } else {
        newContent = content + '\n' + existingContent;
      }
      const newSize = newContent.length;
      console.log(`[LogReverser] Prepending ${content.length} bytes to reversed file (total will be ${newSize} bytes)`);
      
      await fs.writeFile(filePath, newContent);
      console.log(`[LogReverser] Successfully prepended to reversed file: ${filePath}`);
    } catch (error) {
      console.error('[LogReverser] Error prepending to reversed file:', {
        message: error.message,
        code: error.code,
        filePath: this.config.reversedLogFile,
        contentLength: content?.length,
        stack: error.stack
      });
      throw error;
    }
  }
}

// ============================================================================
// FileArchiver - Archive old log files when switching to new file
// ============================================================================

class FileArchiver {
  constructor(config) {
    this.config = config;
  }

  /**
   * Generate archive filename with timestamp and file ID
   * @param {string} baseName - Base filename (e.g., 'live_log' or 'live_log_reversed')
   * @param {string} fileId - File ID to include in name
   * @returns {string} Archive filename
   */
  generateArchiveFilename(baseName, fileId) {
    const now = new Date();
    const timestamp = now.toISOString()
      .replace(/T/, '_')
      .replace(/:/g, '-')
      .replace(/\..+/, '');
    
    // Truncate file ID to first 20 characters for readability
    const shortFileId = fileId.substring(0, 20);
    
    return `${baseName}_${timestamp}_${shortFileId}.txt`;
  }

  /**
   * Archive old log files when switching to a new file
   * @param {string} oldFileId - File ID of the old file being replaced
   * @returns {Promise<void>}
   */
  async archiveFiles(oldFileId) {
    const archiveStartTime = Date.now();
    try {
      console.log(`[FileArchiver] Starting archive process for old file ID: ${oldFileId}`);
      
      const dataDir = path.dirname(this.config.localLogFile);
      await fs.ensureDir(dataDir);
      
      // Archive live_log.txt
      const liveLogPath = this.config.localLogFile;
      const liveLogArchiveName = this.generateArchiveFilename('live_log', oldFileId);
      const liveLogArchivePath = path.join(dataDir, liveLogArchiveName);
      
      try {
        const liveLogExists = await fs.pathExists(liveLogPath);
        if (liveLogExists) {
          await fs.move(liveLogPath, liveLogArchivePath, { overwrite: false });
          console.log(`[FileArchiver] Archived live_log.txt to: ${liveLogArchiveName}`);
        } else {
          console.log(`[FileArchiver] live_log.txt does not exist, skipping archive`);
        }
      } catch (error) {
        if (error.code === 'EEXIST') {
          console.warn(`[FileArchiver] Archive file already exists: ${liveLogArchiveName}, skipping`);
        } else {
          console.error('[FileArchiver] Error archiving live_log.txt:', {
            message: error.message,
            code: error.code,
            stack: error.stack
          });
          // Continue with other archives even if this fails
        }
      }
      
      // Archive live_log_reversed.txt
      const reversedLogPath = this.config.reversedLogFile;
      const reversedLogArchiveName = this.generateArchiveFilename('live_log_reversed', oldFileId);
      const reversedLogArchivePath = path.join(dataDir, reversedLogArchiveName);
      
      try {
        const reversedLogExists = await fs.pathExists(reversedLogPath);
        if (reversedLogExists) {
          await fs.move(reversedLogPath, reversedLogArchivePath, { overwrite: false });
          console.log(`[FileArchiver] Archived live_log_reversed.txt to: ${reversedLogArchiveName}`);
        } else {
          console.log(`[FileArchiver] live_log_reversed.txt does not exist, skipping archive`);
        }
      } catch (error) {
        if (error.code === 'EEXIST') {
          console.warn(`[FileArchiver] Archive file already exists: ${reversedLogArchiveName}, skipping`);
        } else {
          console.error('[FileArchiver] Error archiving live_log_reversed.txt:', {
            message: error.message,
            code: error.code,
            stack: error.stack
          });
          // Continue even if this fails
        }
      }
      
      // Create new empty files for the new log file
      try {
        await fs.ensureDir(dataDir);
        await fs.writeFile(liveLogPath, '', 'utf8');
        console.log(`[FileArchiver] Created new empty live_log.txt`);
      } catch (error) {
        console.error('[FileArchiver] Error creating new live_log.txt:', {
          message: error.message,
          code: error.code,
          stack: error.stack
        });
        throw error; // This is critical, so throw
      }
      
      try {
        await fs.writeFile(reversedLogPath, '', 'utf8');
        console.log(`[FileArchiver] Created new empty live_log_reversed.txt`);
      } catch (error) {
        console.error('[FileArchiver] Error creating new live_log_reversed.txt:', {
          message: error.message,
          code: error.code,
          stack: error.stack
        });
        throw error; // This is critical, so throw
      }
      
      const archiveDuration = Date.now() - archiveStartTime;
      console.log(`[FileArchiver] Archive process completed successfully in ${archiveDuration}ms`);
    } catch (error) {
      const archiveDuration = Date.now() - archiveStartTime;
      console.error('[FileArchiver] Error during archive process:', {
        message: error.message,
        code: error.code,
        oldFileId: oldFileId,
        duration: archiveDuration,
        stack: error.stack
      });
      throw error;
    }
  }
}

// ============================================================================
// Main sync logic
// ============================================================================

// Initialize components
const stateManager = new FileStateManager(config);
const fileArchiver = new FileArchiver(config);
const driveSync = new DriveSync(config, stateManager);
const logReverser = new LogReverser(config);

// Sync state
let syncInProgress = false;
let syncIntervalId = null;

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
    
    // Step 0: Check for new file in folder (before syncing)
    const checkStartTime = Date.now();
    const fileCheckResult = await driveSync.checkForNewFile();
    const checkDuration = Date.now() - checkStartTime;
    console.log(`[Sync] File check completed in ${checkDuration}ms`);
    
    if (fileCheckResult.hasNewFile) {
      console.log(`[Sync] New file detected: ${fileCheckResult.newFileName} (ID: ${fileCheckResult.newFileId})`);
      console.log(`[Sync] Archiving old files and switching to new file...`);
      
      try {
        // Archive old files
        const archiveStartTime = Date.now();
        await fileArchiver.archiveFiles(fileCheckResult.oldFileId);
        const archiveDuration = Date.now() - archiveStartTime;
        console.log(`[Sync] Archive completed in ${archiveDuration}ms`);
        
        // Switch to new file
        await driveSync.switchToNewFile(fileCheckResult.newFileId, fileCheckResult.newFileName);
        console.log(`[Sync] Successfully switched to new file: ${fileCheckResult.newFileName}`);
      } catch (error) {
        console.error('[Sync] Error during file switch:', {
          message: error.message,
          code: error.code,
          newFileId: fileCheckResult.newFileId,
          oldFileId: fileCheckResult.oldFileId,
          stack: error.stack
        });
        throw error; // Don't proceed with sync if file switch failed
      }
    }
    
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
 * Initialize the system and start periodic syncing
 */
async function initialize() {
  const initStartTime = Date.now();
  try {
    console.log('[Sync] ========================================');
    console.log('[Sync] Initializing EBEAM Log Monitor...');
    console.log('[Sync] ========================================');
    console.log('[Sync] Configuration:');
    if (config.googleDriveFolderId && config.googleDriveFolderId !== 'YOUR_FOLDER_ID_HERE') {
      console.log(`[Sync]   - Folder ID: ${config.googleDriveFolderId} (will find latest file)`);
    } else if (config.googleDriveFileId) {
      console.log(`[Sync]   - File ID: ${config.googleDriveFileId}`);
    } else {
      console.log(`[Sync]   - WARNING: No folder ID or file ID configured!`);
    }
    console.log(`[Sync]   - Local Log: ${config.localLogFile}`);
    console.log(`[Sync]   - Reversed Log: ${config.reversedLogFile}`);
    console.log(`[Sync]   - State File: ${config.syncStateFile}`);
    console.log(`[Sync]   - Update Interval: ${config.updateInterval}ms (${config.updateInterval / 1000}s)`);
    // Show credentials source
    let credsSource = 'none';
    let credsPath = 'NOT SET';
    if (config.credentials && config.credentials.GOOGLE_APPLICATION_CREDENTIALS) {
      credsSource = 'config';
      credsPath = config.credentials.GOOGLE_APPLICATION_CREDENTIALS;
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      credsSource = 'environment variable';
      credsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    }
    console.log(`[Sync]   - Credentials Source: ${credsSource}`);
    console.log(`[Sync]   - Credentials Path: ${credsPath}`);
    console.log('[Sync] ========================================');
    
    // Ensure state file directory exists
    const stateFileDir = path.dirname(config.syncStateFile);
    await fs.ensureDir(stateFileDir);
    console.log(`[Sync] State file directory ensured: ${stateFileDir}`);
    
    // Initialize Google Drive API
    const driveInitStartTime = Date.now();
    await driveSync.initialize();
    const driveInitDuration = Date.now() - driveInitStartTime;
    console.log(`[Sync] Google Drive API initialization completed in ${driveInitDuration}ms`);
    
    // Perform initial sync
    console.log('[Sync] Performing initial sync...');
    const initialSyncStartTime = Date.now();
    await performSync();
    const initialSyncDuration = Date.now() - initialSyncStartTime;
    console.log(`[Sync] Initial sync completed in ${initialSyncDuration}ms`);
    
    // Set up periodic sync
    syncIntervalId = setInterval(async () => {
      try {
        console.log('[Sync] Periodic sync triggered');
        await performSync();
      } catch (error) {
        console.error('[Sync] Periodic sync error:', {
          message: error.message,
          code: error.code,
          stack: error.stack
        });
        // Don't throw - we want periodic syncs to continue even if one fails
      }
    }, config.updateInterval);
    
    const initDuration = Date.now() - initStartTime;
    console.log(`[Sync] Initialization completed successfully in ${initDuration}ms`);
    console.log(`[Sync] Periodic sync enabled (every ${config.updateInterval / 1000} seconds)`);
    console.log('[Sync] Press Ctrl+C to stop');
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

// Graceful shutdown handlers
process.on('SIGINT', () => {
  console.log('\n[Sync] SIGINT received, shutting down gracefully...');
  if (syncIntervalId) {
    clearInterval(syncIntervalId);
    syncIntervalId = null;
  }
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n[Sync] SIGTERM received, shutting down gracefully...');
  if (syncIntervalId) {
    clearInterval(syncIntervalId);
    syncIntervalId = null;
  }
  process.exit(0);
});

// Run if executed directly
if (require.main === module) {
  initialize()
    .then(() => {
      console.log('[Sync] Script started successfully - running periodic sync');
      // Don't exit - keep running for periodic syncs
    })
    .catch((error) => {
      console.error('[Sync] Script failed:', error);
      if (syncIntervalId) {
        clearInterval(syncIntervalId);
      }
      process.exit(1);
    });
}

module.exports = {
  performSync,
  initialize,
  driveSync,
  logReverser,
  stateManager,
  fileArchiver
};
