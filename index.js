#!/usr/bin/env node

const { execSync, spawn, exec } = require('child_process');
const path = require('path');
const fs = require('fs');

const args = process.argv.slice(2);
const command = args[0];

if (command !== 'start') {
    console.log(`
Usage: spamming-machine start

This command will:
1. Ensure Python, FFmpeg, and yt-dlp are available.
2. Start the local Flask backend server.
3. Open http://localhost:5000 in your browser.
`);
    process.exit(1);
}

console.log("Checking prerequisites...");

// Check Python
let pythonCmd = 'python';
try {
    execSync('python --version', { stdio: 'ignore' });
} catch (e) {
    try {
        execSync('python3 --version', { stdio: 'ignore' });
        pythonCmd = 'python3';
    } catch (e2) {
        console.error("Error: Python is not installed or not in PATH.");
        console.error("Please run 'install.bat' to install dependencies, or install Python manually.");
        process.exit(1);
    }
}

// Check FFmpeg
try {
    execSync('ffmpeg -version', { stdio: 'ignore' });
} catch (e) {
    console.error("Error: FFmpeg is not installed or not in PATH.");
    console.error("Please run 'install.bat' to install dependencies, or install FFmpeg manually.");
    process.exit(1);
}

// Check/Install yt-dlp
try {
    execSync(`${pythonCmd} -m pip show yt-dlp`, { stdio: 'ignore' });
} catch (e) {
    console.log("yt-dlp not found via pip. Attempting to install...");
    try {
        execSync(`${pythonCmd} -m pip install yt-dlp`, { stdio: 'inherit' });
    } catch (e2) {
        console.error("Error installing yt-dlp. Please install it manually.");
        process.exit(1);
    }
}

// Check Pip dependencies from requirements.txt
try {
    const reqPath = path.join(__dirname, 'requirements.txt');
    if (fs.existsSync(reqPath)) {
        console.log("Verifying other pip dependencies...");
        execSync(`${pythonCmd} -m pip install -r "${reqPath}"`, { stdio: 'ignore' });
    }
} catch(e) {
    console.warn("Warning: Could not verify pip dependencies automatically.");
}

console.log("Starting backend server...");

const appPath = path.join(__dirname, 'execution', 'app.py');
const serverProcess = spawn(pythonCmd, [appPath], { 
    stdio: 'inherit',
    cwd: __dirname
});

// Give it a moment to start, then open the browser
setTimeout(() => {
    console.log("Opening browser to http://localhost:5000...");
    // Use 'start' for Windows, 'open' for Mac, 'xdg-open' for Linux
    const startCmd = process.platform === 'win32' ? 'start' : 
                     process.platform === 'darwin' ? 'open' : 'xdg-open';
    exec(`${startCmd} http://localhost:5000`);
}, 2000);

serverProcess.on('close', (code) => {
    console.log(`Server process exited with code ${code}`);
});

process.on('SIGINT', () => {
    serverProcess.kill('SIGINT');
    process.exit();
});
process.on('SIGTERM', () => {
    serverProcess.kill('SIGTERM');
    process.exit();
});
