// === MEOWRHINO UKULELE TUNER ===

const STRINGS = {
    G4: { note: 'G', octave: 4, freq: 392.00, string: 4 },
    C4: { note: 'C', octave: 4, freq: 261.63, string: 3 },
    E4: { note: 'E', octave: 4, freq: 329.63, string: 2 },
    A4: { note: 'A', octave: 4, freq: 440.00, string: 1 },
};

const ALL_NOTES = [
    { note: 'C', freq: 261.63 }, { note: 'C#', freq: 277.18 },
    { note: 'D', freq: 293.66 }, { note: 'D#', freq: 311.13 },
    { note: 'E', freq: 329.63 }, { note: 'F', freq: 349.23 },
    { note: 'F#', freq: 369.99 }, { note: 'G', freq: 392.00 },
    { note: 'G#', freq: 415.30 }, { note: 'A', freq: 440.00 },
    { note: 'A#', freq: 466.16 }, { note: 'B', freq: 493.88 },
];

const ELEMENT_MODES = ['fuego', 'agua', 'tierra', 'aire', 'eter'];

// state
let audioCtx = null;
let analyser = null;
let micStream = null;
let isListening = false;
let selectedString = null;
let animFrame = null;
let refOscillator = null;
let isPlayingRef = false;

// DOM
const noteDisplay = document.getElementById('noteDisplay');
const freqDisplay = document.getElementById('freqDisplay');
const meterIndicator = document.getElementById('meterIndicator');
const centsDisplay = document.getElementById('centsDisplay');
const tuningStatus = document.getElementById('tuningStatus');
const micBtn = document.getElementById('micBtn');
const refBtn = document.getElementById('refBtn');
const tunerDisplay = document.getElementById('tunerDisplay');
const settingsBtn = document.getElementById('settingsBtn');
const modalOverlay = document.getElementById('modalOverlay');
const modalClose = document.getElementById('modalClose');
const themeToggle = document.getElementById('themeToggle');
const themeIcon = document.getElementById('themeIcon');
const themeRow = document.getElementById('themeRow');
const modeBtns = document.querySelectorAll('.mode-btn');
const stringBtns = document.querySelectorAll('.string-btn');

// === MODE SYSTEM ===
function initMode() {
    const saved = localStorage.getItem('meowrhino-ukulele-mode') || 'brutal';
    setMode(saved);
}

function setMode(mode) {
    document.documentElement.setAttribute('data-mode', mode);
    localStorage.setItem('meowrhino-ukulele-mode', mode);

    // element modes force dark
    if (ELEMENT_MODES.includes(mode)) {
        document.documentElement.setAttribute('data-theme', 'dark');
        themeRow.classList.add('hidden');
    } else {
        themeRow.classList.remove('hidden');
        const savedTheme = localStorage.getItem('meowrhino-ukulele-theme') || 'light';
        document.documentElement.setAttribute('data-theme', savedTheme);
    }

    updateModeButtons();
    updateThemeIcon();
}

function updateModeButtons() {
    const current = document.documentElement.getAttribute('data-mode');
    modeBtns.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === current);
    });
}

modeBtns.forEach(btn => {
    btn.addEventListener('click', () => setMode(btn.dataset.mode));
});

// === THEME ===
function initTheme() {
    const savedTheme = localStorage.getItem('meowrhino-ukulele-theme') || 'light';
    const mode = document.documentElement.getAttribute('data-mode');
    if (!ELEMENT_MODES.includes(mode)) {
        document.documentElement.setAttribute('data-theme', savedTheme);
    }
    updateThemeIcon();
}

function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('meowrhino-ukulele-theme', next);
    updateThemeIcon();
}

function updateThemeIcon() {
    const theme = document.documentElement.getAttribute('data-theme');
    themeIcon.textContent = theme === 'dark' ? '◑' : '◐';
}

themeToggle.addEventListener('click', toggleTheme);

// === MODAL ===
settingsBtn.addEventListener('click', () => {
    modalOverlay.classList.add('open');
});

