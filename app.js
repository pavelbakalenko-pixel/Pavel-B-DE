import { pipeline } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.6/dist/transformers.min.js";

const GOOGLE_WEBAPP_URL =
  "https://script.google.com/macros/s/AKfycbzdE1BRZOatG0tfEqe66aTMOhd0Qsjk5AZV7IQLy7tpapMJICoT3BeMKI5XnFPsSpVf/exec";

const GOOGLE_SHEET_URL = "";

// ---------------- DOM ----------------
function $(id) {
  const el = document.getElementById(id);
  if (!el) console.warn("Missing element:", id);
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

// ---------------- STATE ----------------
let reviews = [];
let sentimentPipeline = null;
let modelReady = false;
let tsvReady = false;
let isAnalyzing = false;

// ---------------- UI ----------------
function setStatus(message, { ready = false, error = false } = {}) {
  if (!els.statusText || !els.status) return;
  els.statusText.textContent = message;
  els.status.classList.toggle("ready", ready);
  els.status.classList.toggle("error", error);
}

function showError(message) {
  if (!els.errorBox) return;
  console.error(message);
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
    els.analyzeBtn.innerHTML =
      '<span class="spinner"></span> Analyzing...';
  } else {
    els.analyzeBtn.innerHTML =
      '<i class="fa-solid fa-shuffle"></i> Analyze random review';
    els.analyzeBtn.disabled =
      !(modelReady && tsvReady && reviews.length > 0);
  }
}

function updateResultUI(bucket, label, score) {
  if (!els.resultArea) return;

  els.resultArea.classList.remove("positive", "negative", "neutral");

  const percent = Number.isFinite(score)
    ? (score * 100).toFixed(1)
    : "—";

  if (bucket === "positive") {
    els.resultArea.classList.add("positive");
    els.resultIcon.innerHTML =
      '<i class="fa-solid fa-thumbs-up"></i>';
  } else if (bucket === "negative") {
    els.resultArea.classList.add("negative");
    els.resultIcon.innerHTML =
      '<i class="fa-solid fa-thumbs-down"></i>';
  } else {
    els.resultArea.classList.add("neutral");
    els.resultIcon.innerHTML =
      '<i class="fa-solid fa-question-circle"></i>';
  }

  els.sentimentLabel.textContent = label;
  els.confidenceText.textContent =
    "(" + percent + "% confidence)";
  els.resultSubtext.textContent = "Analysis complete.";
}

// ---------------- LOGGING ----------------
function sendLogToGoogleSheets(payload) {
  try {
    const img = new Image();
    const encoded = encodeURIComponent(JSON.stringify(payload));
    img.src =
      GOOGLE_WEBAPP_URL +
      "?data=" +
      encoded +
      "&_=" +
      Date.now();
  } catch (err) {
    console.warn("Log failed:", err);
  }
}

function logAction(event, message, extra = {}) {
  sendLogToGoogleSheets({
    ts: new Date().toISOString(),
    event: event,
    message: message,
    url: location.href,
    userAgent: navigator.userAgent,
    ...extra,
  });
}

// ---------------- TSV ----------------
async function loadReviewsTSV() {
  setStatus("Loading reviews_test.tsv...");
  logAction("tsv_start", "Loading TSV");

  const res = await fetch("reviews_test.tsv");
  if (!res.ok) throw new Error("TSV fetch failed");

  const text = await res.text();

  const parsed = await new Promise((resolve, reject) => {
    Papa.parse(text, {
      header: true,
      delimiter: "\t",
      skipEmptyLines: true,
      complete: resolve,
      error: reject,
    });
  });

  reviews = parsed.data
    .map((r) => r.text)
    .filter((v) => typeof v === "string" && v.trim().length > 0);

  if (reviews.length === 0) {
    throw new Error("No valid reviews found in TSV");
  }

  tsvReady = true;
  setStatus("TSV ready: " + reviews.length + " reviews loaded");
  logAction("tsv_success", "TSV loaded", {
    count: reviews.length,
  });
}

// ---------------- MODEL ----------------
async function initModel() {
  setStatus("Loading sentiment model...");
  logAction("model_start", "Loading model");

  sentimentPipeline = await pipeline(
    "text-classification",
    "Xenova/distilbert-base-uncased-finetuned-sst-2-english"
  );

  modelReady = true;
  setStatus("Model ready", { ready: true });
  logAction("model_success", "Model loaded");
}

// ---------------- INFERENCE ----------------
function bucketize(label, score) {
  if (label === "POSITIVE" && score > 0.5)
    return "positive";
  if (label === "NEGATIVE" && score > 0.5)
    return "negative";
  return "neutral";
}

async function analyzeRandomReview() {
  clearError();

  if (!tsvReady || !modelReady) return;

  const review =
    reviews[Math.floor(Math.random() * reviews.length)];

  els.reviewDisplay.textContent = review;
  setAnalyzeButtonLoading(true);

  try {
    const output = await sentimentPipeline(review);

    const top = output[0];
    const label = top.label.toUpperCase();
    const score = top.score;

    const bucket = bucketize(label, score);

    updateResultUI(bucket, label, score);

    logAction("inference_success", "Inference done", {
      sentiment: label,
      confidence: score,
    });
  } catch (err) {
    showError("Inference failed: " + err.message);
    logAction("inference_fail", err.message);
  } finally {
    setAnalyzeButtonLoading(false);
  }
}

// ---------------- STARTUP ----------------
window.addEventListener("DOMContentLoaded", async () => {
  setStatus("Initializing...");
  logAction("app_start", "App initialized");

  try {
    await loadReviewsTSV();
  } catch (err) {
    showError("TSV error: " + err.message);
  }

  try {
    await initModel();
  } catch (err) {
    showError("Model error: " + err.message);
  }

  els.analyzeBtn.addEventListener(
    "click",
    analyzeRandomReview
  );
});
