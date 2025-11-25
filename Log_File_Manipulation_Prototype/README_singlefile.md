# singlefile.js - Standalone Google Drive Log Sync Script

A standalone Node.js script that automatically synchronizes log files from Google Drive, downloads incremental updates, and maintains a reversed log file for efficient newest-first display. All functionality is contained in a single file with no external dependencies on other project files.

## Overview

`singlefile.js` is a self-contained script that:
- Authenticates with Google Drive API using service account credentials
- Monitors a specific Google Drive file for changes
- Downloads only new data (incremental sync) to minimize bandwidth
- Maintains a local copy of the log file
- Creates and maintains a reversed version of the log (newest entries first)
- Automatically syncs every 60 seconds (configurable)

## Features

- ✅ **Standalone Operation**: All logic in one file, no external module dependencies
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
4. **File Sharing**: Share the Google Drive file with the service account email address

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

### Google Drive File ID
```javascript
googleDriveFileId: process.env.GOOGLE_DRIVE_FILE_ID || 'YOUR_FILE_ID_HERE'
```
- Set via environment variable `GOOGLE_DRIVE_FILE_ID`, or
- Edit the default value in the config object

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
# Set Google Drive File ID
export GOOGLE_DRIVE_FILE_ID="your-file-id-here"

# Set credentials path
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/credentials.json"

# Run the script
node singlefile.js
```

## How It Works

### 1. Initialization
- Loads configuration (embedded or from environment)
- Authenticates with Google Drive using service account credentials
- Obtains and validates access token

### 2. Initial Sync
- Gets remote file size from Google Drive
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

Example output:
```
[Sync] ========================================
[Sync] Initializing EBEAM Log Monitor...
[Sync] ========================================
[DriveSync] Using credentials from config: ~/credentials.json
[DriveSync] Access token obtained successfully
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
- Verify the Google Drive file ID is correct
- Ensure the file on Google Drive is being updated
- Check that the service account has read access to the file

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
- **Read-Only**: Only downloads/syncs - does not upload changes
- **No Conflict Resolution**: Assumes Google Drive is the source of truth
- **Memory**: For very large files, ensure sufficient memory for buffering

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

### Version 1.0
- Initial standalone version
- Incremental sync functionality
- Automatic log reversal
- Periodic sync every 60 seconds
- Graceful shutdown handling

