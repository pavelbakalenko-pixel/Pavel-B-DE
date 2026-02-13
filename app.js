// app.js — complete browser‑side sentiment analysis with Transformers.js
import { pipeline } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.6/dist/transformers.min.js";

// ==================== DOM elements ====================
const statusIcon = document.getElementById('statusIcon');
const statusMsg = document.getElementById('statusMessage');
const reviewDisplay = document.getElementById('reviewDisplay');
const resultArea = document.getElementById('resultArea');
const resultIcon = document.getElementById('resultIcon');
const sentimentLabel = document.getElementById('sentimentLabel');
const confidenceText = document.getElementById('confidenceText');
const analyzeBtn = document.getElementById('analyzeBtn');
const errorBox = document.getElementById('errorBox');
const errorText = document.getElementById('errorText');

// ==================== state ====================
let reviews = [];               // cleaned review strings
let sentimentPipeline = null;    // pipeline instance
let modelReady = false;
let tsvLoaded = false;

// ==================== UI helpers ====================
function showError(msg, hideAfter = 8000) {
    console.error('[error]', msg);
    errorText.textContent = msg;
    errorBox.classList.remove('hidden');
    if (hideAfter) {
        setTimeout(() => {
            errorBox.classList.add('hidden');
        }, hideAfter);
    }
}

function clearError() {
    errorBox.classList.add('hidden');
    errorText.textContent = '';
}

function setStatus(icon, message, isReady = false, isLoading = false, isError = false) {
    statusMsg.textContent = message;
    statusIcon.innerHTML = icon;
    statusIcon.className = 'status-icon';
    if (isReady) statusIcon.classList.add('ready');
    else if (isError) statusIcon.classList.add('error');
    else if (isLoading) statusIcon.classList.add('loading');
}

function updateResultUI(sentiment, confidence) {
    // remove previous color classes
    resultArea.classList.remove('positive', 'negative', 'neutral');

    let iconHtml = '';
    let label = '';
    let confPercent = (confidence * 100).toFixed(1);

    if (sentiment === 'positive') {
        resultArea.classList.add('positive');
        iconHtml = '<i class="fa-solid fa-thumbs-up" style="color: #16a34a;"></i>';
        label = `POSITIVE (${confPercent}% confidence)`;
    } else if (sentiment === 'negative') {
        resultArea.classList.add('negative');
        iconHtml = '<i class="fa-solid fa-thumbs-down" style="color: #dc2626;"></i>';
        label = `NEGATIVE (${confPercent}% confidence)`;
    } else {
        resultArea.classList.add('neutral');
        iconHtml = '<i class="fa-solid fa-question-circle" style="color: #6b7280;"></i>';
        label = `NEUTRAL (${confPercent}% confidence)`;
    }

    resultIcon.innerHTML = iconHtml;
    sentimentLabel.textContent = label.split('(')[0].trim();  // just POSITIVE / NEGATIVE / NEUTRAL
    confidenceText.textContent = `(${confPercent}% confidence)`;
}

function setLoadingAnalysis(isLoading) {
    if (isLoading) {
        analyzeBtn.disabled = true;
        analyzeBtn.innerHTML = '<span class="loading-spinner"></span> analyzing…';
    } else {
        analyzeBtn.disabled = (!modelReady || !tsvLoaded || reviews.length === 0);
        analyzeBtn.innerHTML = '<i class="fa-solid fa-shuffle"></i> analyze random review';
    }
}

// ==================== TSV loading ====================
async function loadReviewsTSV() {
    try {
        setStatus('⏳', '📦 loading reviews_test.tsv ...', false, true);
        const response = await fetch('reviews_test.tsv');
        if (!response.ok) throw new Error(`HTTP ${response.status} — cannot fetch TSV`);

        const tsvText = await response.text();
        
        // Papa Parse with tab delimiter, header row assumed
        Papa.parse(tsvText, {
            header: true,
            delimiter: '\t',
            skipEmptyLines: true,
            complete: (result) => {
                try {
                    if (result.errors && result.errors.length) {
                        console.warn('PapaParse warnings:', result.errors);
                    }
                    // extract 'text' column, filter empty / non‑string
                    const rawRows = result.data;
                    const extracted = rawRows
                        .map(row => row.text?.trim())
                        .filter(txt => txt && typeof txt === 'string' && txt.length > 0);
                    
                    if (extracted.length === 0) throw new Error('No valid reviews in text column');
                    
                    reviews = extracted;
                    tsvLoaded = true;
                    setStatus('✅', `✅ ${reviews.length} reviews loaded`, true);
                    enableIfReady();
                } catch (parseErr) {
                    handleTsvError(parseErr.message);
                }
            },
            error: (parseError) => {
                handleTsvError(parseError.message);
            }
        });
    } catch (netErr) {
        handleTsvError(netErr.message);
    }
}

