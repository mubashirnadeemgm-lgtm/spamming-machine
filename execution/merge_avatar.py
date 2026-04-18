"""
merge_avatar.py
Merges YouTube audio with an avatar video using FFmpeg.
- Strips original avatar audio
- Loops avatar video if shorter than audio
- Trims final output to exact audio duration
"""

import subprocess
import os
import json
import sys
import math
import time
import uuid
import re
import shutil

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTPUT_DIR = os.path.join(BASE_DIR, ".tmp", "output")


def ensure_dirs():
    os.makedirs(OUTPUT_DIR, exist_ok=True)


def get_duration(filepath):
    """Get duration of a media file using ffprobe."""
    ffprobe_path = shutil.which("ffprobe")
    if not ffprobe_path:
        raise RuntimeError("ffprobe executable not found. Please ensure FFmpeg is installed and in your PATH.")

    cmd = [
        ffprobe_path,
        "-v", "quiet",
        "-print_format", "json",
        "-show_format",
        filepath
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffprobe failed for {filepath}: {result.stderr}")
    data = json.loads(result.stdout)
    return float(data["format"]["duration"])


def merge_avatar_with_audio(audio_path, avatar_path, ugc_intro_path=None, output_name=None):
    """
    Merge avatar video with YouTube audio.

    Steps:
    1. Get durations of both files
    2. Calculate loop count for avatar video
    3. Loop avatar, strip its audio, overlay YouTube audio, trim to audio length
    4. If UGC intro provided, concatenate it before the merged video

    Args:
        output_name: If provided, used as the base name for the output file (e.g. YouTube video title).

    Returns dict with output file info.
    """
    ensure_dirs()

    # Get durations
    audio_duration = get_duration(audio_path)
    avatar_duration = get_duration(avatar_path)

    if avatar_duration <= 0:
        raise RuntimeError("Avatar video has zero or invalid duration.")

    # Calculate stream_loop count (how many ADDITIONAL times to loop)
    # stream_loop 0 = play once, stream_loop 1 = play twice, etc.
    loops_needed = math.ceil(audio_duration / avatar_duration) - 1
    if loops_needed < 0:
        loops_needed = 0

    # Generate output filename — use the YouTube title if provided
    timestamp = int(time.time())
    unique_id = uuid.uuid4().hex[:8]
    safe_name = None
    if output_name:
        safe_name = re.sub(r'[\\/:*?"<>|]', '', output_name).strip('. ')[:200]

    # If UGC intro will be concatenated, use a temp name for the intermediate merge
    # and save the YouTube title for the final concatenated output
    if ugc_intro_path and os.path.exists(ugc_intro_path):
        merged_filename = f"{timestamp}_{unique_id}_merged_tmp.mp4"
    elif safe_name:
        merged_filename = f"{safe_name}.mp4"
    else:
        merged_filename = f"{timestamp}_{unique_id}_merged.mp4"
    merged_path = os.path.join(OUTPUT_DIR, merged_filename)

    # Normalize video filter (used when UGC intro needs concatenation)
    normalize_vf = "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,fps=30,format=yuv420p"
    has_ugc = ugc_intro_path and os.path.exists(ugc_intro_path)

    # If UGC intro will be concatenated, output the initial merge directly as
    # normalized .ts so we skip a full re-encode pass later
    ffmpeg_path = shutil.which("ffmpeg")
    if not ffmpeg_path:
        raise RuntimeError("ffmpeg executable not found. Please ensure FFmpeg is installed and in your PATH.")

    if has_ugc:
        merged_path = os.path.join(OUTPUT_DIR, f"{timestamp}_{unique_id}_merged.ts")
        cmd = [
            ffmpeg_path, "-y",
            "-stream_loop", str(loops_needed),
            "-i", avatar_path,
            "-i", audio_path,
            "-map", "0:v", "-map", "1:a",
            "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23",
            "-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-ac", "2",
            "-vf", normalize_vf,
            "-bsf:v", "h264_mp4toannexb",
            "-f", "mpegts",
            "-t", str(audio_duration),
            "-shortest",
            "-threads", "0",
            merged_path
        ]
    else:
        cmd = [
            ffmpeg_path, "-y",
            "-stream_loop", str(loops_needed),
            "-i", avatar_path,
            "-i", audio_path,
            "-map", "0:v", "-map", "1:a",
            "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23",
            "-c:a", "aac", "-b:a", "192k",
            "-t", str(audio_duration),
            "-shortest",
            "-movflags", "+faststart",
            "-threads", "0",
            merged_path
        ]

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"FFmpeg merge failed: {result.stderr}")

    # If UGC intro is provided, concatenate intro + merged video
    if has_ugc:
        if safe_name:
            final_filename = f"{safe_name}.mp4"
        else:
            final_filename = f"{timestamp}_{unique_id}_final.mp4"
        final_path = os.path.join(OUTPUT_DIR, final_filename)

        # Re-encode UGC intro to same normalized .ts format (encode #2)
        intro_reencoded = os.path.join(OUTPUT_DIR, f"{timestamp}_{unique_id}_intro.ts")
        reencode_intro_cmd = [
            ffmpeg_path, "-y",
            "-i", ugc_intro_path,
            "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23",
            "-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-ac", "2",
            "-vf", normalize_vf,
            "-bsf:v", "h264_mp4toannexb",
            "-f", "mpegts",
            "-threads", "0",
            intro_reencoded
        ]
        result = subprocess.run(reencode_intro_cmd, capture_output=True, text=True)
        if result.returncode != 0:
            raise RuntimeError(f"FFmpeg intro re-encode failed: {result.stderr}")

        # Concatenate using stream copy — NO re-encoding (fast remux)
        concat_cmd = [
            ffmpeg_path, "-y",
            "-i", f"concat:{intro_reencoded}|{merged_path}",
            "-c", "copy",
            "-movflags", "+faststart",
            final_path
        ]
        result = subprocess.run(concat_cmd, capture_output=True, text=True)
        if result.returncode != 0:
            raise RuntimeError(f"FFmpeg concat failed: {result.stderr}")

        # Clean up intermediate files
        for temp_file in [intro_reencoded, merged_path]:
            if os.path.exists(temp_file):
                os.remove(temp_file)

        return {
            "filepath": final_path,
            "filename": final_filename,
            "audio_duration": audio_duration,
            "avatar_duration": avatar_duration,
            "loops_applied": loops_needed + 1,
            "has_intro": True
        }

    return {
        "filepath": merged_path,
        "filename": merged_filename,
        "audio_duration": audio_duration,
        "avatar_duration": avatar_duration,
        "loops_applied": loops_needed + 1,
        "has_intro": False
    }


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python merge_avatar.py <audio_path> <avatar_path> [ugc_intro_path]")
        sys.exit(1)

    audio = sys.argv[1]
    avatar = sys.argv[2]
    intro = sys.argv[3] if len(sys.argv) > 3 else None

    try:
        result = merge_avatar_with_audio(audio, avatar, intro)
        print(json.dumps(result, indent=2))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
