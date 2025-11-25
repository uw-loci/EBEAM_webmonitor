#!/bin/bash
# Start script for EBEAM Log Monitor

cd "$(dirname "$0")"

echo "=========================================="
echo "Starting EBEAM Log Monitor Server"
echo "=========================================="
echo ""

# Kill any existing server processes
echo "Checking for existing server processes..."
pkill -f "node.*server.js" 2>/dev/null
sleep 1

# Start the server
echo "Starting server..."
echo ""
node server.js

