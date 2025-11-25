# Troubleshooting: No Console Output

If you're not seeing any console logs when running `node server.js`, try these solutions:

## Solution 1: Use stderr for initial output (RECOMMENDED)

The server now uses `process.stderr.write()` for initial startup messages because stderr is unbuffered by default. You should see output immediately.

## Solution 2: Run with explicit unbuffered output

```bash
node -u server.js
```

Or:

```bash
NODE_NO_WARNINGS=1 node server.js
```

## Solution 3: Use npm start

```bash
npm start
```

This uses the `--no-warnings` flag which can help with output.

## Solution 4: Check if server is actually running

Even if you don't see logs, the server might be running:

```bash
# Check if port 3000 is in use
lsof -ti:3000

# Test if server responds
curl http://localhost:3000/api/health
```

## Solution 5: Run with explicit output redirection

```bash
node server.js > output.log 2>&1 &
tail -f output.log
```

## Solution 6: Check for hanging processes

If the server appears to hang, it might be stuck loading modules:

```bash
# Kill all node processes
pkill -f "node.*server.js"

# Then try again
node server.js
```

## Why this happens

Node.js buffers stdout when it's not connected to a TTY (terminal). When you pipe output (`| tee`), stdout becomes buffered. The server now uses stderr for critical startup messages since stderr is unbuffered.

## Verify it's working

1. Run: `node server.js`
2. You should immediately see (on stderr):
   ```
   [Server] ========================================
   [Server] SERVER STARTING
   [Server] ========================================
   ```
3. Then you'll see module loading messages
4. Finally, server startup messages

If you still don't see ANY output, there might be an issue with your Node.js installation or terminal.

