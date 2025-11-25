# EBEAM Log Monitor

An efficient log file monitoring system that syncs large, continuously growing log files from Google Drive and displays them in a web interface with pagination. The system uses incremental downloads and maintains both normal and reversed versions of the log file for optimal performance.

## Features

- ✅ **Incremental Downloads**: Only downloads new bytes from Google Drive, not the entire file
- ✅ **Efficient Reversal**: Maintains a reversed version (newest-first) for fast display
- ✅ **Automatic Sync**: Periodically syncs with Google Drive (every minute by default)
- ✅ **Web Interface**: Beautiful, modern UI with pagination controls
- ✅ **Real-time Stats**: Monitor sync status, total lines, and last sync time
- ✅ **Manual Sync**: Trigger syncs on-demand via the web interface

## Architecture

```
Google Drive (Log File)
        ↓ (Range Download)
Local Cache: live_log.txt
        ↓ (Incremental Reversal)
Local View: live_log_reversed.txt
        ↓
Node.js (Express) → Frontend (paginated newest-first logs)
```

## Prerequisites

- Node.js (v14 or higher)
- Google Cloud Project with Drive API enabled
- Service Account credentials with Drive API access

## Setup Instructions

### 1. Install Dependencies

```bash
npm install
```

### 2. Set Up Google Drive API

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the **Google Drive API**
4. Create a **Service Account**:
   - Go to "IAM & Admin" → "Service Accounts"
   - Click "Create Service Account"
   - Give it a name and create
   - Click on the service account → "Keys" → "Add Key" → "Create new key" → JSON
   - Save the JSON file securely

5. Share your log file with the service account:
   - Open the JSON file and copy the `client_email` value
   - In Google Drive, right-click your log file → "Share"
   - Add the service account email with "Viewer" permissions

### 3. Configure the Application

Set the following environment variables:

```bash
# Path to your service account JSON file
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/your/service-account-key.json"

# Google Drive File ID (found in the file's shareable link)
export GOOGLE_DRIVE_FILE_ID="your-file-id-here"

# Optional: Server port (default: 3000)
export PORT=3000
```

Alternatively, you can edit `config.js` directly, though environment variables are recommended for security.

### 4. Get Your Google Drive File ID

1. Open your log file in Google Drive
2. Right-click → "Get link" or open the share dialog
3. The file ID is in the URL: `https://drive.google.com/file/d/FILE_ID_HERE/view`

### 5. Run the Application

```bash
npm start
```

The server will:
- Initialize the Google Drive API connection
- Perform an initial sync
- Start the web server on `http://localhost:3000`
- Begin periodic syncing (every minute)

### 6. Access the Web Interface

Open your browser and navigate to:
```
http://localhost:3000
```

## Configuration

Edit `config.js` to customize:

- `googleDriveFileId`: Your Google Drive file ID
- `localLogFile`: Path to store the normal log file (default: `./data/live_log.txt`)
- `reversedLogFile`: Path to store the reversed log file (default: `./data/live_log_reversed.txt`)
- `updateInterval`: Sync interval in milliseconds (default: 60000 = 1 minute)
- `port`: Server port (default: 3000)
- `defaultPageSize`: Default number of lines per page (default: 100)

## API Endpoints

### `GET /api/logs`
Get paginated log lines (newest first).

**Query Parameters:**
- `page` (optional): Page number (default: 1)
- `pageSize` (optional): Lines per page (default: 100, max: 1000)

**Response:**
```json
{
  "lines": ["log line 1", "log line 2", ...],
  "totalLines": 5000,
  "hasMore": true,
  "page": 1,
  "pageSize": 100
}
```

### `GET /api/stats`
Get system statistics.

**Response:**
```json
{
  "localSize": 1048576,
  "reversedSize": 1048576,
  "remoteSize": 1048576,
  "totalLines": 5000,
  "lastSync": "2024-01-01T12:00:00.000Z",
  "syncInProgress": false
}
```

### `POST /api/sync`
Manually trigger a sync operation.

**Response:**
```json
{
  "success": true,
  "message": "Sync completed"
}
```

