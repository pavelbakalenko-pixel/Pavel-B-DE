// app.js — Fully client-side TSV loading + Transformers.js inference + Google Sheets logging (CORS-free)
import { pipeline } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.6/dist/transformers.min.js";

/**
 * Google Apps Script Web App (/exec) — logs endpoint (CORS-free via GET Image beacon)
 */
const GOOGLE_WEBAPP_URL =
  "https://script.google.com/macros/s/AKfycbzdE1BRZOatG0tfEqe66aTMOhd0Qsjk5AZV7IQLy7tpapMJICoT3BeMKI5XnFPsSpVf/exec";

/**
 * Optional: put your Google Sheet URL here to show a clickable link in the UI.
 * If you don't know it, leave it empty.
 */
const GOOGLE_SHEET_URL = "";

/**
 * ====================
 * DOM References
 * ====================
 */
const els = {
  analyzeBtn: document.getElementById("analyzeBtn"),
  status: document.getElementById("status"),
  statusText: document.getElementById("statusText"),
  errorBox: document.getElementById("errorBox"),
  reviewDisplay: document.getElementById("reviewDisplay"),
  resultArea: document.getElementById("resultArea"),
  resultIcon: document.getElementById("resultIcon"),
  sentimentLabel: document.getElementById("sentimentLabel"),
  confidenceText: document.getElementById("confidenceText"),
  resultSubtext: document.getElementById("resultSubtext"),
  sheetLink: document.getElementById("sheetLink"),
};

/**
 * ====================
 * App State
 * ====================
 */
let reviews = [];
let sentimentPipeline = null;
let modelReady = false;
let tsvReady = false;
let isAnalyzing = false;

/**
 * ====================
 * UI Helpers
 * ====================
 */
function setStatus(message, { ready = false, error = false } = {}) {
  els.statusText.textContent = message;
  els.status.classList.toggle("ready", ready);
  els.status.classList.toggle("error", error);
}

function showError(message) {
  console.error("[UI error]", message);
  els.errorBox.textContent = message;
  els.errorBox.classList.add("show");
}

function clearError() {
  els.errorBox.textContent = "";
  els.errorBox.classList.remove("show");
}

function setAnalyzeButtonLoading(loading) {
  isAnalyzing = loading;
  if (loading) {
    els.analyzeBtn.disabled = true;
    els.analyzeBtn.innerHTML = `<span class="spinner" aria-hidden="true"></span> Analyzing…`;
  } else {
    els.analyzeBtn.innerHTML = `<i class="fa-solid fa-shuffle"></i> Analyze random review`;
    els.analyzeBtn.disabled = !(modelReady && tsvReady && reviews.length > 0);
  }
}

function updateResultUI(bucket, label, score) {
  els.resultArea.classList.remove("positive", "negative", "neutral");

  const percent = Number.isFinite(score) ? (score * 100).toFixed(1) : "—";

  if (bucket === "positive") {
    els.resultArea.classList.add("positive");
    els.resultIcon.innerHTML = `<i class="fa-solid fa-thumbs-up" aria-hidden="true"></i>`;
  } else if (bucket === "negative") {
    els.resultArea.classList.add("negative");
    els.resultIcon.innerHTML = `<i class="fa-solid fa-thumbs-down" aria-hidden="true"></i>`;
  } else {
    els.resultArea.classList.add("neutral");
    els.resultIcon.innerHTML = `<i class="fa-solid fa-question-circle" aria-hidden="true"></i>`;
  }

  els.sentimentLabel.textContent = label || "NEUTRAL";
  els.confidenceText.textContent = `(${percent}% confidence)`;
  els.resultSubtext.textContent = "Analysis complete.";
}

/**
 * ====================
 * Logging (CORS-free)
 * ====================
 * We send logs as a GET request via an <img> beacon to avoid CORS preflight.
 */
