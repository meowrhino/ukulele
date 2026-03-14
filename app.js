// === MEOWRHINO UKULELE TUNER ===

const STRINGS = {
    G4: { note: 'G', octave: 4, freq: 392.00, string: 4 },
    C4: { note: 'C', octave: 4, freq: 261.63, string: 3 },
    E4: { note: 'E', octave: 4, freq: 329.63, string: 2 },
    A4: { note: 'A', octave: 4, freq: 440.00, string: 1 },
};

// all chromatic notes for auto-detect mode
const ALL_NOTES = [
    { note: 'C',  freq: 261.63 },
    { note: 'C#', freq: 277.18 },
    { note: 'D',  freq: 293.66 },
    { note: 'D#', freq: 311.13 },
    { note: 'E',  freq: 329.63 },
    { note: 'F',  freq: 349.23 },
    { note: 'F#', freq: 369.99 },
    { note: 'G',  freq: 392.00 },
    { note: 'G#', freq: 415.30 },
    { note: 'A',  freq: 440.00 },
    { note: 'A#', freq: 466.16 },
    { note: 'B',  freq: 493.88 },
];

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
const themeToggle = document.getElementById('themeToggle');
const stringBtns = document.querySelectorAll('.string-btn');
const tunerDisplay = document.querySelector('.tuner-display');

// === THEME ===
function initTheme() {
    const saved = localStorage.getItem('meowrhino-ukulele-theme');
    if (saved) {
        document.documentElement.setAttribute('data-theme', saved);
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
    document.querySelector('.theme-icon').textContent = theme === 'dark' ? '◑' : '◐';
}

themeToggle.addEventListener('click', toggleTheme);
initTheme();

// === STYLE TOGGLE (brutal / minimal) ===
const styleToggle = document.getElementById('styleToggle');
const styleLabel = document.getElementById('styleLabel');

function initStyle() {
    const saved = localStorage.getItem('meowrhino-ukulele-style') || 'brutal';
    document.documentElement.setAttribute('data-style', saved);
    updateStyleLabel();
}

function toggleStyle() {
    const current = document.documentElement.getAttribute('data-style');
    const next = current === 'minimal' ? 'brutal' : 'minimal';
    document.documentElement.setAttribute('data-style', next);
    localStorage.setItem('meowrhino-ukulele-style', next);
    updateStyleLabel();
}

function updateStyleLabel() {
    const style = document.documentElement.getAttribute('data-style');
    styleLabel.textContent = style === 'minimal' ? 'minimal' : 'brutal';
}

styleToggle.addEventListener('click', toggleStyle);
initStyle();

// === STRING SELECTION ===
stringBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        const noteKey = btn.dataset.note;

        // toggle off if already selected
        if (selectedString === noteKey) {
            selectedString = null;
            btn.classList.remove('active');
            if (!isListening) resetDisplay();
            return;
        }

        // deselect others
        stringBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        selectedString = noteKey;

        // update display to target
        const target = STRINGS[noteKey];
        noteDisplay.textContent = target.note;
        noteDisplay.style.color = '';
        tuningStatus.textContent = `Afinando cuerda ${target.string} — ${target.note}${target.octave}`;
        tuningStatus.classList.remove('in-tune');
    });
});

// === MICROPHONE ===
micBtn.addEventListener('click', toggleMic);

async function toggleMic() {
    if (isListening) {
        stopListening();
    } else {
        await startListening();
    }
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
        micBtn.querySelector('.mic-text').textContent = 'Micrófono activo';
        tuningStatus.textContent = selectedString
            ? `Escuchando — cuerda ${STRINGS[selectedString].string}`
            : 'Escuchando — modo libre';

        detect();
    } catch (err) {
        tuningStatus.textContent = 'Error: no se pudo acceder al micrófono';
        console.error('Mic error:', err);
    }
}

function stopListening() {
    isListening = false;
    if (animFrame) cancelAnimationFrame(animFrame);
    if (micStream) {
        micStream.getTracks().forEach(t => t.stop());
        micStream = null;
    }
    if (audioCtx) {
        audioCtx.close();
        audioCtx = null;
    }
    micBtn.classList.remove('active');
    micBtn.querySelector('.mic-text').textContent = 'Activar micrófono';
    tunerDisplay.classList.remove('in-tune');
    if (!selectedString) resetDisplay();
}

// === PITCH DETECTION (autocorrelation) ===
function detect() {
    if (!isListening) return;

    const bufLen = analyser.fftSize;
    const buf = new Float32Array(bufLen);
    analyser.getFloatTimeDomainData(buf);

    // check if there's signal
    let rms = 0;
    for (let i = 0; i < bufLen; i++) rms += buf[i] * buf[i];
    rms = Math.sqrt(rms / bufLen);

    if (rms < 0.01) {
        // too quiet
        animFrame = requestAnimationFrame(detect);
        return;
    }

    const pitch = autoCorrelate(buf, audioCtx.sampleRate);

    if (pitch > 0) {
        updateTuner(pitch);
    }

    animFrame = requestAnimationFrame(detect);
}