### `GET /api/health`
Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T12:00:00.000Z"
}
```

## How It Works

### Incremental Download

1. Every minute, the system checks the remote file size on Google Drive
2. Compares it with the local file size
3. If the remote file is larger, downloads only the new bytes using HTTP Range requests
4. Appends the new bytes to `live_log.txt`

### Incremental Reversal

1. After downloading a new chunk, the system reverses only the new portion
2. Prepends the reversed chunk to `live_log_reversed.txt`
3. This ensures the reversed file always starts with the latest logs
4. Time complexity: O(size of new chunk), not O(size of total log)

### Web Display

1. The frontend requests paginated lines from the reversed log file
2. Since the file is already reversed (newest first), reading from the top is efficient
3. Pagination controls allow navigation through the log history

## Module Documentation

This section provides detailed documentation of each module's processes, methods, and integration points for developers who want to integrate these components into other applications.

### server.js - Orchestration and API Layer

**Purpose**: Coordinates the entire system, provides HTTP API endpoints, and manages the sync lifecycle.

**Key Responsibilities**:
- Express.js server setup and routing
- API endpoint definitions
- Sync orchestration and state management
- Periodic sync scheduling
- Error handling and graceful shutdown

**Main Components**:

#### 1. Initialization (`initialize()` function)
- **Process**: 
  1. Loads configuration from `config.js`
  2. Creates instances of `DriveSync` and `LogReverser` classes
  3. Initializes Google Drive API connection via `driveSync.initialize()`
  4. Performs initial sync via `performSync()`
  5. Sets up periodic sync interval using `setInterval()`
- **Error Handling**: Non-blocking - server continues running even if initialization fails
- **Integration Note**: Can be called manually or automatically on server start

#### 2. Sync Orchestration (`performSync()` function)
- **Process**:
  1. Checks if sync is already in progress (prevents concurrent syncs)
  2. Sets `syncInProgress` flag to `true`
  3. Calls `driveSync.syncIncremental()` to download new data
  4. If new data was downloaded, calls `logReverser.reverseAndPrepend(newChunk)`
  5. Updates `lastSyncTime` timestamp
  6. Resets `syncInProgress` flag in `finally` block
- **Return Value**: None (throws on error)
- **State Management**: Uses module-level variables `syncInProgress` and `lastSyncTime`
- **Integration Note**: Can be called manually via `POST /api/sync` or automatically via interval

#### 3. API Endpoints

**`GET /api/logs`**:
- **Process**: 
  1. Validates query parameters (`page`, `pageSize`)
  2. Calls `logReverser.getPaginatedLines(page, pageSize)`
  3. Returns paginated log lines with metadata
- **Integration**: Direct call to `LogReverser.getPaginatedLines()`

**`GET /api/stats`**:
- **Process**:
  1. Reads local file sizes using `fs.stat()`
  2. Calls `driveSync.getRemoteFileSize()` for remote size
  3. Counts total lines in reversed log file
  4. Returns comprehensive statistics object
- **Integration**: Uses both `DriveSync` and direct file operations

**`POST /api/sync`**:
- **Process**:
  1. Checks if sync is in progress (returns 429 if so)
  2. Calls `performSync()`
  3. Returns success/error response
- **Integration**: Direct call to `performSync()` function

**`GET /api/test-drive`**:
- **Process**: Comprehensive diagnostic endpoint that tests:
  1. Credentials configuration
  2. Credentials file existence
  3. DriveSync initialization status
  4. Remote file access
  5. Local file status
- **Integration**: Uses `DriveSync` methods for testing

#### 4. Periodic Sync
- **Implementation**: `setInterval()` callback that calls `performSync()`
- **Interval**: Configurable via `config.updateInterval` (default: 60000ms)
- **Error Handling**: Errors are logged but don't stop future syncs
- **Cleanup**: Interval ID stored in `syncIntervalId` for graceful shutdown

#### 5. Graceful Shutdown
- **Process**: Handles `SIGINT` and `SIGTERM` signals
- **Actions**: Clears sync interval before exiting
- **Integration Note**: Important for production deployments

**Integration Example**:
```javascript
const DriveSync = require('./driveSync.js');
const LogReverser = require('./logReverser.js');
const config = require('./config.js');

