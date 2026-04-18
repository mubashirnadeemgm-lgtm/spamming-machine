/**
 * script.js
 * YouTube Audio × Avatar Merge Tool
 * 5-step flow: Download → Trim → Upload → Pair → Results
 */

const state = {
    currentStep: 1,
    audioTracks: [],   // { url, audioFilename, duration, durationFormatted, videoTitle, safeTitle, status, trimStart, trimEnd }
    avatars: [],       // { filename, originalName }
    ugcFilename: null,
    ugcOriginalName: null,
    mergeResults: [],
    credits: null,
};

// ===== URL Counter =====
document.addEventListener('DOMContentLoaded', () => {
    const ta = document.getElementById('youtube-urls');
    ta.addEventListener('input', updateUrlCount);
    ta.addEventListener('keydown', e => { if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); downloadAllAudio(); } });
    fetchCredits();
});

async function fetchCredits() {
    try {
        const res = await fetch('/api/credits');
        const data = await res.json();
        if (data.credits !== undefined) {
            state.credits = data.credits;
            updateCreditDisplay();
        }
    } catch (e) { /* silent */ }
}

function updateCreditDisplay(animate = false) {
    const el = document.getElementById('credit-count');
    if (!el) return;
    el.textContent = state.credits;
    const badge = document.getElementById('credit-badge');
    badge.classList.remove('low', 'zero');
    if (state.credits <= 0) badge.classList.add('zero');
    else if (state.credits <= 5) badge.classList.add('low');

    // Pop animation on the number
    if (animate) {
        el.classList.remove('pop');
        void el.offsetWidth; // force reflow
        el.classList.add('pop');
    }
}

function showCreditToast(remaining) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'credit-toast';
    const isLow = remaining <= 5;
    toast.innerHTML = `
        <div class="toast-icon ${isLow ? 'warning' : 'deduct'}">-1</div>
        <div class="toast-body">
            <span class="toast-title">Credit Used</span>
            <span class="toast-subtitle">${remaining} credit${remaining !== 1 ? 's' : ''} remaining</span>
        </div>
    `;
    container.appendChild(toast);

    // Auto-dismiss after 3s
    setTimeout(() => {
        toast.classList.add('toast-out');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function updateUrlCount() {
    const urls = getUrls();
    document.getElementById('url-count').textContent = urls.length === 1 ? '1 link' : `${urls.length} links`;
}

function getUrls() {
    const t = document.getElementById('youtube-urls').value.trim();
    return t ? t.split('\n').map(u => u.trim()).filter(u => u.length > 0) : [];
}

// ===== Navigation =====
function goToStep(step) {
    if (step === 2 && state.audioTracks.filter(t => t.status === 'done').length === 0) return;
    if (step === 2) buildTrimUI();
    if (step === 4 && state.avatars.length === 0) return;
    if (step === 4) buildPairingUI();

    state.currentStep = step;
    document.querySelectorAll('.step-panel').forEach(p => p.classList.remove('active'));
    document.getElementById(`step-${step}`).classList.add('active');
    document.querySelectorAll('.step-dot').forEach(dot => {
        const ds = parseInt(dot.dataset.step);
        dot.classList.remove('active', 'completed');
        if (ds === step) dot.classList.add('active');
        else if (ds < step) dot.classList.add('completed');
    });
    document.querySelectorAll('.step-line').forEach((line, i) => line.classList.toggle('active', i + 1 < step));
}

// ===== Step 1: Download =====
async function downloadAllAudio() {
    const urls = getUrls();
    if (!urls.length) return;

    const btn = document.getElementById('btn-download');
    btn.classList.add('loading');
    btn.querySelector('span').textContent = 'Downloading...';

    state.audioTracks = urls.map(url => ({
        url, audioFilename: null, duration: null, durationFormatted: null,
        videoTitle: null, safeTitle: null, status: 'pending', trimStart: 0, trimEnd: null,
    }));

    document.getElementById('bulk-download-progress').style.display = 'block';
    renderDownloadList();
    updateProgress('download', 0, urls.length);

    for (let i = 0; i < state.audioTracks.length; i++) {
        const track = state.audioTracks[i];
        track.status = 'processing';
        renderDownloadList();

        try {
            const res = await fetch('/api/download-audio', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: track.url }),
            });
            const data = await res.json();
            if (!res.ok || data.error) { track.status = 'error'; track.videoTitle = data.error || 'Failed'; }
            else {
                track.status = 'done';
                track.audioFilename = data.filename;
                track.duration = data.duration;
                track.durationFormatted = data.duration_formatted;
                track.videoTitle = data.video_title;
                track.safeTitle = data.safe_title;
                track.trimStart = 0;
                track.trimEnd = data.duration;
            }
        } catch (err) { track.status = 'error'; track.videoTitle = `Error: ${err.message}`; }

        updateProgress('download', i + 1, urls.length);
        renderDownloadList();
    }

    btn.classList.remove('loading');
    btn.querySelector('span').textContent = 'Download All Audio';
    if (state.audioTracks.some(t => t.status === 'done')) setTimeout(() => goToStep(2), 800);
}

