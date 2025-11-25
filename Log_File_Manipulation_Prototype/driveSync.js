/* global process */
/* global Buffer */
// Using raw HTTPS requests like readDriveFile.js (not @googleapis/drive)

const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const https = require('https');
const { GoogleAuth } = require('google-auth-library');

class DriveSync {
  constructor(config) {
    this.config = config;
    this.auth = null;
    this.authClient = null;
    this.token = null;
    this.initialized = false;
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
   * @param {string} path - API path (e.g., '/drive/v3/files/{fileId}?fields=size')
   * @param {Object} options - Additional options (headers, method, etc.)
   * @returns {Promise<{statusCode: number, data: any, headers: Object}>}
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
   * Get the current size of the file on Google Drive
   * @returns {Promise<number>} File size in bytes
   */
  async getRemoteFileSize() {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const fileId = this.config.googleDriveFileId;
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
        fileId: this.config.googleDriveFileId,
        response: error.response,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Download a range of bytes from Google Drive file
   * @param {number} startByte - Starting byte position
   * @param {number} endByte - Ending byte position (inclusive)
   * @returns {Promise<Buffer>} Downloaded data
   */
  async downloadRange(startByte, endByte) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const fileId = this.config.googleDriveFileId;
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
        fileId: this.config.googleDriveFileId,
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
   * @param {string} filePath - Path to local file
   * @returns {Promise<number>} File size in bytes, or 0 if file doesn't exist
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
   * @param {string} filePath - Path to local file
   * @param {Buffer} data - Data to append
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
   * Prepend data to a local file (used for reversed log)
   * @param {string} filePath - Path to local file
   * @param {Buffer} data - Data to prepend
   */
  async prependToFile(filePath, data) {
    try {
      const dirPath = path.dirname(filePath);
      console.log(`[DriveSync] Ensuring directory exists for prepend: ${dirPath}`);
      await fs.ensureDir(dirPath);
      
      let existingContent = '';
      let existingSize = 0;
      try {
        existingContent = await fs.readFile(filePath, 'utf8');
        existingSize = existingContent.length;
        console.log(`[DriveSync] Existing file size: ${existingSize} bytes`);
      } catch (error) {
        if (error.code !== 'ENOENT') {
          console.error('[DriveSync] Error reading existing file for prepend:', {
            message: error.message,
            code: error.code,
            filePath: filePath,
            stack: error.stack
          });
          throw error;
        }
        console.log(`[DriveSync] File does not exist, creating new: ${filePath}`);
      }
      
      const newContent = data.toString() + existingContent;
      console.log(`[DriveSync] Prepending ${data.length} bytes to ${filePath} (total will be ${newContent.length} bytes)`);
      await fs.writeFile(filePath, newContent);
      console.log(`[DriveSync] Successfully prepended data to ${filePath}`);
    } catch (error) {
      console.error('[DriveSync] Error prepending to file:', {
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
   * @returns {Promise<{downloaded: boolean, bytesDownloaded: number, newChunk: Buffer|null}>}
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
        // This could indicate the file was replaced or truncated on Drive
        // For now, we'll just log a warning and skip download
        return { downloaded: false, bytesDownloaded: 0, newChunk: null };
      }

      if (remoteSize === localSize) {
        console.log('[DriveSync] No new data to download - files are in sync');
        return { downloaded: false, bytesDownloaded: 0, newChunk: null };
      }

      const bytesToDownload = remoteSize - localSize;
      console.log(`[DriveSync] Downloading ${bytesToDownload} new bytes (from byte ${localSize} to ${remoteSize - 1})`);

      // Download the new range
      // Note: Google Drive API Range header uses inclusive end byte
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
        fileId: this.config.googleDriveFileId,
        stack: error.stack
      });
      throw error;
    }
  }
}

module.exports = DriveSync;
