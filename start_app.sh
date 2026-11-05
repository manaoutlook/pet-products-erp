#!/bin/bash

# Shell script to start the Smart ERP application
# This script kills any existing Node.js processes and then starts a new one

# Kill any existing Node.js processes to avoid port conflicts
pkill -f "node" 2>/dev/null || true

# Print the URL after a short delay so it appears at the end of the startup logs
(sleep 5 && echo -e "\n========================================================\n  Application started. Access it at: http://localhost:5001\n========================================================\n") &

# Start the development server (foreground, stop with Ctrl+C)
npm run dev