function renderDownloadList() {
    document.getElementById('download-item-list').innerHTML = state.audioTracks.map(track => {
        const icon = statusIcon(track.status);
        const title = track.videoTitle || shortenUrl(track.url);
        const meta = track.status === 'done' ? track.durationFormatted : (track.status === 'error' ? 'Failed' : '');
        return `<div class="bulk-item ${track.status === 'processing' ? 'active' : ''} ${track.status}">
            <div class="bulk-item-icon ${track.status}">${icon}</div>
            <span class="bulk-item-title">${esc(title)}</span>
            <span class="bulk-item-status">${meta}</span>
        </div>`;
    }).join('');
}

// ===== Step 2: Trim =====
function buildTrimUI() {
    const tracks = state.audioTracks.filter(t => t.status === 'done');
    const list = document.getElementById('trim-track-list');

    list.innerHTML = tracks.map((track, i) => `
        <div class="trim-track-card">
            <div class="trim-track-header">
                <span class="trim-track-num">${i + 1}</span>
                <div class="trim-track-info">
                    <span class="trim-track-title">${esc(track.videoTitle)}</span>
                    <span class="trim-track-dur">Original: ${fmtDur(track.duration)}</span>
                </div>
            </div>
            <div class="trim-slider-container">
                <div class="trim-slider-track" id="slider-track-${i}">
                    <div class="trim-slider-range" id="slider-range-${i}"></div>
                    <div class="trim-slider-handle trim-handle-start" id="handle-start-${i}" data-index="${i}" data-side="start"></div>
                    <div class="trim-slider-handle trim-handle-end" id="handle-end-${i}" data-index="${i}" data-side="end"></div>
                </div>
                <div class="trim-time-labels">
                    <span class="trim-time-val" id="time-start-${i}">${fmtTime(track.trimStart)}</span>
                    <span class="trim-time-selected" id="time-selected-${i}">${fmtDur(track.trimEnd - track.trimStart)} selected</span>
                    <span class="trim-time-val" id="time-end-${i}">${fmtTime(track.trimEnd)}</span>
                </div>
            </div>
            <div class="trim-action-row">
                <button class="btn btn-trim" id="trim-btn-${i}" onclick="applyTrim(${i})">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                        <circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/>
                        <line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/>
                        <line x1="8.12" y1="8.12" x2="12" y2="12"/>
                    </svg>
                    Apply Trim
                </button>
                <span class="trim-status" id="trim-status-${i}"></span>
            </div>
        </div>
    `).join('');

    // Initialize sliders
    tracks.forEach((track, i) => initSlider(i, track));
}

function initSlider(index, track) {
    const container = document.getElementById(`slider-track-${index}`);
    const handleStart = document.getElementById(`handle-start-${index}`);
    const handleEnd = document.getElementById(`handle-end-${index}`);
    const range = document.getElementById(`slider-range-${index}`);

    const totalDur = track.duration;
    let startPct = (track.trimStart / totalDur) * 100;
    let endPct = (track.trimEnd / totalDur) * 100;

    function updateVisuals() {
        handleStart.style.left = `${startPct}%`;
        handleEnd.style.left = `${endPct}%`;
        range.style.left = `${startPct}%`;
        range.style.width = `${endPct - startPct}%`;

        track.trimStart = (startPct / 100) * totalDur;
        track.trimEnd = (endPct / 100) * totalDur;

        document.getElementById(`time-start-${index}`).textContent = fmtTime(track.trimStart);
        document.getElementById(`time-end-${index}`).textContent = fmtTime(track.trimEnd);
        document.getElementById(`time-selected-${index}`).textContent = `${fmtDur(track.trimEnd - track.trimStart)} selected`;
    }

    updateVisuals();

    function makeDraggable(handle, side) {
        let dragging = false;

        function onDown(e) {
            e.preventDefault();
            dragging = true;
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
            document.addEventListener('touchmove', onMove, { passive: false });
            document.addEventListener('touchend', onUp);
            handle.classList.add('active');
        }

        function onMove(e) {
            if (!dragging) return;
            e.preventDefault();
            const rect = container.getBoundingClientRect();
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            let pct = ((clientX - rect.left) / rect.width) * 100;
            pct = Math.max(0, Math.min(100, pct));

            if (side === 'start') {
                startPct = Math.min(pct, endPct - 1);
            } else {
                endPct = Math.max(pct, startPct + 1);
            }
            updateVisuals();
        }

        function onUp() {
            dragging = false;
            handle.classList.remove('active');
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            document.removeEventListener('touchmove', onMove);
            document.removeEventListener('touchend', onUp);
        }

        handle.addEventListener('mousedown', onDown);
        handle.addEventListener('touchstart', onDown, { passive: false });
    }

    makeDraggable(handleStart, 'start');
    makeDraggable(handleEnd, 'end');
}

