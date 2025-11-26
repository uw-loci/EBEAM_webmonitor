# singlefile.js - Standalone Google Drive Log Sync Script

A standalone Node.js script that automatically synchronizes log files from Google Drive, downloads incremental updates, and maintains a reversed log file for efficient newest-first display. All functionality is contained in a single file with no external dependencies on other project files.

## Overview

`singlefile.js` is a self-contained script that:
- Authenticates with Google Drive API using service account credentials
- Monitors a Google Drive file for changes (either a specific file or the latest file in a folder)
- Automatically finds the latest modified file in a folder (if folder ID is provided)
- Downloads only new data (incremental sync) to minimize bandwidth
- Maintains a local copy of the log file
- Creates and maintains a reversed version of the log (newest entries first)
- Automatically syncs every 60 seconds (configurable)

## Features

- ✅ **Standalone Operation**: All logic in one file, no external module dependencies
- ✅ **Folder-Based Selection**: Automatically finds the latest modified file in a Google Drive folder
- ✅ **Direct File Support**: Can also use a specific file ID (backward compatible)
- ✅ **Incremental Sync**: Only downloads new data since last sync
- ✅ **Automatic Reversal**: Maintains a reversed log file for newest-first display
- ✅ **Periodic Updates**: Automatically syncs every 60 seconds
- ✅ **Error Handling**: Comprehensive error handling and logging
- ✅ **Graceful Shutdown**: Handles SIGINT/SIGTERM signals properly
- ✅ **Raw HTTPS Requests**: Uses direct HTTPS calls (no heavy API libraries)

## Requirements

### Node.js
- Node.js version 12 or higher
- npm (Node Package Manager)

### Dependencies
Install the required npm packages:

```bash
npm install fs-extra google-auth-library
```

### Google Cloud Setup
1. **Google Cloud Project**: Create a project in Google Cloud Console
2. **Enable Drive API**: Enable the Google Drive API for your project
3. **Service Account**: Create a service account and download the JSON key file
4. **File/Folder Sharing**: 
   - If using a folder: Share the Google Drive folder with the service account email address
   - If using a direct file: Share the Google Drive file with the service account email address

## Installation

1. **Clone or download** the `singlefile.js` file

2. **Install dependencies**:
   ```bash
   npm install fs-extra google-auth-library
   ```

3. **Configure credentials** (see Configuration section below)

4. **Run the script**:
   ```bash
   node singlefile.js
   ```

## Configuration

Configuration is embedded directly in `singlefile.js`. Edit the `config` object (lines 22-45) to customize:

### Google Drive Folder ID (Recommended)
```javascript
googleDriveFolderId: process.env.GOOGLE_DRIVE_FOLDER_ID || 'YOUR_FOLDER_ID_HERE'
```
- Set via environment variable `GOOGLE_DRIVE_FOLDER_ID`, or
- Edit the default value in the config object
- **Behavior**: The script will automatically find and sync the latest modified file in this folder
- **Priority**: If folder ID is provided, it takes precedence over file ID

### Google Drive File ID (Alternative)
```javascript
googleDriveFileId: process.env.GOOGLE_DRIVE_FILE_ID || null
```
- Set via environment variable `GOOGLE_DRIVE_FILE_ID`, or
- Edit the default value in the config object
- **Behavior**: Syncs a specific file directly (backward compatible)
- **Use Case**: When you want to sync a specific file rather than the latest in a folder

### Credentials Path
```javascript
credentials: {
  GOOGLE_APPLICATION_CREDENTIALS: expandPath('~/path/to/credentials.json')
}
```
- Supports `~` for home directory expansion
- Can also be set via environment variable `GOOGLE_APPLICATION_CREDENTIALS`
- Priority: Environment variable > Config object

### Local File Paths
```javascript
localLogFile: './data/live_log.txt',
reversedLogFile: './data/live_log_reversed.txt'
```
- Adjust paths as needed
- Directories are created automatically if they don't exist

### Update Interval
```javascript
updateInterval: 60000  // milliseconds (60000 = 60 seconds)
```
- Change this value to adjust sync frequency
- Minimum recommended: 10 seconds (10000ms)