function autoCorrelate(buf, sampleRate) {
    const SIZE = buf.length;
    const MAX_SAMPLES = Math.floor(SIZE / 2);
    let bestOffset = -1;
    let bestCorrelation = 0;
    let foundGoodCorrelation = false;
    const correlations = new Float32Array(MAX_SAMPLES);

    // find the first point where the signal crosses zero (positive to negative)
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
            // past the peak, interpolate
            const shift = (correlations[bestOffset + 1] - correlations[bestOffset - 1]) /
                correlations[bestOffset];
            return sampleRate / (bestOffset + 8 * shift);
        }

        lastCorrelation = correlation;
    }

    if (bestCorrelation > 0.01) {
        return sampleRate / bestOffset;
    }

    return -1;
}

// === UPDATE TUNER DISPLAY ===
function updateTuner(detectedFreq) {
    let targetFreq, targetNote;

    if (selectedString) {
        // locked to specific string
        targetFreq = STRINGS[selectedString].freq;
        targetNote = STRINGS[selectedString].note;
    } else {
        // free mode — find closest note across octaves
        const closest = findClosestNote(detectedFreq);
        targetFreq = closest.freq;
        targetNote = closest.note;
    }

    const cents = getCents(detectedFreq, targetFreq);

    // update note display
    noteDisplay.textContent = targetNote;
    freqDisplay.textContent = `${detectedFreq.toFixed(1)} Hz`;

    // update meter (cents range: -50 to +50)
    const clampedCents = Math.max(-50, Math.min(50, cents));
    const pct = ((clampedCents + 50) / 100) * 100;
    meterIndicator.style.left = `${pct}%`;

    // update cents display
    const sign = cents >= 0 ? '+' : '';
    centsDisplay.textContent = `${sign}${cents.toFixed(0)} cents`;

    // classify tuning accuracy
    const absCents = Math.abs(cents);
    meterIndicator.className = 'meter-indicator';
    tunerDisplay.classList.remove('in-tune');
    tuningStatus.classList.remove('in-tune');

    if (absCents <= 3) {
        // in tune!
        meterIndicator.classList.add('in-tune');
        noteDisplay.style.color = 'var(--in-tune)';
        tunerDisplay.classList.add('in-tune');
        tuningStatus.textContent = '¡Afinado!';
        tuningStatus.classList.add('in-tune');
    } else if (absCents <= 15) {
        meterIndicator.classList.add('close');
        noteDisplay.style.color = 'var(--close)';
        tuningStatus.textContent = cents > 0 ? 'Un poco alto ♯' : 'Un poco bajo ♭';
        tuningStatus.classList.remove('in-tune');
    } else {
        meterIndicator.classList.add('out-tune');
        noteDisplay.style.color = 'var(--out-tune)';
        tuningStatus.textContent = cents > 0 ? 'Muy alto ♯ — afloja' : 'Muy bajo ♭ — aprieta';
        tuningStatus.classList.remove('in-tune');
    }
}

function findClosestNote(freq) {
    // find the octave
    let minDist = Infinity;
    let closest = ALL_NOTES[0];

    // check octaves 2-6
    for (let oct = 2; oct <= 6; oct++) {
        const octMultiplier = Math.pow(2, oct - 4); // relative to octave 4
        for (const n of ALL_NOTES) {
            const noteFreq = n.freq * octMultiplier;
            const dist = Math.abs(getCents(freq, noteFreq));
            if (dist < minDist) {
                minDist = dist;
                closest = { note: n.note, freq: noteFreq };
            }
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
    if (isPlayingRef) {
        stopReferenceTone();
    } else {
        playReferenceTone();
    }
}

function playReferenceTone() {
    if (!selectedString) {
        tuningStatus.textContent = 'Selecciona una cuerda primero';
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

    // fade out after 2 seconds
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 2);
    refOscillator.stop(ctx.currentTime + 2.1);

    isPlayingRef = true;
    refBtn.querySelector('.ref-text').textContent = `Sonando ${target.note}${target.octave}...`;

    refOscillator.onended = () => {
        isPlayingRef = false;
        refBtn.querySelector('.ref-text').textContent = 'Tono de referencia';
    };
}

function stopReferenceTone() {
    if (refOscillator) {
        try { refOscillator.stop(); } catch (e) { /* already stopped */ }
        refOscillator = null;
    }
    isPlayingRef = false;
    refBtn.querySelector('.ref-text').textContent = 'Tono de referencia';
}

// === RESET ===
function resetDisplay() {
    noteDisplay.textContent = '—';
    noteDisplay.style.color = '';
    freqDisplay.textContent = 'Hz';
    meterIndicator.style.left = '50%';
    meterIndicator.className = 'meter-indicator';
    centsDisplay.textContent = '0 cents';
    tuningStatus.textContent = 'Selecciona una cuerda o activa el micrófono';
    tuningStatus.classList.remove('in-tune');
    tunerDisplay.classList.remove('in-tune');
}
