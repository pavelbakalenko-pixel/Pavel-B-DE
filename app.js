// app.js — Fully client-side TSV loading + Transformers.js inference + Google Sheets logging (CORS-free)
import { pipeline } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.6/dist/transformers.min.js";

const GOOGLE_WEBAPP_URL =
  "https://script.google.com/macros/s/AKfycbzdE1BRZOatG0tfEqe66aTMOhd0Qsjk5AZV7IQLy7tpapMJICoT3BeMKI5XnFPsSpVf/exec";

// Optional: link shown in UI. You can paste your spreadsheet URL here later.
const GOOGLE_SHEET_URL = "";

// ---------- DOM ----------
function $(id) {
  const el = document.getElementById(id);
  if (!el) console.warn(`[dom] Missing #${id}`);
  return el;
}

const els = {
  analyzeBtn: $("analyzeBtn"),
  status: $("status"),
  statusText: $("statusText"),
  errorBox: $("errorBox"),
  reviewDisplay: $("reviewDisplay"),
  resultArea: $("resultArea"),
  resultIcon: $("resultIcon"),
  sentimentLabel: $("sentimentLabel"),
  confidenceText: $("confidenceText"),
  resultSubtext: $("resultSubtext"),
  sheetLink: $("sheetLink"),
};

// ---------- State ----------
let reviews = [];
let sentimentPipeline = null;
let modelReady = false;
let tsvReady = false;
let isAnalyzing = false;

// ---------- UI helpers ----------
function setStatus(message, { ready = false, error = false } = {}) {
  if (!els.statusText || !els.status) return;
  els.statusText.textContent = message;
  els.status.classList.toggle("ready", ready);
  els.status.classList.toggle("error", error);
}

function showError(message) {
  console.error("[UI error]", message);
  if (!els.errorBox) return;
  els.errorBox.textContent = message;
  els.errorBox.classList.add("show");
}

function clearError() {
  if (!els.errorBox) return;
  els.errorBox.textContent = "";
  els.errorBox.classList.remove("show");
}

function setAnalyzeButtonLoading(loading) {
  if (!els.analyzeBtn) return;
  isAnalyzing = loading;

  if (loading) {
    els.analyzeBtn.disabled = true;
    els.analyzeBtn.innerHTML = `<span class="spinner" aria-hidden="true"></span> Analyzing…`;
  } else {
    els.analyzeBtn.innerHTML = `<i class="fa-solid fa-shuffle"></i> Analyze random review`;
    els.analyzeBtn.disabled = !(modelReady && tsvReady && reviews.length > 0);
  }
}

function updateButtonEnabledState() {
  if (!els.analyzeBtn) return;
  els.analyzeBtn.disabled = !(modelReady && tsvReady && reviews.length > 0) || isAnalyzing;
}

function updateResultUI(bucket, label, score) {
  if (!els.resultArea || !els.resultIcon || !els.sentimentLabel || !els.confidenceText || !els.resultSubtext) return;

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

// ---------- Logging (CORS-free via GET Image beacon) ----------
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

  sendLogToGoogleSheets({
    ts_iso: new Date().toISOString(),
    event,
    message,
    sentiment: extra.sentiment || "",
    confidence: typeof extra.confidence === "number" ? extra.confidence : "",
    review_preview: reviewPreview,
    url: location.href,
    userAgent: navigator.userAgent,
    meta: JSON.stringify({ ...extra, review: undefined }),
  });
}