modalClose.addEventListener('click', () => {
    modalOverlay.classList.remove('open');
});

modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) modalOverlay.classList.remove('open');
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') modalOverlay.classList.remove('open');
});

// === STRING SELECTION ===
stringBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        const noteKey = btn.dataset.note;

        if (selectedString === noteKey) {
            selectedString = null;
            btn.classList.remove('active');
            if (!isListening) resetDisplay();
            return;
        }

        stringBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        selectedString = noteKey;

        const target = STRINGS[noteKey];
        noteDisplay.textContent = target.note;
        noteDisplay.style.color = '';
        tuningStatus.textContent = `cuerda ${target.string} — ${target.note}${target.octave}`;
        tuningStatus.classList.remove('in-tune');
    });
});

// === MICROPHONE ===
micBtn.addEventListener('click', toggleMic);

async function toggleMic() {
    if (isListening) stopListening();
    else await startListening();
}

async function startListening() {
    try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const source = audioCtx.createMediaStreamSource(micStream);
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 4096;
        source.connect(analyser);
        isListening = true;
        micBtn.classList.add('active');
        micBtn.querySelector('.mic-text').textContent = 'escuchando';
        tuningStatus.textContent = selectedString
            ? `escuchando — cuerda ${STRINGS[selectedString].string}`
            : 'escuchando — modo libre';
        detect();
    } catch (err) {
        tuningStatus.textContent = 'error: micrófono no disponible';
    }
}

