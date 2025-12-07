#!/bin/bash

# Shell script to start the pet products ERP application
# This script kills any existing Node.js processes and then starts a new one

# Kill any existing Node.js processes to avoid port conflicts
pkill -f "node" 2>/dev/null || true

# Start the development server (foreground, stop with Ctrl+C)
echo "Starting application. Access it at: http://localhost:5000"
npm run dev
