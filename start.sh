#!/bin/bash

echo "Installing server dependencies..."
cd "$(dirname "$0")/server"
npm install

echo "Starting server..."
npm start