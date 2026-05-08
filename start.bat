@echo off
echo Installing server dependencies...
cd /d "%~dp0server"
npm install

echo Starting server...
npm start