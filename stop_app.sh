#!/bin/bash

# Shell script to stop the Smart ERP application

echo "Stopping the application..."
# Kill any existing Node.js processes
pkill -f "node" 2>/dev/null || true

echo ""
echo "========================================================"
echo "  Application fully stopped."
echo "========================================================"
echo ""