async function applyTrim(index) {
    const track = state.audioTracks.filter(t => t.status === 'done')[index];
    const btn = document.getElementById(`trim-btn-${index}`);
    const statusEl = document.getElementById(`trim-status-${index}`);

    if (track.trimStart <= 0 && track.trimEnd >= track.duration - 0.5) {
        statusEl.textContent = 'No trim needed';
        statusEl.className = 'trim-status';
        setTimeout(() => { statusEl.textContent = ''; }, 2000);
        return;
    }

    btn.classList.add('loading');
    statusEl.textContent = 'Trimming...';
    statusEl.className = 'trim-status';

    try {
        const res = await fetch('/api/trim-audio', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                filename: track.audioFilename,
                start: track.trimStart > 0 ? track.trimStart : null,
                end: track.trimEnd < track.duration ? track.trimEnd : null,
            }),
        });
        const data = await res.json();
        if (!res.ok || data.error) {
            statusEl.textContent = 'Trim failed!';
            statusEl.className = 'trim-status error';
        } else {
            track.duration = data.duration;
            track.durationFormatted = data.duration_formatted;
            track.trimStart = 0;
            track.trimEnd = data.duration;
            statusEl.textContent = `✓ Trimmed to ${data.duration_formatted}`;
            statusEl.className = 'trim-status success';
            // Re-init slider with new duration
            initSlider(index, track);
            document.querySelector(`#trim-btn-${index}`).closest('.trim-track-card').querySelector('.trim-track-dur').textContent = `Duration: ${data.duration_formatted}`;
        }
    } catch (err) {
        statusEl.textContent = 'Error!';
        statusEl.className = 'trim-status error';
    }

    btn.classList.remove('loading');
}

// ===== Step 3: Upload =====
function handleUgcSelect(input) { if (input.files.length > 0) uploadFile(input.files[0], 'ugc'); }

function removeUgc() {
    state.ugcFilename = null;
    state.ugcOriginalName = null;
    document.getElementById('ugc-content').style.display = '';
    document.getElementById('ugc-success').style.display = 'none';
    document.getElementById('ugc-zone').classList.remove('has-file');
    document.getElementById('ugc-input').value = '';
}

function handleAvatarSelect(input) { for (const f of input.files) uploadFile(f, 'avatar'); input.value = ''; }

async function uploadFile(file, type) {
    showStatus('upload', `Uploading ${file.name}...`, false);
    const fd = new FormData();
    fd.append('file', file);
    fd.append('type', type);

    try {
        const res = await fetch('/api/upload-video', { method: 'POST', body: fd });
        const data = await res.json();
        if (!res.ok || data.error) { showStatus('upload', `Error: ${data.error || 'Unknown'}`, true); return; }

        if (type === 'ugc') {
            state.ugcFilename = data.filename;
            state.ugcOriginalName = file.name;
            document.getElementById('ugc-content').style.display = 'none';
            document.getElementById('ugc-success').style.display = 'flex';
            document.getElementById('ugc-filename').textContent = file.name;
            document.getElementById('ugc-zone').classList.add('has-file');
        } else {
            state.avatars.push({ filename: data.filename, originalName: file.name });
            renderAvatarList();
        }
        hideElement('upload-status');
        updateStep3Continue();
    } catch (err) { showStatus('upload', `Network error: ${err.message}`, true); }
}

function removeAvatar(i) { state.avatars.splice(i, 1); renderAvatarList(); updateStep3Continue(); }

