"""
app.py
Flask web server for YouTube Audio × Avatar Video Merge Tool.
"""

import os
import sys

# Add parent directory so we can import sibling modules
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from flask import Flask, request, jsonify, send_from_directory, render_template, redirect, url_for, session
from werkzeug.utils import secure_filename
import uuid
import time
import json
import random
import shutil
import requests

from download_audio import download_audio
from merge_avatar import merge_avatar_with_audio

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UPLOAD_DIR = os.path.join(BASE_DIR, ".tmp", "uploads")
OUTPUT_DIR = os.path.join(BASE_DIR, ".tmp", "output")
AUDIO_DIR = os.path.join(BASE_DIR, ".tmp", "audio")
CREDITS_FILE = os.path.join(BASE_DIR, ".tmp", "credits.json")

DEFAULT_CREDITS = random.randint(5000, 9999)  # random 5000+ on each restart

app = Flask(
    __name__,
    template_folder=os.path.join(os.path.dirname(__file__), "templates"),
    static_folder=os.path.join(os.path.dirname(__file__), "static")
)
app.secret_key = os.environ.get("SECRET_KEY", "default-dev-secret-key-12345")
app.config["MAX_CONTENT_LENGTH"] = 500 * 1024 * 1024  # 500MB max upload

ALLOWED_VIDEO_EXTENSIONS = {"mp4", "mov", "webm", "avi", "mkv"}

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://oxyfnyhjtksfwzvmcstw.supabase.co")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "sb_publishable_qFSdw6eSOmL0QKAO2x8yWg_tbKAM_-o")

@app.before_request
def require_login():
    allowed_routes = ['login', 'logout', 'static']
    if request.endpoint and request.endpoint not in allowed_routes:
        if 'user' not in session:
            return redirect(url_for('login'))

def ensure_dirs():
    for d in [UPLOAD_DIR, OUTPUT_DIR, AUDIO_DIR]:
        os.makedirs(d, exist_ok=True)


# ===== Credit System =====
def load_credits():
    """Load credits from JSON file."""
    if os.path.exists(CREDITS_FILE):
        with open(CREDITS_FILE, "r") as f:
            return json.load(f)
    return {}


def save_credits(data):
    """Save credits to JSON file."""
    os.makedirs(os.path.dirname(CREDITS_FILE), exist_ok=True)
    with open(CREDITS_FILE, "w") as f:
        json.dump(data, f, indent=2)


def get_user_credits(username):
    """Get credits for a user. Initialize with DEFAULT_CREDITS if new."""
    credits = load_credits()
    if username not in credits:
        credits[username] = DEFAULT_CREDITS
        save_credits(credits)
    return credits[username]


def deduct_credit(username):
    """Deduct 1 credit. Returns new balance or -1 if insufficient."""
    credits = load_credits()
    if username not in credits:
        credits[username] = DEFAULT_CREDITS
    if credits[username] <= 0:
        return -1
    credits[username] -= 1
    save_credits(credits)
    return credits[username]


def allowed_video(filename):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_VIDEO_EXTENSIONS


@app.route("/")
def landing():
    return render_template("landing.html")

@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        email = request.form.get("email")
        password = request.form.get("password")
        
        if not SUPABASE_URL:
            return render_template("login.html", error="Supabase configuration is missing (URL).")

        try:
            url = f"{SUPABASE_URL}/auth/v1/token?grant_type=password"
            response = requests.post(
                url,
                headers={"apikey": SUPABASE_KEY, "Content-Type": "application/json"},
                json={"email": email, "password": password}
            )
            data = response.json()
            if response.status_code == 200 and "access_token" in data:
                session['user'] = data.get("user", {}).get("id", email)
                return redirect(url_for('dashboard'))
            else:
                error_msg = data.get("error_description", "Invalid email or password.")
                return render_template("login.html", error=error_msg)
        except Exception as e:
            return render_template("login.html", error="Login request failed.")

    return render_template("login.html")

