#!/usr/bin/env node

const { execSync, spawn, exec } = require('child_process');
const path = require('path');
const fs = require('fs');

const args = process.argv.slice(2);
const command = args[0];

if (command !== 'start') {
    console.log(`
Usage: spamming-machine start

This command will start the application. If dependencies are missing,
it will attempt to set them up silently.
`);
    process.exit(1);
}

console.log("Checking prerequisites...");

// Helper for dynamic python location
let pythonCmd = 'python';
try {
    execSync('python --version', { stdio: 'ignore' });
} catch {
    try {
        execSync('python3 --version', { stdio: 'ignore' });
        pythonCmd = 'python3';
    } catch {
        const localAppData = process.env.LOCALAPPDATA;
        const fallbackPython = path.join(localAppData, 'Programs', 'Python', 'Python311', 'python.exe');
        if (fs.existsSync(fallbackPython)) {
            pythonCmd = fallbackPython;
        } else {
            console.log("Running one-time setup...");
            try {
                execSync(`node "${path.join(__dirname, 'setup.js')}"`, { stdio: 'inherit' });
                pythonCmd = fallbackPython;
            } catch {
                console.error("Setup failed. Please run setup manually.");
                process.exit(1);
            }
        }
    }
}

// Ensure FFmpeg is in PATH for the current process
try {
    execSync('ffmpeg -version', { stdio: 'ignore' });
} catch {
    const fallbackFFmpeg = 'C:\\ffmpeg\\ffmpeg-master-latest-win64-gpl\\bin';
    if (fs.existsSync(fallbackFFmpeg)) {
        process.env.PATH = `${process.env.PATH};${fallbackFFmpeg}`;
    } else {
        console.log("Running one-time setup for FFmpeg...");
        try {
            execSync(`node "${path.join(__dirname, 'setup.js')}"`, { stdio: 'inherit' });
        } catch {
            // Handle gracefully
        }
        process.env.PATH = `${process.env.PATH};${fallbackFFmpeg}`;
    }
}

// Check/Install yt-dlp strictly for good measure
try {
    execSync(`"${pythonCmd}" -m pip show yt-dlp`, { stdio: 'ignore' });
} catch (e) {
    console.log("yt-dlp missing inside Python context. Attempting to install...");
    try {
        execSync(`"${pythonCmd}" -m pip install yt-dlp`, { stdio: 'inherit' });
    } catch (e2) { }
}

const reqPath = path.join(__dirname, 'requirements.txt');
if (fs.existsSync(reqPath)) {
    try {
        execSync(`"${pythonCmd}" -m pip install -r "${reqPath}"`, { stdio: 'ignore' });
    } catch (e) { }
}

// 4. Start Server
console.log("Starting backend server...");

const appPath = path.join(__dirname, 'execution', 'app.py');
const serverProcess = spawn(pythonCmd, [appPath], {
    stdio: 'inherit',
    cwd: __dirname
});

setTimeout(() => {
    console.log("Opening browser to http://localhost:5000...");
    const startCmd = process.platform === 'win32' ? 'start' :
        process.platform === 'darwin' ? 'open' : 'xdg-open';
    exec(`${startCmd} http://localhost:5000`);
}, 2000);

// Process event handlers
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