function renderAvatarList() {
    const list = document.getElementById('avatar-list');
    if (!state.avatars.length) { list.innerHTML = ''; return; }
    list.innerHTML = state.avatars.map((av, i) => `
        <div class="avatar-item">
            <div class="avatar-item-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
                </svg>
            </div>
            <span class="avatar-item-name">${esc(av.originalName)}</span>
            <button class="remove-btn" onclick="removeAvatar(${i})">✕</button>
        </div>
    `).join('');
}

function updateStep3Continue() { document.getElementById('btn-to-step4').disabled = state.avatars.length === 0; }

function handleDragOver(e) { e.preventDefault(); e.currentTarget.classList.add('dragover'); }
function handleDragLeave(e) { e.currentTarget.classList.remove('dragover'); }
function handleDrop(e, type) { e.preventDefault(); e.currentTarget.classList.remove('dragover'); for (const f of e.dataTransfer.files) uploadFile(f, type); }

// ===== Step 4: Pair & Merge =====
const CONCURRENCY = 4;

function buildPairingUI() {
    const tracks = state.audioTracks.filter(t => t.status === 'done');
    const list = document.getElementById('pairing-list');
    const isSingleAudio = tracks.length === 1 && state.avatars.length > 1;
    const isSingleAvatar = state.avatars.length === 1;

    if (isSingleAudio) {
        const track = tracks[0];
        list.innerHTML = `<div class="pairing-mode-label"><span class="pairing-mode-icon">🎵</span> Using audio: <strong>${esc(track.videoTitle)}</strong> (${track.durationFormatted}) for all ${state.avatars.length} avatars</div>` +
            state.avatars.map((av, i) => `
            <div class="pairing-row">
                <div class="pairing-audio"><div class="pairing-num">${i + 1}</div>
                    <div class="pairing-details"><span class="pairing-title">${esc(av.originalName)}</span><span class="pairing-meta">Avatar video</span></div>
                </div>
                <div class="pairing-arrow"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg></div>
                <div class="pairing-avatar"><span class="pairing-fixed">${esc(track.videoTitle)}</span></div>
            </div>`).join('');
    } else if (isSingleAvatar) {
        const av = state.avatars[0];
        list.innerHTML = `<div class="pairing-mode-label"><span class="pairing-mode-icon">🎬</span> Using avatar: <strong>${esc(av.originalName)}</strong> for all ${tracks.length} audio tracks</div>` +
            tracks.map((track, i) => `
            <div class="pairing-row">
                <div class="pairing-audio"><div class="pairing-num">${i + 1}</div>
                    <div class="pairing-details"><span class="pairing-title">${esc(track.videoTitle)}</span><span class="pairing-meta">${track.durationFormatted}</span></div>
                </div>
                <div class="pairing-arrow"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg></div>
                <div class="pairing-avatar"><span class="pairing-fixed">${esc(av.originalName)}</span></div>
            </div>`).join('');
    } else {
        // N×M mode with Select All toggle per audio track
        list.innerHTML = tracks.map((track, i) => {
            const chips = state.avatars.map((av, j) =>
                `<label class="avatar-chip"><input type="checkbox" name="pair-${i}" value="${j}" checked onchange="refreshQueue()"><span class="avatar-chip-label">${esc(av.originalName)}</span></label>`
            ).join('');
            return `
            <div class="pairing-row pairing-row-multi">
                <div class="pairing-audio"><div class="pairing-num">${i + 1}</div>
                    <div class="pairing-details"><span class="pairing-title">${esc(track.videoTitle)}</span><span class="pairing-meta">${track.durationFormatted}</span></div>
                </div>
                <div class="pairing-chips-section">
                    <div class="pairing-chips-header">
                        <span class="pairing-chips-label">Select avatars:</span>
                        <button class="btn-select-toggle" onclick="toggleSelectAll(${i})" id="sel-toggle-${i}">Deselect All</button>
                    </div>
                    <div class="pairing-chips" id="pair-chips-${i}">${chips}</div>
                </div>
            </div>`;
        }).join('');
    }
    // Auto-generate processing order after short delay (so DOM is ready)
    setTimeout(refreshQueue, 50);
}

function toggleSelectAll(trackIdx) {
    const checks = document.querySelectorAll(`input[name="pair-${trackIdx}"]`);
    const allChecked = [...checks].every(c => c.checked);
    checks.forEach(c => { c.checked = !allChecked; });
    document.getElementById(`sel-toggle-${trackIdx}`).textContent = allChecked ? 'Select All' : 'Deselect All';
    refreshQueue();
}

