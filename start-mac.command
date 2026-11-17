#!/bin/bash
# FridgeFit: double-click to start the app on a Mac.
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Install the LTS version from https://nodejs.org and then double-click this file again."
  read -p "Press Enter to close."
  exit 1
fi
[ -d node_modules ] || { echo "Installing what the app needs, one time only..."; npm install; }
[ -f .env ] || cp .env.example .env
(sleep 1; open http://localhost:3000) &
node server.js