function sendLogToGoogleSheets(payload) {
  if (!GOOGLE_WEBAPP_URL) return;
  try {
    const img = new Image();
    const data = encodeURIComponent(JSON.stringify(payload));
    img.src = `${GOOGLE_WEBAPP_URL}?data=${data}&_=${Date.now()}`;
  } catch (err) {
    console.warn("[log] Failed to send log", err);
  }
}

function logAction(event, message, extra = {}) {
  const reviewPreview =
    typeof extra.review === "string"
      ? extra.review.slice(0, 240)
      : (typeof extra.review_preview === "string" ? extra.review_preview.slice(0, 240) : "");

  const payload = {
    ts_iso: new Date().toISOString(),
    event,
    message,
    sentiment: extra.sentiment || "",
    confidence: typeof extra.confidence === "number" ? extra.confidence : "",
    review_preview: reviewPreview,
    url: location.href,
    userAgent: navigator.userAgent,
    meta: JSON.stringify({
      ...extra,
      review: undefined, // avoid duplicating full review text in meta
    }),
  };

  sendLogToGoogleSheets(payload);
}

/**
 * ====================
 * TSV Loading & Parsing
 * ====================
 */
async function loadReviewsTSV() {
  setStatus("Loading reviews_test.tsv…");
  logAction("tsv_load_start", "Fetching reviews_test.tsv");

  try {
    const res = await fetch("reviews_test.tsv", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status} while fetching reviews_test.tsv`);

    const tsvText = await res.text();

    const parsed = await new Promise((resolve, reject) => {
      Papa.parse(tsvText, {
        header: true,
        delimiter: "\t",
        skipEmptyLines: true,
        complete: (result) => resolve(result),
        error: (err) => reject(err),
      });
    });

    if (!parsed || !Array.isArray(parsed.data)) {
      throw new Error("Unexpected TSV parse result.");
    }

    const extracted = parsed.data
      .map((row) => row?.text)
      .filter((v) => typeof v === "string")
      .map((v) => v.trim())
      .filter((v) => v.length > 0);

    if (extracted.length === 0) {
      throw new Error('No valid review texts found in the "text" column.');
    }

    reviews = extracted;
    tsvReady = true;

    setStatus(`TSV ready: ${reviews.length} reviews loaded.`);
    logAction("tsv_load_success", `Loaded ${reviews.length} reviews`, { count: reviews.length });
  } catch (err) {
    tsvReady = false;
    reviews = [];

    console.error("[TSV] Load/parse failed:", err);
    setStatus("TSV failed to load.", { error: true });
    showError(
      `Could not load or parse reviews_test.tsv. Make sure the file exists next to index.html and contains a "text" column. Details: ${err.message}`
    );
    logAction("tsv_load_fail", "TSV load/parse failed", { error: err.message });
  }
}

/**
 * ====================
 * Model Initialization
 * ====================
 */
async function initModel() {
  setStatus("Loading sentiment model… (first run may take a while)");
  logAction("model_load_start", "Initializing Transformers.js pipeline");

  try {
    sentimentPipeline = await pipeline(
      "text-classification",
      "Xenova/distilbert-base-uncased-finetuned-sst-2-english"
    );

    modelReady = true;
    setStatus("Sentiment model ready.", { ready: true });
    logAction("model_load_success", "Model loaded and ready");
  } catch (err) {
    modelReady = false;
    sentimentPipeline = null;

    console.error("[Model] Load failed:", err);
    setStatus("Model failed to load.", { error: true });
    showError(
      `Could not load the sentiment model in your browser. Check the console for details. Details: ${err.message || String(err)}`
    );
    logAction("model_load_fail", "Model load failed", { error: err.message || String(err) });
  }
}

/**
 * ====================
 * Sentiment Mapping
 * ====================
 */
function normalizePipelineOutput(output) {
  if (!Array.isArray(output) || output.length === 0) {
    throw new Error("Unexpected inference output format.");
  }

  const top = output[0];
  if (!top || typeof top.label !== "string" || typeof top.score !== "number") {
    throw new Error("Inference output missing label/score.");
  }

  return { label: top.label.toUpperCase(), score: top.score };
}

function bucketizeSentiment(label, score) {
  // Requirements:
  // Positive if label is "POSITIVE" and score > 0.5
  // Negative if label is "NEGATIVE" and score > 0.5
  // Neutral in all other cases
  if (label === "POSITIVE" && score > 0.5) return "positive";
  if (label === "NEGATIVE" && score > 0.5) return "negative";
  return "neutral";
}

/**
 * ====================
 * Analysis Flow
 * ====================
 */
function pickRandomReview() {
  const idx = Math.floor(Math.random() * reviews.length);
  return reviews[idx];
}

async function analyzeRandomReview() {
  clearError();
  logAction("analyze_click", "Analyze button clicked");

  if (!tsvReady || reviews.length === 0) {
    showError("No reviews loaded yet. Please ensure reviews_test.tsv is available and try again.");
    logAction("analyze_blocked", "No reviews loaded");
    return;
  }

  if (!modelReady || !sentimentPipeline) {
    showError("Model is not ready yet. Please wait for it to finish loading, then try again.");
    logAction("analyze_blocked", "Model not ready");
    return;
  }

  if (isAnalyzing) return;

  const review = pickRandomReview();
  els.reviewDisplay.textContent = review;

  setAnalyzeButtonLoading(true);
  els.resultSubtext.textContent = "Running inference…";

  try {
    logAction("inference_start", "Running sentiment inference", { review });

    const raw = await sentimentPipeline(review);
    const { label, score } = normalizePipelineOutput(raw);
    const bucket = bucketizeSentiment(label, score);

    updateResultUI(bucket, label, score);

    logAction("inference_success", "Inference complete", {
      review,
      sentiment: label,
      confidence: score,
      bucket,
    });
  } catch (err) {
    console.error("[Inference] Failed:", err);
    showError(`Analysis failed. Please try again. Details: ${err.message || String(err)}`);
    els.resultSubtext.textContent = "Analysis failed.";
    updateResultUI("neutral", "NEUTRAL", NaN);

    logAction("inference_fail", "Inference failed", {
      error: err.message || String(err),
      review_preview: review?.slice(0, 240),
    });
  } finally {
    setAnalyzeButtonLoading(false);
  }
}

/**
 * ====================
 * Startup
 * ====================
 */
function updateSheetLink() {
  if (GOOGLE_SHEET_URL) {
    els.sheetLink.href = GOOGLE_SHEET_URL;
  } else {
    // If not configured, keep link non-clickable
    els.sheetLink.href = "#";
    els.sheetLink.textContent = "Logs spreadsheet link not set";
    els.sheetLink.style.pointerEvents = "none";
    els.sheetLink.style.opacity = "0.7";
  }
}

window.addEventListener("DOMContentLoaded", async () => {
  updateSheetLink();
  setAnalyzeButtonLoading(false);
  setStatus("Initializing…");
  logAction("app_start", "App initialized");

  // Load TSV + model in parallel
  await Promise.allSettled([loadReviewsTSV(), initModel()]);

  // Enable button only if both are ready
  els.analyzeBtn.disabled = !(modelReady && tsvReady && reviews.length > 0);

  if (modelReady && tsvReady) {
    setStatus("Ready. Click “Analyze random review”.", { ready: true });
  } else if (!modelReady && !tsvReady) {
    setStatus("Not ready: model and TSV failed to load.", { error: true });
  } else if (!modelReady) {
    setStatus("Not ready: model failed to load.", { error: true });
  } else if (!tsvReady) {
    setStatus("Not ready: TSV failed to load.", { error: true });
  }

  els.analyzeBtn.addEventListener("click", analyzeRandomReview);
});