function handleTsvError(msg) {
    tsvLoaded = false;
    reviews = [];
    setStatus('⚠️', '❌ TSV error', false, false, true);
    showError(`Failed to load reviews: ${msg}`, 10000);
    enableIfReady();
}

// ==================== model initialization ====================
async function initModel() {
    try {
        setStatus('🧠', '⏳ loading sentiment model (first time may take a moment) …', false, true);
        // create pipeline — this downloads and caches in browser
        sentimentPipeline = await pipeline(
            'text-classification', 
            'Xenova/distilbert-base-uncased-finetuned-sst-2-english'
        );
        modelReady = true;
        setStatus('✅', '✅ model ready — distilbert‑sst2', true);
        enableIfReady();
    } catch (modelErr) {
        console.error('Model init error:', modelErr);
        modelReady = false;
        sentimentPipeline = null;
        setStatus('🔥', '❌ model failed', false, false, true);
        showError(`Model load error: ${modelErr.message || 'unknown'}. Check console.`, 0);
        enableIfReady();
    }
}

function enableIfReady() {
    const ready = modelReady && tsvLoaded && reviews.length > 0;
    analyzeBtn.disabled = !ready;
    if (ready) {
        // small visual feedback
        statusMsg.textContent += ' — ready to analyze';
    }
}

// ==================== sentiment analysis ====================
async function analyzeRandomReview() {
    clearError();

    if (!modelReady || !sentimentPipeline) {
        showError('Model not ready — please wait or reload.', 4000);
        return;
    }
    if (!tsvLoaded || reviews.length === 0) {
        showError('No reviews loaded — check TSV file.', 4000);
        return;
    }

    // pick random review
    const randomIndex = Math.floor(Math.random() * reviews.length);
    const selectedReview = reviews[randomIndex];
    reviewDisplay.textContent = selectedReview;

    // disable button, show loading on button
    setLoadingAnalysis(true);

    try {
        // run inference
        const result = await sentimentPipeline(selectedReview);
        // expected output: [{ label: "POSITIVE" or "NEGATIVE", score: number }]
        if (!Array.isArray(result) || result.length === 0) {
            throw new Error('Unexpected model output format');
        }

        const top = result[0];
        let rawLabel = top.label.toUpperCase();      // "POSITIVE" / "NEGATIVE"
        let rawScore = top.score;

        // map to POSITIVE / NEGATIVE / NEUTRAL according to spec
        let finalSentiment = 'neutral';
        if (rawLabel.includes('POSITIVE') && rawScore > 0.5) {
            finalSentiment = 'positive';
        } else if (rawLabel.includes('NEGATIVE') && rawScore > 0.5) {
            finalSentiment = 'negative';
        } else {
            finalSentiment = 'neutral';
        }

        // neutral edge: we keep rawScore for confidence, but sentiment = neutral
        // confidence displayed always as rawScore percentage.
        updateResultUI(finalSentiment, rawScore);

    } catch (inferErr) {
        console.error('inference error:', inferErr);
        showError(`Analysis failed: ${inferErr.message}`, 6000);
        // reset result area to "waiting"
        resultIcon.innerHTML = '<i class="fa-regular fa-circle-question"></i>';
        sentimentLabel.textContent = 'error';
        confidenceText.textContent = '—';
        resultArea.classList.remove('positive', 'negative', 'neutral');
    } finally {
        setLoadingAnalysis(false);
    }
}

// ==================== start everything ====================
window.addEventListener('DOMContentLoaded', async () => {
    // initial state
    setStatus('⏳', 'initializing...', false, true);
    
    // parallel: load TSV and init model
    await Promise.allSettled([loadReviewsTSV(), initModel()]);
    
    // attach click listener
    analyzeBtn.addEventListener('click', analyzeRandomReview);
    
    // if after all, still not ready – but status reflects it
    enableIfReady();
});
