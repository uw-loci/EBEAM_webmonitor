# Troubleshooting Guide

## Quick Diagnostic Steps

### 1. Start the Server and Check Console Output

```bash
node server.js
```

You should see:
- `[Server] Starting server on port 3000...`
- `[Server] ========================================`
- `[Server] EBEAM Log Monitor server running!`
- Configuration details
- Initialization status

### 2. Test Basic Server Functionality

Open in your browser:
- **Health Check**: http://localhost:3000/api/health
  - Should return: `{"status":"ok","timestamp":"..."}`

### 3. Test Google Drive Connectivity

Open in your browser:
- **Drive Test**: http://localhost:3000/api/test-drive

This endpoint will test:
1. ✅ Credentials environment variable is set
2. ✅ Credentials file exists
3. ✅ DriveSync can initialize
4. ✅ Can connect to Google Drive API
5. ✅ Can read the remote file
6. ✅ Local file status

The response will show detailed results for each test.

### 4. Check Environment Variables

```bash
echo $GOOGLE_APPLICATION_CREDENTIALS
```

If not set, set it:
```bash
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/your/service-account-key.json"
```

### 5. Verify Credentials File

```bash
# Check if file exists
ls -la $GOOGLE_APPLICATION_CREDENTIALS

# Check if it's valid JSON
cat $GOOGLE_APPLICATION_CREDENTIALS | python -m json.tool
```

### 6. Test Manual Sync

```bash
curl -X POST http://localhost:3000/api/sync
```

Or use the web interface "Manual Sync" button.

### 7. Check Logs

All operations are logged with `[DriveSync]`, `[LogReverser]`, or `[Server]` prefixes. Look for:
- Error messages
- Stack traces
- Operation timing
- File sizes and paths

## Common Issues

### Issue: "GOOGLE_APPLICATION_CREDENTIALS not set"
**Solution**: Set the environment variable before starting the server:
```bash
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/credentials.json"
node server.js
```

### Issue: "Credentials file not found"
**Solution**: 
- Check the file path is correct
- Use absolute path instead of `~`
- Ensure the file has read permissions

### Issue: "Failed to authenticate"
**Solution**:
- Verify the JSON file is valid
- Check the service account email has access to the Drive file
- Ensure Google Drive API is enabled in your Google Cloud project

### Issue: "File not found" or "Permission denied"
**Solution**:
- Share the Google Drive file with the service account email
- Check the file ID in config.js is correct
- Verify the service account has "Viewer" permissions

### Issue: Server starts but no logs appear
**Solution**:
- Check if server is actually running: `lsof -ti:3000`
- Look for errors in the console where you started the server
- Try accessing http://localhost:3000/api/health to verify server is responding

## Diagnostic Endpoints

- `GET /api/health` - Basic server health check
- `GET /api/test-drive` - Comprehensive Google Drive connectivity test
- `GET /api/stats` - Current system statistics
- `POST /api/sync` - Manually trigger a sync