const driveSync = new DriveSync(config);
const logReverser = new LogReverser(config);

// Initialize and perform sync
await driveSync.initialize();
const syncResult = await driveSync.syncIncremental();
if (syncResult.downloaded && syncResult.newChunk) {
  await logReverser.reverseAndPrepend(syncResult.newChunk);
}
```

---

### driveSync.js - Google Drive Integration

**Purpose**: Handles all Google Drive API interactions, including authentication, file size checks, and incremental downloads.

**Key Responsibilities**:
- Google Drive API authentication
- Remote file size queries
- Incremental byte-range downloads
- Local file operations (append, prepend, size checks)

**Main Components**:

#### 1. Class: `DriveSync`
- **Constructor**: `new DriveSync(config)`
  - **Parameters**: `config` object (from `config.js`)
  - **Initializes**: `this.config`, `this.drive` (null), `this.initialized` (false)

#### 2. Lazy Loading (`loadGoogleApis()` function)
- **Purpose**: Defers loading of `googleapis` module until needed (reduces startup time)
- **Process**: 
  1. Checks if already loaded
  2. Requires `googleapis` module synchronously
  3. Extracts `google` object from module exports
  4. Sets `googleapisLoaded` flag
- **Return**: `google` object
- **Integration Note**: Called automatically by `initialize()`, but can be called manually

#### 3. Initialization (`async initialize()`)
- **Process**:
  1. Determines credentials path (priority: `config.credentials.GOOGLE_APPLICATION_CREDENTIALS` → `process.env.GOOGLE_APPLICATION_CREDENTIALS`)
  2. Expands `~` in path to home directory if present
  3. Loads `googleapis` module via `loadGoogleApis()`
  4. Creates `GoogleAuth` instance with service account key file
  5. Initializes Drive API v3 client with read-only scope
  6. Sets `this.initialized = true`
- **Error Handling**: Throws descriptive errors if credentials missing or invalid
- **Integration Note**: Must be called before any other methods (or they will auto-initialize)

#### 4. Remote File Operations

**`async getRemoteFileSize()`**:
- **Process**:
  1. Auto-initializes if not already initialized
  2. Calls `drive.files.get()` with `fields: 'size'`
  3. Parses and validates size from response
  4. Returns file size in bytes (number)
- **Return**: `Promise<number>` - File size in bytes
- **Error Handling**: Throws if API call fails or response invalid
- **Integration Note**: Used to determine if new data is available

**`async downloadRange(startByte, endByte)`**:
- **Process**:
  1. Auto-initializes if not already initialized
  2. Constructs HTTP Range header: `bytes=${startByte}-${endByte}`
  3. Calls `drive.files.get()` with `alt: 'media'` and Range header
  4. Handles response as ArrayBuffer, Buffer, or Stream
  5. Converts stream to Buffer if necessary
  6. Validates buffer is not empty
  7. Returns Buffer containing downloaded bytes
- **Parameters**: 
  - `startByte` (number): Starting byte position (inclusive)
  - `endByte` (number): Ending byte position (inclusive)
- **Return**: `Promise<Buffer>` - Downloaded data
- **Error Handling**: Comprehensive error logging with context
- **Integration Note**: Core method for incremental downloads

#### 5. Local File Operations

**`async getLocalFileSize(filePath)`**:
- **Process**:
  1. Uses `fs.stat()` to get file stats
  2. Returns `stats.size` if file exists
  3. Returns `0` if file doesn't exist (ENOENT)
  4. Throws for other errors
- **Parameters**: `filePath` (string) - Path to local file
- **Return**: `Promise<number>` - File size in bytes, or 0 if not found
- **Integration Note**: Used to compare with remote size

**`async appendToFile(filePath, data)`**:
- **Process**:
  1. Ensures directory exists using `fs.ensureDir()`
  2. Appends Buffer data to file using `fs.appendFile()`
- **Parameters**: 
  - `filePath` (string) - Path to local file
  - `data` (Buffer) - Data to append
- **Return**: `Promise<void>`
- **Integration Note**: Used to append new chunks to `live_log.txt`

**`async prependToFile(filePath, data)`**:
- **Process**:
  1. Ensures directory exists
  2. Reads existing file content (if exists)
  3. Prepends new data to existing content
  4. Writes combined content back to file
- **Parameters**: 
  - `filePath` (string) - Path to local file
  - `data` (Buffer) - Data to prepend
- **Return**: `Promise<void>`
- **Integration Note**: Available but not used in current implementation (LogReverser handles prepending)

#### 6. Incremental Sync (`async syncIncremental()`)
- **Process**:
  1. Gets remote file size via `getRemoteFileSize()`
  2. Gets local file size via `getLocalFileSize()`
  3. Compares sizes:
     - If `remoteSize < localSize`: Logs warning, returns `{downloaded: false, ...}`
     - If `remoteSize === localSize`: Returns `{downloaded: false, ...}` (already in sync)
     - If `remoteSize > localSize`: Proceeds with download
  4. Calculates bytes to download: `remoteSize - localSize`
  5. Downloads range from `localSize` to `remoteSize - 1` via `downloadRange()`
  6. Validates downloaded chunk is not empty
  7. Appends chunk to local file via `appendToFile()`
  8. Returns result object with download status and chunk
- **Return**: `Promise<{downloaded: boolean, bytesDownloaded: number, newChunk: Buffer|null}>`
- **Error Handling**: Comprehensive logging, throws on error
- **Integration Note**: Main method called by `server.js` for syncing

**Integration Example**:
```javascript
const DriveSync = require('./driveSync.js');
const config = require('./config.js');