function stopListening() {
    isListening = false;
    if (animFrame) cancelAnimationFrame(animFrame);
    if (micStream) { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
    if (audioCtx) { audioCtx.close(); audioCtx = null; }
    micBtn.classList.remove('active');
    micBtn.querySelector('.mic-text').textContent = 'micrófono';
    tunerDisplay.classList.remove('in-tune');
    if (!selectedString) resetDisplay();
}

// === PITCH DETECTION ===
function detect() {
    if (!isListening) return;
    const bufLen = analyser.fftSize;
    const buf = new Float32Array(bufLen);
    analyser.getFloatTimeDomainData(buf);

    let rms = 0;
    for (let i = 0; i < bufLen; i++) rms += buf[i] * buf[i];
    rms = Math.sqrt(rms / bufLen);

    if (rms < 0.01) { animFrame = requestAnimationFrame(detect); return; }

    const pitch = autoCorrelate(buf, audioCtx.sampleRate);
    if (pitch > 0) updateTuner(pitch);
    animFrame = requestAnimationFrame(detect);
}

function autoCorrelate(buf, sampleRate) {
    const SIZE = buf.length;
    const MAX_SAMPLES = Math.floor(SIZE / 2);
    let bestOffset = -1, bestCorrelation = 0, foundGoodCorrelation = false;
    const correlations = new Float32Array(MAX_SAMPLES);
    let lastCorrelation = 1;

    for (let offset = 0; offset < MAX_SAMPLES; offset++) {
        let correlation = 0;
        for (let i = 0; i < MAX_SAMPLES; i++) {
            correlation += Math.abs(buf[i] - buf[i + offset]);
        }
        correlation = 1 - correlation / MAX_SAMPLES;
        correlations[offset] = correlation;

        if (correlation > 0.9 && correlation > lastCorrelation) {
            foundGoodCorrelation = true;
            if (correlation > bestCorrelation) {
                bestCorrelation = correlation;
                bestOffset = offset;
            }
        } else if (foundGoodCorrelation) {
            const shift = (correlations[bestOffset + 1] - correlations[bestOffset - 1]) / correlations[bestOffset];
            return sampleRate / (bestOffset + 8 * shift);
        }
        lastCorrelation = correlation;
    }

    if (bestCorrelation > 0.01) return sampleRate / bestOffset;
    return -1;
}

// === UPDATE TUNER ===
function updateTuner(detectedFreq) {
    let targetFreq, targetNote;
    if (selectedString) {
        targetFreq = STRINGS[selectedString].freq;
        targetNote = STRINGS[selectedString].note;
    } else {
        const closest = findClosestNote(detectedFreq);
        targetFreq = closest.freq;
        targetNote = closest.note;
    }

    const cents = getCents(detectedFreq, targetFreq);
    noteDisplay.textContent = targetNote;
    freqDisplay.textContent = `${detectedFreq.toFixed(1)} Hz`;

    const clampedCents = Math.max(-50, Math.min(50, cents));
    const pct = ((clampedCents + 50) / 100) * 100;
    meterIndicator.style.left = `${pct}%`;

    const sign = cents >= 0 ? '+' : '';
    centsDisplay.textContent = `${sign}${cents.toFixed(0)} cents`;

    const absCents = Math.abs(cents);
    meterIndicator.className = 'meter-indicator';
    tunerDisplay.classList.remove('in-tune');
    tuningStatus.classList.remove('in-tune');

    if (absCents <= 3) {
        meterIndicator.classList.add('in-tune');
        noteDisplay.style.color = 'var(--in-tune)';
        tunerDisplay.classList.add('in-tune');
        tuningStatus.textContent = 'afinado';
        tuningStatus.classList.add('in-tune');
    } else if (absCents <= 15) {
        meterIndicator.classList.add('close');
        noteDisplay.style.color = 'var(--close)';
        tuningStatus.textContent = cents > 0 ? 'un poco alto ♯' : 'un poco bajo ♭';
    } else {
        meterIndicator.classList.add('out-tune');
        noteDisplay.style.color = 'var(--out-tune)';
        tuningStatus.textContent = cents > 0 ? 'muy alto ♯' : 'muy bajo ♭';
    }
}

function findClosestNote(freq) {
    let minDist = Infinity, closest = ALL_NOTES[0];
    for (let oct = 2; oct <= 6; oct++) {
        const mult = Math.pow(2, oct - 4);
        for (const n of ALL_NOTES) {
            const noteFreq = n.freq * mult;
            const dist = Math.abs(getCents(freq, noteFreq));
            if (dist < minDist) { minDist = dist; closest = { note: n.note, freq: noteFreq }; }
        }
    }
    return closest;
}

function getCents(freq, refFreq) {
    return 1200 * Math.log2(freq / refFreq);
}

// === REFERENCE TONE ===
refBtn.addEventListener('click', toggleReferenceTone);

function toggleReferenceTone() {
    if (isPlayingRef) stopReferenceTone();
    else playReferenceTone();
}

function playReferenceTone() {
    if (!selectedString) {
        tuningStatus.textContent = 'selecciona una cuerda';
        return;
    }
    const target = STRINGS[selectedString];
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    refOscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();
    refOscillator.type = 'sine';
    refOscillator.frequency.setValueAtTime(target.freq, ctx.currentTime);
    gainNode.gain.setValueAtTime(0.3, ctx.currentTime);
    refOscillator.connect(gainNode);
    gainNode.connect(ctx.destination);
    refOscillator.start();
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 2);
    refOscillator.stop(ctx.currentTime + 2.1);
    isPlayingRef = true;
    refBtn.querySelector('.ref-text').textContent = `${target.note}${target.octave}...`;
    refOscillator.onended = () => {
        isPlayingRef = false;
        refBtn.querySelector('.ref-text').textContent = 'referencia';
    };
}

function stopReferenceTone() {
    if (refOscillator) { try { refOscillator.stop(); } catch (e) {} refOscillator = null; }
    isPlayingRef = false;
    refBtn.querySelector('.ref-text').textContent = 'referencia';
}

// === RESET ===
function resetDisplay() {
    noteDisplay.textContent = '—';
    noteDisplay.style.color = '';
    freqDisplay.textContent = 'Hz';
    meterIndicator.style.left = '50%';
    meterIndicator.className = 'meter-indicator';
    centsDisplay.textContent = '0 cents';
    tuningStatus.textContent = 'selecciona una cuerda o activa el micrófono';
    tuningStatus.classList.remove('in-tune');
    tunerDisplay.classList.remove('in-tune');
}

// === INIT ===
initMode();
initTheme();
