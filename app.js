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

const VALID_MODES = ['fuego', 'tierra', 'metal', 'agua', 'madera'];
const VALID_THEMES = ['brutal', 'minimal', 'claro', 'oscuro'];

// state
let audioCtx = null;
let analyser = null;
let micStream = null;
let pitchBuffer = null;
let isListening = false;
let selectedString = null;
let animFrame = null;
let refAudioCtx = null;
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
const modeBtns = document.querySelectorAll('.mode-btn');
const themeBtns = document.querySelectorAll('.theme-btn');
const stringBtns = document.querySelectorAll('.string-btn');

// === MODE + THEME (2-axis) ===
function initSettings() {
    const savedMode = localStorage.getItem('mw-uku-mode');
    const savedTheme = localStorage.getItem('mw-uku-theme');
    setMode(VALID_MODES.includes(savedMode) ? savedMode : 'fuego');
    setTheme(VALID_THEMES.includes(savedTheme) ? savedTheme : 'brutal');
}

function setMode(mode) {
    document.documentElement.setAttribute('data-mode', mode);
    localStorage.setItem('mw-uku-mode', mode);
    modeBtns.forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
}

function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('mw-uku-theme', theme);
    themeBtns.forEach(b => b.classList.toggle('active', b.dataset.theme === theme));
}

modeBtns.forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
themeBtns.forEach(b => b.addEventListener('click', () => setTheme(b.dataset.theme)));

// === MODAL ===
settingsBtn.addEventListener('click', () => modalOverlay.classList.add('open'));
modalClose.addEventListener('click', () => modalOverlay.classList.remove('open'));
modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) modalOverlay.classList.remove('open'); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') modalOverlay.classList.remove('open'); });

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
        await audioCtx.resume();
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const source = audioCtx.createMediaStreamSource(micStream);
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 4096;
        source.connect(analyser);
        pitchBuffer = new Float32Array(analyser.fftSize);
        isListening = true;
        micBtn.classList.add('active');
        micBtn.setAttribute('aria-pressed', 'true');
        micBtn.querySelector('.mic-text').textContent = 'escuchando';
        tuningStatus.textContent = selectedString
            ? `escuchando — cuerda ${STRINGS[selectedString].string}`
            : 'escuchando — modo libre';
        detect();
    } catch (err) {
        console.error('Mic error:', err);
        tuningStatus.textContent = err.name === 'NotAllowedError'
            ? 'error: permiso denegado'
            : 'error: micrófono no disponible';
    }
}

function stopListening() {
    isListening = false;
    if (animFrame) cancelAnimationFrame(animFrame);
    if (micStream) { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
    if (audioCtx) { audioCtx.close(); audioCtx = null; }
    analyser = null;
    pitchBuffer = null;
    micBtn.classList.remove('active');
    micBtn.setAttribute('aria-pressed', 'false');
    micBtn.querySelector('.mic-text').textContent = 'micrófono';
    tunerDisplay.classList.remove('in-tune');
    if (!selectedString) resetDisplay();
}

// === PITCH DETECTION (AMDF + parabolic interpolation) ===
function detect() {
    if (!isListening || !analyser) return;
    analyser.getFloatTimeDomainData(pitchBuffer);

    let rms = 0;
    for (let i = 0; i < pitchBuffer.length; i++) rms += pitchBuffer[i] * pitchBuffer[i];
    rms = Math.sqrt(rms / pitchBuffer.length);

    if (rms < 0.01) { animFrame = requestAnimationFrame(detect); return; }

    const pitch = autoCorrelate(pitchBuffer, audioCtx.sampleRate);
    if (pitch > 0) updateTuner(pitch);
    animFrame = requestAnimationFrame(detect);
}

function autoCorrelate(buf, sampleRate) {
    const SIZE = buf.length;
    const MAX_SAMPLES = Math.floor(SIZE / 2);
    let bestOffset = -1, bestCorrelation = 0, foundGoodCorrelation = false;
    const correlations = new Float32Array(MAX_SAMPLES);
    let lastCorrelation = 1;

    for (let offset = 1; offset < MAX_SAMPLES; offset++) {
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
            if (bestOffset > 1 && bestOffset < MAX_SAMPLES - 1) {
                const a = correlations[bestOffset - 1];
                const b = correlations[bestOffset];
                const c = correlations[bestOffset + 1];
                const denom = a - 2 * b + c;
                const shift = denom !== 0 ? (a - c) / (2 * denom) : 0;
                return sampleRate / (bestOffset + shift);
            }
            return sampleRate / bestOffset;
        }
        lastCorrelation = correlation;
    }

    if (bestCorrelation > 0.5 && bestOffset > 0) return sampleRate / bestOffset;
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
    meterIndicator.style.left = `${clampedCents + 50}%`;

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
        noteDisplay.style.color = '#d97706';
        tuningStatus.textContent = cents > 0 ? 'un poco alto ♯' : 'un poco bajo ♭';
    } else {
        meterIndicator.classList.add('out-tune');
        noteDisplay.style.color = '#dc2626';
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

// === REFERENCE TONE (reuses single AudioContext) ===
refBtn.addEventListener('click', toggleReferenceTone);

function toggleReferenceTone() {
    if (isPlayingRef) stopReferenceTone();
    else playReferenceTone();
}

function playReferenceTone() {
    if (!selectedString) { tuningStatus.textContent = 'selecciona una cuerda'; return; }
    const target = STRINGS[selectedString];

    if (!refAudioCtx || refAudioCtx.state === 'closed') {
        refAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }

    refOscillator = refAudioCtx.createOscillator();
    const gainNode = refAudioCtx.createGain();
    refOscillator.type = 'sine';
    refOscillator.frequency.setValueAtTime(target.freq, refAudioCtx.currentTime);
    gainNode.gain.setValueAtTime(0.3, refAudioCtx.currentTime);
    refOscillator.connect(gainNode);
    gainNode.connect(refAudioCtx.destination);
    refOscillator.start();
    gainNode.gain.exponentialRampToValueAtTime(0.001, refAudioCtx.currentTime + 2);
    refOscillator.stop(refAudioCtx.currentTime + 2.1);

    isPlayingRef = true;
    refBtn.querySelector('.ref-text').textContent = `${target.note}${target.octave}...`;
    refOscillator.onended = () => {
        isPlayingRef = false;
        refBtn.querySelector('.ref-text').textContent = 'referencia';
    };
}

function stopReferenceTone() {
    if (refOscillator) {
        try { refOscillator.stop(); } catch (e) { /* already ended */ }
        refOscillator = null;
    }
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
initSettings();