const driveSync = new DriveSync(config);

// Initialize
await driveSync.initialize();

// Check if sync needed
const remoteSize = await driveSync.getRemoteFileSize();
const localSize = await driveSync.getLocalFileSize(config.localLogFile);

if (remoteSize > localSize) {
  // Download new bytes
  const newChunk = await driveSync.downloadRange(localSize, remoteSize - 1);
  await driveSync.appendToFile(config.localLogFile, newChunk);
}
```

---

### logReverser.js - Log Reversal and Pagination

**Purpose**: Handles reversing log chunks and maintaining a reversed log file for efficient newest-first display.

**Key Responsibilities**:
- Reversing line order in new chunks
- Prepending reversed chunks to reversed log file
- Pagination of reversed log file
- Newline management and edge case handling

**Main Components**:

#### 1. Class: `LogReverser`
- **Constructor**: `new LogReverser(config)`
  - **Parameters**: `config` object (from `config.js`)
  - **Initializes**: `this.config`

#### 2. Chunk Reversal (`reverseChunk(chunk)`)
- **Process**:
  1. Converts Buffer to UTF-8 string
  2. Records if original text ends with newline
  3. Splits text into lines by `\n`
  4. Iterates backwards through lines array
  5. Filters out trailing empty lines (common when chunking)
  6. Preserves non-trailing empty lines (may be intentional)
  7. Joins filtered lines with `\n`
  8. Adds trailing newline only if original had one
- **Parameters**: `chunk` (Buffer) - New chunk of data to reverse
- **Return**: `string` - Reversed lines (newest first) as string
- **Algorithm**: O(n) where n is number of lines in chunk
- **Integration Note**: Pure function, no side effects

#### 3. Incremental Reversal (`async reverseAndPrepend(newChunk)`)
- **Process**:
  1. Validates chunk is not empty
  2. Calls `reverseChunk()` to reverse the chunk
  3. Validates reversed chunk is not empty
  4. Calls `prependToReversedFile()` to prepend reversed chunk
- **Parameters**: `newChunk` (Buffer) - New chunk from download
- **Return**: `Promise<void>`
- **Error Handling**: Comprehensive logging with timing information
- **Integration Note**: Main method called by `server.js` after download

#### 4. File Prepending (`async prependToReversedFile(content)`)
- **Process**:
  1. Ensures directory exists for reversed log file
  2. Reads existing reversed file content (if exists)
  3. Handles newline management between new and existing content:
     - Both end with `\n`: Remove one to avoid double newline
     - New ends with `\n`, existing doesn't: Join directly
     - New doesn't end with `\n`, existing does: Add newline
     - Neither ends with `\n`: Add newline
  4. Prepends new content to existing content
  5. Writes combined content to file
- **Parameters**: `content` (string) - Reversed chunk content to prepend
- **Return**: `Promise<void>`
- **Error Handling**: Handles file not found gracefully (creates new file)
- **Integration Note**: Ensures reversed file always has newest logs at the top

#### 5. Pagination (`async getPaginatedLines(page, pageSize)`)
- **Process**:
  1. Reads entire reversed log file as UTF-8 string
  2. Splits content into lines by `\n`
  3. Filters out trailing empty lines
  4. Calculates pagination indices:
     - `startIndex = (page - 1) * pageSize`
     - `endIndex = startIndex + pageSize`
  5. Slices lines array for requested page
  6. Determines if more pages exist
  7. Returns paginated result object
- **Parameters**: 
  - `page` (number, default: 1) - Page number (1-indexed)
  - `pageSize` (number, default: 100) - Lines per page
- **Return**: `Promise<{lines: string[], totalLines: number, hasMore: boolean, page: number, pageSize: number}>`
- **Error Handling**: Returns empty result if file doesn't exist (ENOENT)
- **Performance**: Reads entire file into memory (suitable for files up to ~100MB)
- **Integration Note**: Used by `GET /api/logs` endpoint

**Integration Example**:
```javascript
const LogReverser = require('./logReverser.js');
const config = require('./config.js');

