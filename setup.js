const { execSync, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');

// Helper to download files
function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        if (fs.existsSync(dest)) return resolve(dest);
        const file = fs.createWriteStream(dest);
        https.get(url, (response) => {
            if (response.statusCode === 301 || response.statusCode === 302) {
                if (fs.existsSync(dest)) fs.unlinkSync(dest);
                return downloadFile(response.headers.location, dest).then(resolve).catch(reject);
            }
            response.pipe(file);
            file.on('finish', () => {
                file.close(resolve);
            });
        }).on('error', (err) => {
            if (fs.existsSync(dest)) fs.unlinkSync(dest);
            reject(err);
        });
    });
}

async function setup() {
    console.log("=== Spamming Machine Setup ===");
    console.log("This will safely setup dependencies if they are missing.");

    // 1. Setup Python
    let pythonCmd = 'python';
    try {
        execSync('python --version', { stdio: 'ignore' });
        console.log("Python is already installed.");
    } catch {
        try {
            execSync('python3 --version', { stdio: 'ignore' });
            pythonCmd = 'python3';
            console.log("Python3 is already installed.");
        } catch {
            console.log("Python not found. Downloading and installing silently...");
            const pyInstaller = path.join(__dirname, 'python-installer.exe');
            try {
                await downloadFile('https://www.python.org/ftp/python/3.11.9/python-3.11.9-amd64.exe', pyInstaller);
                console.log("Installing Python 3.11 (this may take a minute)...");
                execSync(`"${pyInstaller}" /quiet InstallAllUsers=0 PrependPath=1 Include_test=0`, { stdio: 'inherit' });
                console.log("Python installed successfully.");
            } catch (err) {
                console.error("Failed to install Python automatically:", err.message);
            }

            // Re-evaluate python command path
            const localAppData = process.env.LOCALAPPDATA;
            if (localAppData) {
                pythonCmd = path.join(localAppData, 'Programs', 'Python', 'Python311', 'python.exe');
            }
        }
    }

    // 2. Setup FFmpeg
    try {
        execSync('ffmpeg -version', { stdio: 'ignore' });
        console.log("FFmpeg is already installed.");
    } catch {
        console.log("FFmpeg not found. Downloading and installing...");
        const ffmpegZip = path.join(__dirname, 'ffmpeg.zip');
        const ffmpegDir = path.join('C:\\', 'ffmpeg');

        try {
            await downloadFile('https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip', ffmpegZip);

            console.log("Extracting FFmpeg (this may take a moment)...");
            if (!fs.existsSync(ffmpegDir)) {
                fs.mkdirSync(ffmpegDir, { recursive: true });
            }

            // Extract using powershell
            execSync(`powershell -Command "Expand-Archive -Path '${ffmpegZip}' -DestinationPath '${ffmpegDir}' -Force"`, { stdio: 'inherit' });

            // Add to User PATH
            console.log("Adding FFmpeg to PATH...");
            const binPath = `${ffmpegDir}\\ffmpeg-master-latest-win64-gpl\\bin`;
            const psCommand = `[Environment]::SetEnvironmentVariable('Path', [Environment]::GetEnvironmentVariable('Path', [EnvironmentVariableTarget]::User) + ';${binPath}', [EnvironmentVariableTarget]::User)`;
            execSync(`powershell -Command "${psCommand}"`, { stdio: 'ignore' });
            console.log("FFmpeg installed successfully.");
        } catch (err) {
            console.error("Failed to install FFmpeg automatically:", err.message);
        }
    }

    // 3. Install PIP dependencies
    console.log("Installing python dependencies...");
    try {
        execSync(`"${pythonCmd}" -m pip install --upgrade pip`, { stdio: 'inherit' });
        execSync(`"${pythonCmd}" -m pip install yt-dlp`, { stdio: 'inherit' });

        const reqPath = path.join(__dirname, 'requirements.txt');
        if (fs.existsSync(reqPath)) {
            execSync(`"${pythonCmd}" -m pip install -r "${reqPath}"`, { stdio: 'inherit' });
        }
        console.log("Dependencies installed successfully.");
    } catch (e) {
        console.error("Warning: Failed to install python dependencies automatically.", e.message);
    }

    console.log("=== Setup Complete! ===");
}

if (require.main === module) {
    setup().catch(console.error);
}

module.exports = setup;
