"""
download_audio.py
Downloads audio-only from a YouTube URL using yt-dlp.
Returns the file path and duration.
"""

import subprocess
import os
import json
import sys
import uuid
import time
import re

# Directories
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AUDIO_DIR = os.path.join(BASE_DIR, ".tmp", "audio")


def ensure_dirs():
    os.makedirs(AUDIO_DIR, exist_ok=True)


def get_audio_duration(filepath):
    """Get duration of an audio file using ffprobe."""
    cmd = [
        "ffprobe",
        "-v", "quiet",
        "-print_format", "json",
        "-show_format",
        filepath
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffprobe failed: {result.stderr}")
    data = json.loads(result.stdout)
    return float(data["format"]["duration"])


def sanitize_filename(name):
    """Remove characters not safe for filenames."""
    name = re.sub(r'[\\/:*?"<>|]', '', name)
    name = name.strip('. ')
    return name[:200] if name else 'untitled'


def get_video_title(url):
    """Fetch the YouTube video title using yt-dlp."""
    cmd = ["yt-dlp", "--print", "title", "--no-playlist", url]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        return "untitled"
    return result.stdout.strip() or "untitled"


def download_audio(url):
    """
    Download audio from a YouTube URL.
    Returns dict with 'filepath', 'filename', 'duration', 'video_title' keys.
    """
    ensure_dirs()

    # Fetch video title first
    video_title = get_video_title(url)

    # Generate unique filename
    timestamp = int(time.time())
    unique_id = uuid.uuid4().hex[:8]
    output_template = os.path.join(AUDIO_DIR, f"{timestamp}_{unique_id}.%(ext)s")

    cmd = [
        "yt-dlp",
        "--extract-audio",
        "--audio-format", "mp3",
        "--audio-quality", "0",
        "--no-playlist",
        "--output", output_template,
        url
    ]

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"yt-dlp failed: {result.stderr}")

    # Find the downloaded file
    expected_pattern = f"{timestamp}_{unique_id}"
    downloaded_file = None
    for f in os.listdir(AUDIO_DIR):
        if f.startswith(expected_pattern) and f.endswith(".mp3"):
            downloaded_file = os.path.join(AUDIO_DIR, f)
            break

    if not downloaded_file or not os.path.exists(downloaded_file):
        raise RuntimeError("Download completed but audio file not found.")

    duration = get_audio_duration(downloaded_file)
    filename = os.path.basename(downloaded_file)

    return {
        "filepath": downloaded_file,
        "filename": filename,
        "duration": duration,
        "duration_formatted": format_duration(duration),
        "video_title": video_title,
        "safe_title": sanitize_filename(video_title)
    }


def format_duration(seconds):
    """Format seconds into MM:SS or HH:MM:SS."""
    seconds = int(seconds)
    h = seconds // 3600
    m = (seconds % 3600) // 60
    s = seconds % 60
    if h > 0:
        return f"{h:02d}:{m:02d}:{s:02d}"
    return f"{m:02d}:{s:02d}"


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python download_audio.py <youtube_url>")
        sys.exit(1)

    url = sys.argv[1]
    try:
        result = download_audio(url)
        print(json.dumps(result, indent=2))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
