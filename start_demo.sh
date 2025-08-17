#!/bin/bash
# start_demo.sh
# This script starts the JWKS server to serve your public key at http://localhost:3000/jwks
# Run this script first, then run 'node index.js' in a separate terminal for your main app.

# Start the JWKS server in the background and log output
node scripts/3_serve_keys.js &
JWKS_PID=$!
echo "JWKS server started with PID $JWKS_PID. Serving keys at http://localhost:3000/jwks"
echo "To stop the JWKS server, run: kill $JWKS_PID"
