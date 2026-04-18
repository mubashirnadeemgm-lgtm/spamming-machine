# Spamming Machine

A YouTube Audio × Avatar Video Merge globally installable tool built with Python/Flask and wrapped as an NPM package.

## Features
- Check for required dependencies (Python, FFmpeg, yt-dlp)
- Automatic browser UI launching
- Works out-of-the-box via CLI

## Prerequisites
- **Windows 10/11**: Recommended for automated dependency installation. (`winget` is used for auto-installs).

## Installation

Install the package globally via NPM:

```bash
npm install -g @mubashir7008/spamming-machine
```

### Windows Setup
If you don't already have Python or FFmpeg installed, the script will prompt you. We have included an `install.bat` inside the package directory for ease:
1. Make sure `python` and `ffmpeg` are in your system PATH.
2. If missing, navigate to the installed directory and run `install.bat` or install them manually.

## Usage

Start the background server and open the browser interface automatically:

```bash
spamming-machine start
```