const logReverser = new LogReverser(config);

// Reverse and prepend new chunk
const newChunk = Buffer.from("line 1\nline 2\nline 3\n");
await logReverser.reverseAndPrepend(newChunk);

// Get paginated lines
const result = await logReverser.getPaginatedLines(1, 100);
console.log(result.lines); // Array of log lines (newest first)
console.log(result.totalLines); // Total number of lines
console.log(result.hasMore); // Whether more pages exist
```

---

### Integration Guide

#### Standalone Integration (Without Express Server)

If you want to use these modules without the Express server:

```javascript
const DriveSync = require('./driveSync.js');
const LogReverser = require('./logReverser.js');
const config = require('./config.js');

// Initialize
const driveSync = new DriveSync(config);
const logReverser = new LogReverser(config);

async function syncAndReverse() {
  try {
    // Initialize Drive API
    await driveSync.initialize();
    
    // Perform incremental sync
    const syncResult = await driveSync.syncIncremental();
    
    // If new data downloaded, reverse and prepend it
    if (syncResult.downloaded && syncResult.newChunk) {
      await logReverser.reverseAndPrepend(syncResult.newChunk);
      console.log(`Synced ${syncResult.bytesDownloaded} bytes`);
    } else {
      console.log('No new data to sync');
    }
  } catch (error) {
    console.error('Sync error:', error);
  }
}

// Run sync
syncAndReverse();

// Set up periodic sync
setInterval(syncAndReverse, config.updateInterval);
```

#### Custom API Integration

To integrate with your own API framework:

```javascript
const DriveSync = require('./driveSync.js');
const LogReverser = require('./logReverser.js');
const config = require('./config.js');

const driveSync = new DriveSync(config);
const logReverser = new LogReverser(config);

// Initialize once
await driveSync.initialize();

// Your API endpoint
app.get('/my-logs', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.pageSize) || 100;
  const result = await logReverser.getPaginatedLines(page, pageSize);
  res.json(result);
});