## Usage

### Basic Usage
```bash
node singlefile.js
```

The script will:
1. Initialize Google Drive authentication
2. Perform an initial sync
3. Continue running and sync every 60 seconds
4. Log all operations to the console

### Stopping the Script
Press `Ctrl+C` to gracefully stop the script. The script will:
- Complete any ongoing sync operation
- Clear the periodic sync interval
- Exit cleanly

### Environment Variables
You can override configuration using environment variables:

```bash
# Option 1: Use folder ID (recommended - finds latest file automatically)
export GOOGLE_DRIVE_FOLDER_ID="your-folder-id-here"

# Option 2: Use direct file ID (for specific file)
export GOOGLE_DRIVE_FILE_ID="your-file-id-here"

# Set credentials path
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/credentials.json"

# Run the script
node singlefile.js
```

**Note**: If both `GOOGLE_DRIVE_FOLDER_ID` and `GOOGLE_DRIVE_FILE_ID` are set, the folder ID takes precedence.

## How It Works

### 1. Initialization
- Loads configuration (embedded or from environment)
- Authenticates with Google Drive using service account credentials
- Obtains and validates access token
- **If folder ID is provided**: Lists files in the folder and finds the latest modified file
- **If file ID is provided**: Uses that file directly

### 2. Initial Sync
- Gets remote file size from Google Drive (using the found/configured file)
- Compares with local file size
- Downloads any new data (incremental)
- Appends new data to local log file
- Reverses new chunk and prepends to reversed log file

### 3. Periodic Sync
- Every 60 seconds (configurable):
  - Checks for new data on Google Drive
  - Downloads only new bytes (incremental)
  - Updates both local and reversed log files
  - Logs all operations

### 4. File Management
- **Local Log File**: Contains the complete log in original order (oldest to newest)
- **Reversed Log File**: Contains the log in reversed order (newest to oldest) for efficient display

## File Structure

After running, the script creates/maintains:

```
.
├── singlefile.js          # The standalone script
├── data/                  # Created automatically
│   ├── live_log.txt       # Local copy (original order)
│   └── live_log_reversed.txt  # Reversed copy (newest first)
└── credentials.json       # Your Google service account key (not in repo)
```

## Logging

The script provides detailed logging with prefixes:
- `[DriveSync]` - Google Drive operations
- `[LogReverser]` - Log reversal operations
- `[Sync]` - Main sync cycle operations

Example output (using folder ID):
```
[Sync] ========================================
[Sync] Initializing EBEAM Log Monitor...
[Sync] ========================================
[Sync] Configuration:
[Sync]   - Folder ID: 1m7DSuDg87jxYum1pYE-3w2PRo8Qqozou (will find latest file)
[DriveSync] Using credentials from config: ~/credentials.json
[DriveSync] Access token obtained successfully
[DriveSync] Google Drive API initialized successfully
[DriveSync] Using folder ID to find latest file: 1m7DSuDg87jxYum1pYE-3w2PRo8Qqozou
[DriveSync] Listing files in folder: 1m7DSuDg87jxYum1pYE-3w2PRo8Qqozou
[DriveSync] Found 3 files in folder
[DriveSync] Latest modified file: log_2024_11_25.txt (ID: abc123..., Modified: 2024-11-25T18:30:00.000Z)
[DriveSync] Current file ID set to: abc123...
[Sync] Google Drive API initialization completed in 1028ms
[Sync] Performing initial sync...
[DriveSync] Starting incremental sync...
[DriveSync] Remote file size: 1234 bytes
[DriveSync] Local file size: 1000 bytes
[DriveSync] Downloading 234 new bytes...
[Sync] Sync cycle completed successfully in 567ms
[Sync] Periodic sync enabled (every 60 seconds)
```

## Troubleshooting

### Authentication Errors
**Error**: "Failed to obtain access token"
- **Solution**: Verify credentials file path is correct
- **Solution**: Ensure service account JSON file is valid
- **Solution**: Check that the file is shared with the service account email