function getMergeJobs() {
    const tracks = state.audioTracks.filter(t => t.status === 'done');
    const isSingleAudio = tracks.length === 1 && state.avatars.length > 1;
    const isSingleAvatar = state.avatars.length === 1;

    if (isSingleAudio) {
        const track = tracks[0];
        return state.avatars.map(av => ({
            audioFilename: track.audioFilename, avatarFilename: av.filename,
            outputName: track.safeTitle ? `${track.safeTitle} - ${av.originalName.replace(/\.[^.]+$/, '')}` : null,
            label: `${track.videoTitle} × ${av.originalName}`,
        }));
    } else if (isSingleAvatar) {
        const av = state.avatars[0];
        return tracks.map(t => ({ audioFilename: t.audioFilename, avatarFilename: av.filename, outputName: t.safeTitle || null, label: t.videoTitle }));
    } else {
        const jobs = [];
        tracks.forEach((track, i) => {
            document.querySelectorAll(`input[name="pair-${i}"]:checked`).forEach(cb => {
                const av = state.avatars[parseInt(cb.value)];
                jobs.push({
                    audioFilename: track.audioFilename, avatarFilename: av.filename,
                    outputName: track.safeTitle ? `${track.safeTitle} - ${av.originalName.replace(/\.[^.]+$/, '')}` : null,
                    label: `${track.videoTitle} × ${av.originalName}`,
                });
            });
        });
        return jobs;
    }
}

// ---- Processing Order Queue ----
let processingQueue = [];

function refreshQueue() {
    processingQueue = getMergeJobs();
    const container = document.getElementById('processing-order');
    if (!processingQueue.length) {
        container.style.display = 'none';
        return;
    }
    container.style.display = 'block';
    document.getElementById('order-count').textContent = `${processingQueue.length} video${processingQueue.length > 1 ? 's' : ''}`;
    renderOrderList();
}

function renderOrderList() {
    document.getElementById('order-list').innerHTML = processingQueue.map((job, i) => `
        <div class="order-item">
            <span class="order-num">${i + 1}</span>
            <span class="order-label">${esc(job.label)}</span>
            <div class="order-btns">
                <button class="order-btn" onclick="moveOrder(${i},-1)" ${i === 0 ? 'disabled' : ''}>↑</button>
                <button class="order-btn" onclick="moveOrder(${i},1)" ${i === processingQueue.length - 1 ? 'disabled' : ''}>↓</button>
            </div>
        </div>
    `).join('');
}

function moveOrder(i, dir) {
    const j = i + dir;
    if (j < 0 || j >= processingQueue.length) return;
    [processingQueue[i], processingQueue[j]] = [processingQueue[j], processingQueue[i]];
    renderOrderList();
}

// ---- Parallel merge ----
async function mergeAllVideos() {
    const jobs = processingQueue.length ? processingQueue : getMergeJobs();
    if (!jobs.length) return;

    // Credit check
    if (state.credits !== null && state.credits < jobs.length) {
        if (state.credits <= 0) {
            alert('You have no credits remaining. Please contact admin to add more.');
            return;
        }
        if (!confirm(`You have ${state.credits} credit${state.credits > 1 ? 's' : ''} but selected ${jobs.length} videos. Only ${state.credits} will be processed. Continue?`)) return;
        jobs.length = state.credits; // trim to available credits
    }

    const btn = document.getElementById('btn-merge');
    btn.classList.add('loading');
    state.mergeResults = [];
    document.getElementById('bulk-merge-progress').style.display = 'block';

    document.getElementById('merge-item-list').innerHTML = jobs.map((job, i) => `
        <div class="bulk-item" id="merge-item-${i}">
            <div class="bulk-item-icon pending" id="merge-icon-${i}">${statusIcon('pending')}</div>
            <span class="bulk-item-title">${esc(job.label)}</span>
            <span class="bulk-item-status" id="merge-status-${i}"></span>
        </div>`).join('');

    updateProgress('merge', 0, jobs.length);

    // Parallel workers with concurrency limit
    let completed = 0;
    let nextIdx = 0;

    async function processJob(i) {
        const job = jobs[i];
        setMergeItemStatus(i, 'processing', 'Merging...');
        try {
            const res = await fetch('/api/merge', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ audio_filename: job.audioFilename, avatar_filename: job.avatarFilename, ugc_filename: state.ugcFilename || null, output_name: job.outputName }),
            });
            const data = await res.json();
            if (!res.ok || data.error) {
                setMergeItemStatus(i, 'error', 'Failed');
                state.mergeResults.push({ index: i, title: job.label, error: data.error });
            } else {
                setMergeItemStatus(i, 'done', fmtDur(data.audio_duration));
                state.mergeResults.push({ index: i, title: job.label, filename: data.filename, downloadUrl: data.download_url, loops: data.loops_applied, duration: data.audio_duration, hasIntro: data.has_intro });
                // Update credits from server response
                if (data.credits_remaining !== undefined) {
                    state.credits = data.credits_remaining;
                    updateCreditDisplay(true);
                    showCreditToast(data.credits_remaining);
                }
            }
        } catch (err) {
            setMergeItemStatus(i, 'error', 'Error');
            state.mergeResults.push({ index: i, title: job.label, error: err.message });
        }
        completed++;
        updateProgress('merge', completed, jobs.length);
    }

    async function worker() {
        while (nextIdx < jobs.length) {
            const myIdx = nextIdx++;
            await processJob(myIdx);
        }
    }

    // Spawn workers up to concurrency limit
    const workers = [];
    for (let w = 0; w < Math.min(CONCURRENCY, jobs.length); w++) {
        workers.push(worker());
    }
    await Promise.all(workers);

    btn.classList.remove('loading');
    setTimeout(() => { renderResults(); goToStep(5); }, 600);
}