// Your sync endpoint
app.post('/my-sync', async (req, res) => {
  const syncResult = await driveSync.syncIncremental();
  if (syncResult.downloaded && syncResult.newChunk) {
    await logReverser.reverseAndPrepend(syncResult.newChunk);
  }
  res.json({ success: true, bytesDownloaded: syncResult.bytesDownloaded });
});
```

#### Error Handling Best Practices

1. **DriveSync**: Always check `initialized` status or call `initialize()` before operations
2. **LogReverser**: Handle empty chunks gracefully (they may occur during chunking)
3. **File Operations**: Always ensure directories exist before file operations
4. **Network Operations**: Implement retry logic for Drive API calls in production

#### Performance Considerations

1. **Lazy Loading**: `googleapis` module is loaded only when needed (reduces startup time)
2. **Incremental Operations**: Only processes new data, not entire files
3. **Memory Usage**: `getPaginatedLines()` loads entire file into memory (consider streaming for very large files)
4. **Concurrent Syncs**: `server.js` prevents concurrent syncs using `syncInProgress` flag

## Standalone MVP File

For easy integration into other applications, a single standalone file is provided:

**`ebeamLogSync.js`** - A complete, self-contained module that combines all functionality from `driveSync.js`, `logReverser.js`, and the orchestration logic from `server.js` into one file.

### Quick Start with Standalone File

```javascript
const LogSync = require('./ebeamLogSync.js');

// Create instance
const sync = new LogSync({
  googleDriveFileId: 'your-file-id-here'
  // Credentials from GOOGLE_APPLICATION_CREDENTIALS env var
});

// Initialize and sync
await sync.initialize();
await sync.sync();

// Get paginated logs
const logs = await sync.getPaginatedLines(1, 100);

// Get statistics
const stats = await sync.getStats();
```

### Standalone File API

**`new LogSync(config)`** - Create a new LogSync instance
- `config.googleDriveFileId` - Google Drive file ID (required)
- `config.credentials.GOOGLE_APPLICATION_CREDENTIALS` - Path to credentials JSON (optional, can use env var)
- `config.localLogFile` - Path to local log file (default: `./data/live_log.txt`)
- `config.reversedLogFile` - Path to reversed log file (default: `./data/live_log_reversed.txt`)
- `config.defaultPageSize` - Default page size for pagination (default: 100)

**`await sync.initialize()`** - Initialize Google Drive API connection

**`await sync.sync()`** - Perform incremental sync (downloads new data and reverses it)
- Returns: `{success, downloaded, bytesDownloaded, duration, timestamp}`

**`await sync.getPaginatedLines(page, pageSize)`** - Get paginated log lines (newest first)
- Returns: `{lines, totalLines, hasMore, page, pageSize}`

**`await sync.getStats()`** - Get system statistics
- Returns: `{localSize, reversedSize, remoteSize, totalLines, lastSync, syncInProgress}`

**`sync.isInitialized()`** - Check if system is initialized

See `example_usage.js` for complete integration examples.

## File Structure

```
.
├── ebeamLogSync.js        # ⭐ Standalone MVP file (all-in-one)
├── example_usage.js       # Usage examples for standalone file
├── config.js              # Configuration file
├── driveSync.js           # Google Drive API integration
├── logReverser.js         # Incremental reversal logic
├── server.js              # Express server and sync orchestration
├── package.json           # Dependencies
├── README.md              # This file
├── public/
│   └── index.html         # Web interface
└── data/                  # Created automatically
    ├── live_log.txt       # Normal log file (mirror of Drive)
    └── live_log_reversed.txt  # Reversed log file (newest first)
```

## Troubleshooting

### "GOOGLE_APPLICATION_CREDENTIALS not set"
- Make sure you've set the environment variable pointing to your service account JSON file
- Verify the file path is correct and the file exists

### "Failed to initialize Google Drive API"
- Check that your service account JSON file is valid
- Ensure the Google Drive API is enabled in your Google Cloud project
- Verify the service account has access to the file (shared with the service account email)

### "Error downloading range"
- Check that the file ID is correct
- Verify the service account has "Viewer" permissions on the file
- Ensure your Google Cloud project has Drive API enabled

### No logs appearing
- Wait for the first sync to complete (check console output)
- Verify the log file exists and is accessible on Google Drive
- Check that the file ID in your configuration is correct

## Security Notes

- Never commit your service account JSON file to version control
- Use environment variables for sensitive configuration
- The service account should have minimal permissions (read-only access to the specific file)

## License

ISC