// ---------- Utils ----------
function withTimeout(promise, ms, label) {
  let t;
  const timeout = new Promise((_, reject) => {
    t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

function updateOverallStatus() {
  if (modelReady && tsvReady) setStatus("Ready. Click “Analyze random review”.", { ready: true });
  else if (!modelReady && !tsvReady) setStatus("Waiting: model + TSV…");
  else if (!modelReady) setStatus("Waiting: model…");
  else setStatus("Waiting: TSV…");
}

// ---------- TSV Loading ----------
async function loadReviewsTSV() {
  setStatus("Loading reviews_test.tsv…");
  logAction("tsv_load_start", "Fetching reviews_test.tsv");

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

  if (!parsed || !Array.isArray(parsed.data)) throw new Error("Unexpected TSV parse result.");

  const extracted = parsed.data
    .map((row) => row?.text)
    .filter((v) => typeof v === "string")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);

  if (extracted.length === 0) throw new Error('No valid review texts found in the "text" column.');

  reviews = extracted;
  tsvReady = true;

  logAction("tsv_load_success", `Loaded ${reviews.length} reviews`, { count: reviews.length });
}

// ---------- Model Loading ----------
async function initModel() {
  setStatus("Loading sentiment model… (first run may take a while)");
  logAction("model_load_start", "Initializing Transformers.js pipeline");

  sentimentPipeline = await withTimeout(
    pipeline("text-classification", "Xenova/distilbert-base-uncased-finetuned-sst-2-english"),
    120000,
    "Model load"
  );

  modelReady = true;
  logAction("model_load_success", "Model loaded and ready");
}

// ---------- Inference helpers ----------
function normalizePipelineOutput(output) {
  if (!Array.isArray(output) || output.length === 0) throw new Error("Unexpected inference output format.");
  const top = output[0];
  if (!top || typeof top.label !== "string" || typeof top.score !== "number") {
    throw new Error("Inference output missing label/score.");
  }
  return { label: top.label.toUpperCase(), score: top.score };
}

function bucketizeSentiment(label, score) {
  if (label === "POSITIVE" && score > 0.5) return "positive";
  if (label === "NEGATIVE" && score > 0.5) return "negative";
  return "neutral";
}

function pickRandomReview() {
  return reviews[Math.floor(Math.random() * reviews.length)];
}

async function analyzeRandomReview() {
  clearError();
  logAction("analyze_click", "Analyze button clicked");

  if (!tsvReady || reviews.length === 0) {
    showError("No reviews loaded yet. Ensure reviews_test.tsv exists next to index.html and has a 'text' column.");
    logAction("analyze_blocked", "No reviews loaded");
    return;
  }

  if (!modelReady || !sentimentPipeline) {
    showError("Model is not ready yet. Please wait for it to finish loading.");
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
    showError(`Analysis failed: ${err.message || String(err)}`);
    els.resultSubtext.textContent = "Analysis failed.";
    updateResultUI("neutral", "NEUTRAL", NaN);

    logAction("inference_fail", "Inference failed", {
      error: err.message || String(err),
      review_preview: review?.slice(0, 240),
    });
  } finally {
    setAnalyzeButtonLoading(false);
    updateButtonEnabledState();
  }
}

// ---------- Startup ----------
function updateSheetLink() {
  if (!els.sheetLink) return;

  if (GOOGLE_SHEET_URL) {
    els.sheetLink.href = GOOGLE_SHEET_URL;
  } else {
    els.sheetLink.href = "#";
    els.sheetLink.textContent = "Logs spreadsheet link not set";
    els.sheetLink.style.pointerEvents = "none";
    els.sheetLink.style.opacity = "0.7";
  }
}

window.addEventListener("DOMContentLoaded", () => {
  updateSheetLink();
  setAnalyzeButtonLoading(false);
  setStatus("Initializing…");
  logAction("app_start", "App initialized");

  // TSV (non-blocking)
  loadReviewsTSV()
    .then(() => {
      setStatus(`TSV ready: ${reviews.length} reviews loaded.`);
      updateOverallStatus();
      updateButtonEnabledState();
    })
    .catch((err) => {
      tsvReady = false;
      reviews = [];
      console.error("[TSV] failed:", err);
      showError(`TSV load failed: ${err.message}. (Важно: открывай сайт по http/https, не file://)`);
      logAction("tsv_load_fail", "TSV load/parse failed", { error: err.message });
      setStatus("TSV failed to load.", { error: true });
      updateOverallStatus();
      updateButtonEnabledState();
    });

  // Model (non-blocking + timeout)
  initModel()
    .then(() => {
      setStatus("Sentiment model ready.", { ready: true });
      updateOverallStatus();
      updateButtonEnabledState();
    })
    .catch((err) => {
      modelReady = false;
      sentimentPipeline = null;
      console.error("[Model] failed:", err);
      showError(`Model load failed: ${err.message}. Проверь Console/Network (часто блокируется CDN или WASM).`);
      logAction("model_load_fail", "Model load failed", { error: err.message });
      setStatus("Model failed to load.", { error: true });
      updateOverallStatus();
      updateButtonEnabledState();
    });

  els.analyzeBtn.addEventListener("click", analyzeRandomReview);

  updateOverallStatus();
  updateButtonEnabledState();
});