### Permission Errors
**Error**: "Method doesn't allow unregistered callers"
- **Solution**: Ensure Google Drive API is enabled in your Google Cloud project
- **Solution**: Verify the service account has access to the file
- **Solution**: Share the Google Drive file with the service account email

### File Not Found Errors
**Error**: "Local file does not exist"
- **Solution**: This is normal on first run - files will be created automatically
- **Solution**: Ensure the script has write permissions in the data directory

### Network Errors
**Error**: Connection timeouts or network errors
- **Solution**: Check internet connectivity
- **Solution**: Verify firewall settings allow HTTPS to `www.googleapis.com`
- **Solution**: Check if Google Drive API is accessible from your network

### Sync Not Working
- Check console logs for error messages
- Verify the Google Drive folder ID or file ID is correct
- If using folder ID: Ensure the folder contains files and the service account has access
- If using file ID: Ensure the file exists and the service account has read access
- Ensure the file on Google Drive is being updated
- Check that the service account has read access to the folder/file

### Folder/File Not Found Errors
**Error**: "No files found in folder"
- **Solution**: Verify the folder ID is correct
- **Solution**: Ensure the folder contains at least one file (not just subfolders)
- **Solution**: Check that the service account has access to the folder

**Error**: "Either googleDriveFolderId or googleDriveFileId must be provided"
- **Solution**: Set either `GOOGLE_DRIVE_FOLDER_ID` or `GOOGLE_DRIVE_FILE_ID` in config or environment

## Advanced Configuration

### Custom Update Interval
Edit the `updateInterval` value in the config object:
```javascript
updateInterval: 30000  // 30 seconds
updateInterval: 120000 // 2 minutes
```

### Custom File Paths
Modify the paths in the config object:
```javascript
localLogFile: '/var/log/ebeam/live_log.txt',
reversedLogFile: '/var/log/ebeam/live_log_reversed.txt'
```

### Using Environment Variables
For production deployments, use environment variables:
```bash
# Option 1: Use folder (recommended)
export GOOGLE_DRIVE_FOLDER_ID="your-folder-id"
export GOOGLE_APPLICATION_CREDENTIALS="/secure/path/to/creds.json"
node singlefile.js

# Option 2: Use specific file
export GOOGLE_DRIVE_FILE_ID="your-file-id"
export GOOGLE_APPLICATION_CREDENTIALS="/secure/path/to/creds.json"
node singlefile.js
```

## Security Notes

- **Credentials**: Never commit service account JSON files to version control
- **File Permissions**: Restrict read access to credentials file (chmod 600)
- **Environment Variables**: Use environment variables for sensitive configuration in production
- **Network**: The script makes HTTPS requests to Google APIs - ensure network security

## Limitations

- **Single File**: Monitors one Google Drive file at a time
- **File Selection**: When using folder ID, the file is selected once on startup. If a new file becomes the latest, restart the script to switch to it
- **Read-Only**: Only downloads/syncs - does not upload changes
- **No Conflict Resolution**: Assumes Google Drive is the source of truth
- **Memory**: For very large files, ensure sufficient memory for buffering
- **Folder Contents**: Only files (not subfolders) are considered when finding the latest file

## Performance

- **Incremental Sync**: Only downloads new data, minimizing bandwidth
- **Efficient Reversal**: Only reverses new chunks, not entire file
- **Low Overhead**: Uses raw HTTPS requests (no heavy libraries)
- **Typical Sync Time**: < 1 second for small updates

## License

This script is part of the EBEAM Web Monitor project. Modify and use as needed for your project.

## Support

For issues or questions:
1. Check the troubleshooting section above
2. Review console logs for error messages
3. Verify Google Cloud and Drive API setup
4. Ensure all dependencies are installed correctly

## Changelog

### Version 1.1
- **NEW**: Folder-based file selection - automatically finds the latest modified file in a Google Drive folder
- **NEW**: Support for both folder ID and direct file ID (backward compatible)
- **NEW**: Automatic file discovery on startup
- Improved URL encoding for API requests
- Enhanced logging for file selection process

### Version 1.0
- Initial standalone version
- Incremental sync functionality
- Automatic log reversal
- Periodic sync every 60 seconds
- Graceful shutdown handling

