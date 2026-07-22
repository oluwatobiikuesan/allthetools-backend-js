#!/bin/bash
# Startup script — runs the bgutil PO Token server (port 4416) and
# the Node.js backend (port 3005) in the same container.
# Used by Render (single-container deploy). In docker-compose, the
# pot-provider service handles the PO Token server separately.

set -e

# Start the PO Token server in the background
echo "Starting bgutil PO Token server on port 4416..."
cd /opt/pot-server/server
deno run --allow-net --allow-env --allow-read --allow-write --allow-ffi src/main.ts &
POT_PID=$!
echo "PO Token server started (PID $POT_PID)"

# Wait a moment for the PO Token server to be ready
sleep 3

# Start the Node.js backend in the foreground
echo "Starting backend server..."
cd /app
exec node server.js