@app.route("/logout")
def logout():
    session.pop('user', None)
    return redirect(url_for('login'))


@app.route("/dashboard")
def dashboard():
    return render_template("index.html")


@app.route("/api/credits")
def api_get_credits():
    """Get current credit balance."""
    balance = get_user_credits("default")
    return jsonify({"credits": balance})


@app.route("/api/add-credits", methods=["POST"])
def api_add_credits():
    """Add credits to a user (admin endpoint)."""
    data = request.get_json()
    if not data:
        return jsonify({"error": "No data provided"}), 400
    target_user = data.get("user")
    amount = data.get("amount", 0)
    if not target_user or not isinstance(amount, int) or amount <= 0:
        return jsonify({"error": "Provide valid 'user' and 'amount' (positive int)"}), 400
    credits = load_credits()
    credits[target_user] = credits.get(target_user, 0) + amount
    save_credits(credits)
    return jsonify({"success": True, "user": target_user, "credits": credits[target_user]})


@app.route("/api/download-audio", methods=["POST"])
def api_download_audio():
    """Download audio from YouTube URL."""
    data = request.get_json()
    if not data or "url" not in data:
        return jsonify({"error": "No URL provided"}), 400

    url = data["url"].strip()
    if not url:
        return jsonify({"error": "URL is empty"}), 400

    try:
        result = download_audio(url)
        return jsonify({
            "success": True,
            "filename": result["filename"],
            "duration": result["duration"],
            "duration_formatted": result["duration_formatted"],
            "video_title": result["video_title"],
            "safe_title": result["safe_title"]
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/trim-audio", methods=["POST"])
def api_trim_audio():
    """Trim an already-downloaded audio file using FFmpeg."""
    import subprocess, json as json_mod
    import shutil

    data = request.get_json()
    if not data:
        return jsonify({"error": "No data provided"}), 400

    filename = data.get("filename")
    start_time = data.get("start")  # seconds (float)
    end_time = data.get("end")      # seconds (float)

    if not filename:
        return jsonify({"error": "Filename is required"}), 400

    audio_path = os.path.join(AUDIO_DIR, filename)
    if not os.path.exists(audio_path):
        return jsonify({"error": "Audio file not found"}), 404

    # Build FFmpeg trim command — -ss BEFORE -i for input seeking
    ext = filename.rsplit(".", 1)[1].lower() if "." in filename else "m4a"
    trimmed_path = audio_path + f".trimmed.{ext}"

    start = float(start_time) if start_time is not None else 0
    end = float(end_time) if end_time is not None else None

    ffmpeg_path = shutil.which("ffmpeg")
    if not ffmpeg_path:
        return jsonify({"error": "FFmpeg not found. Please ensure it is installed and in PATH."}), 500

    cmd = [ffmpeg_path, "-y"]
    if start > 0:
        cmd += ["-ss", str(start)]
    cmd += ["-i", audio_path]
    if end is not None and end > start:
        # -t = duration (end minus start), not absolute position
        cmd += ["-t", str(end - start)]
    cmd += ["-c", "copy", trimmed_path]

    try:
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            return jsonify({"error": f"FFmpeg trim failed: {result.stderr}"}), 500

        # Replace original with trimmed version
        os.replace(trimmed_path, audio_path)

        # Get new duration
        ffprobe_path = shutil.which("ffprobe")
        if not ffprobe_path:
            return jsonify({"error": "FFprobe not found. Please ensure FFmpeg is installed and in PATH."}), 500

        probe_cmd = [ffprobe_path, "-v", "quiet", "-print_format", "json", "-show_format", audio_path]
        probe = subprocess.run(probe_cmd, capture_output=True, text=True)
        new_duration = float(json_mod.loads(probe.stdout)["format"]["duration"])
        mins, secs = divmod(int(new_duration), 60)
        hours, mins = divmod(mins, 60)
        fmt = f"{hours}h {mins}m {secs}s" if hours > 0 else f"{mins}m {secs}s"

        return jsonify({
            "success": True,
            "filename": filename,
            "duration": new_duration,
            "duration_formatted": fmt
        })
    except Exception as e:
        # Clean up temp file
        if os.path.exists(trimmed_path):
            os.remove(trimmed_path)
        return jsonify({"error": str(e)}), 500


@app.route("/api/upload-video", methods=["POST"])
def api_upload_video():
    """Upload avatar or UGC intro video."""
    ensure_dirs()

    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    file = request.files["file"]
    video_type = request.form.get("type", "avatar")  # 'avatar' or 'ugc'

    if file.filename == "":
        return jsonify({"error": "No file selected"}), 400

    if not allowed_video(file.filename):
        return jsonify({"error": f"Invalid file type. Allowed: {', '.join(ALLOWED_VIDEO_EXTENSIONS)}"}), 400

    # Generate unique filename
    ext = file.filename.rsplit(".", 1)[1].lower()
    timestamp = int(time.time())
    unique_id = uuid.uuid4().hex[:8]
    filename = f"{timestamp}_{unique_id}_{video_type}.{ext}"
    filepath = os.path.join(UPLOAD_DIR, filename)

    file.save(filepath)

    return jsonify({
        "success": True,
        "filename": filename,
        "type": video_type,
        "size": os.path.getsize(filepath)
    })


@app.route("/api/merge", methods=["POST"])
def api_merge():
    """Merge audio with avatar video. Deducts 1 credit on success."""
    user = "default"
    if get_user_credits(user) <= 0:
        return jsonify({"error": "Insufficient credits."}), 403

    data = request.get_json()
    if not data:
        return jsonify({"error": "No data provided"}), 400

    audio_filename = data.get("audio_filename")
    avatar_filename = data.get("avatar_filename")
    ugc_filename = data.get("ugc_filename")  # optional
    output_name = data.get("output_name")    # YouTube video title

    if not audio_filename or not avatar_filename:
        return jsonify({"error": "Both audio and avatar filenames are required"}), 400

    audio_path = os.path.join(AUDIO_DIR, audio_filename)
    avatar_path = os.path.join(UPLOAD_DIR, avatar_filename)
    ugc_path = os.path.join(UPLOAD_DIR, ugc_filename) if ugc_filename else None

    if not os.path.exists(audio_path):
        return jsonify({"error": "Audio file not found. Please download audio first."}), 404

    if not os.path.exists(avatar_path):
        return jsonify({"error": "Avatar video not found. Please upload it first."}), 404

    if ugc_path and not os.path.exists(ugc_path):
        return jsonify({"error": "UGC intro video not found. Please upload it first."}), 404

    try:
        result = merge_avatar_with_audio(audio_path, avatar_path, ugc_path, output_name=output_name)

        # Deduct 1 credit on successful merge
        new_balance = deduct_credit(user)

        return jsonify({
            "success": True,
            "filename": result["filename"],
            "audio_duration": result["audio_duration"],
            "avatar_duration": result["avatar_duration"],
            "loops_applied": result["loops_applied"],
            "has_intro": result["has_intro"],
            "download_url": f"/api/download/{result['filename']}",
            "credits_remaining": new_balance
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/download/<path:filename>")
def api_download_file(filename):
    """Download the merged output file."""
    return send_from_directory(OUTPUT_DIR, filename, as_attachment=True)


if __name__ == "__main__":
    ensure_dirs()
    # Reset credits on every restart
    if os.path.exists(CREDITS_FILE):
        os.remove(CREDITS_FILE)
    print("=" * 50)
    print("  YouTube Audio × Avatar Video Tool")
    print(f"  Credits this session: {DEFAULT_CREDITS}")
    print("  Open: http://localhost:5000")
    print("=" * 50)
    app.run(debug=True, host="0.0.0.0", port=5000)
