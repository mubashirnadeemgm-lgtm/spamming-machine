# YouTube Audio × Avatar Video Merge

## Goal
Download audio from a YouTube video, then merge it with a user-uploaded avatar video — looping the avatar video if the audio is longer.

## Inputs
1. **YouTube URL** — any valid YouTube video link
2. **Avatar Video** — user-uploaded video file (mp4, mov, webm)
3. **UGC Intro Video** (optional) — user-uploaded short intro clip

## Tools / Scripts
- `execution/download_audio.py` — downloads audio via yt-dlp
- `execution/merge_avatar.py` — merges audio + looped avatar via FFmpeg
- `execution/app.py` — Flask web server (orchestrates the above)

## Workflow
1. User submits YouTube URL → `download_audio.py` extracts audio as MP3 to `.tmp/audio/`
2. User uploads avatar video (+ optional UGC intro) → saved to `.tmp/uploads/`
3. User clicks "Merge" → `merge_avatar.py`:
   a. Gets audio duration via `ffprobe`
   b. Gets avatar video duration via `ffprobe`
   c. Loops avatar video with `-stream_loop` to cover audio length
   d. Strips original avatar audio, overlays YouTube audio
   e. Trims to exact audio duration with `-t`
   f. Saves output to `.tmp/output/`
4. User downloads the final merged video

## Edge Cases
- **Avatar longer than audio**: no looping needed, video is trimmed to audio length
- **Avatar = 0 duration or corrupt**: return error before processing
- **Invalid YouTube URL**: yt-dlp will fail, catch and return user-friendly error
- **Large files**: Flask default upload limit should be raised (set to 500MB)
- **Temp file cleanup**: `.tmp/` contents can be cleared periodically

## Output
- Final video at `.tmp/output/<timestamp>_merged.mp4`
- Served to user as a downloadable file via `/api/download/<filename>`