function setMergeItemStatus(i, status, text) {
    document.getElementById(`merge-item-${i}`).className = `bulk-item ${status === 'processing' ? 'active' : ''} ${status}`;
    const icon = document.getElementById(`merge-icon-${i}`);
    icon.className = `bulk-item-icon ${status}`;
    icon.innerHTML = statusIcon(status);
    document.getElementById(`merge-status-${i}`).textContent = text;
}

// ===== Step 5: Results =====
function renderResults() {
    const ok = state.mergeResults.filter(r => !r.error);
    if (!ok.length) return;
    document.getElementById('results-list').innerHTML = ok.map((r, i) => `
        <div class="result-card">
            <div class="result-card-header" onclick="toggleCard(${i})">
                <div class="result-card-title"><span class="result-card-num">${i + 1}</span><span class="result-card-name">${esc(r.title)}</span></div>
                <span class="result-card-meta">${fmtDur(r.duration)} · ${r.loops}× loop${r.hasIntro ? ' · intro' : ''}</span>
                <svg class="toggle-icon" id="toggle-${i}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
            </div>
            <div class="result-card-body collapsed" id="result-body-${i}">
                <div class="result-card-player"><video controls playsinline preload="metadata"><source src="${r.downloadUrl}" type="video/mp4"></video></div>
                <div class="result-card-actions"><a class="btn btn-download" href="${r.downloadUrl}" download>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Download</a></div>
            </div>
        </div>`).join('');
}

function toggleCard(i) {
    document.getElementById(`result-body-${i}`).classList.toggle('collapsed');
    document.getElementById(`toggle-${i}`).classList.toggle('expanded');
}

// ===== Utilities =====
function updateProgress(pre, cur, tot) {
    document.getElementById(`${pre}-progress-count`).textContent = `${cur} / ${tot}`;
    document.getElementById(`${pre}-progress-bar`).style.width = `${(cur / tot) * 100}%`;
}

function showStatus(pre, msg, isErr) {
    const c = document.getElementById(`${pre}-status`);
    c.style.display = 'block'; c.classList.toggle('error', isErr);
    document.getElementById(`${pre}-status-text`).textContent = msg;
    document.getElementById(`${pre}-spinner`).classList.toggle('hidden', isErr);
}

function hideElement(id) { document.getElementById(id).style.display = 'none'; }

function fmtDur(s) {
    s = Math.round(s);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return h > 0 ? `${h}h ${m}m ${sec}s` : `${m}m ${sec}s`;
}

function fmtTime(s) {
    s = Math.round(s);
    const m = Math.floor(s / 60), sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
}

function shortenUrl(url) {
    try { return new URL(url).hostname + '...'; } catch { return url.substring(0, 30) + '...'; }
}

function esc(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }

function statusIcon(s) {
    const m = {
        pending: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>',
        processing: '<div class="spinner" style="width:16px;height:16px;border-width:2px;"></div>',
        done: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>',
        error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    };
    return m[s] || '';
}
