@echo off
echo ==============================================
echo Installing Dependencies for Spamming Machine
echo ==============================================

echo Checking for Python...
python --version >nul 2>&1
IF %ERRORLEVEL% NEQ 0 (
    echo Python not found. Installing via winget...
    winget install Python.Python.3.11 --silent --accept-package-agreements --accept-source-agreements
    echo Python installed. You may need to restart your terminal before running spamming-machine start.
) ELSE (
    echo Python is already installed.
)

echo Checking for FFmpeg...
ffmpeg -version >nul 2>&1
IF %ERRORLEVEL% NEQ 0 (
    echo FFmpeg not found. Installing via winget...
    winget install Gyan.FFmpeg -e --silent --accept-package-agreements --accept-source-agreements
    echo FFmpeg installed.
) ELSE (
    echo FFmpeg is already installed.
)

echo Refreshing PATH environment variable for current session...
call refreshenv 2>nul || echo Note: You might need to close and reopen the terminal to access new commands.

echo Installing PIP dependencies...
python -m pip install --upgrade pip
python -m pip install -r requirements.txt

echo ==============================================
echo Installation Complete!
echo You can now run "spamming-machine start"
echo ==============================================
pause
