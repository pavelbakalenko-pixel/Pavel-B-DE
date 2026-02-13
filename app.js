import { pipeline } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.6/dist/transformers.min.js";

const GOOGLE_WEBAPP_URL =
  "https://script.google.com/macros/s/AKfycbwDFBamYbprywVtMroSuZRTrhUTEmW9JdXkQ0yLXDFo0eePdx98k_wuffA71EeKFhMS/exec";

// ---------- STATE ----------
var reviews = [];
var sentimentPipeline = null;
var modelReady = false;
var tsvReady = false;
var isAnalyzing = false;

// ---------- DOM ----------
function getEl(id) { return document.getElementById(id); }

var analyzeBtn = getEl("analyzeBtn");
var statusEl = getEl("status");
var statusText = getEl("statusText");
var errorBox = getEl("errorBox");
var reviewDisplay = getEl("reviewDisplay");
var resultArea = getEl("resultArea");
var resultIcon = getEl("resultIcon");
var sentimentLabel = getEl("sentimentLabel");
var confidenceText = getEl("confidenceText");
var resultSubtext = getEl("resultSubtext");

// ---------- UI ----------
function setStatus(message, ready, error) {
  if (statusText) statusText.textContent = message;

  if (statusEl) {
    statusEl.classList.remove("ready");
    statusEl.classList.remove("error");
    if (ready === true) statusEl.classList.add("ready");
    if (error === true) statusEl.classList.add("error");
  }
}

function showError(message) {
  console.error(message);
  if (!errorBox) return;
  errorBox.textContent = message;
  errorBox.classList.add("show");
}

function clearError() {
  if (!errorBox) return;
  errorBox.textContent = "";
  errorBox.classList.remove("show");
}

function updateButtonState() {
  if (!analyzeBtn) return;
  var enabled = modelReady && tsvReady && reviews.length > 0 && !isAnalyzing;
  analyzeBtn.disabled = !enabled;
}

function setAnalyzeButtonLoading(loading) {
  if (!analyzeBtn) return;
  isAnalyzing = loading;

  if (loading) {
    analyzeBtn.disabled = true;
    analyzeBtn.innerHTML = '<span class="spinner"></span> Analyzing...';
  } else {
    analyzeBtn.innerHTML = '<i class="fa-solid fa-shuffle"></i> Analyze random review';
    updateButtonState();
  }
}

function updateResultUI(bucket, label, score) {
  if (!resultArea) return;

  resultArea.classList.remove("positive");
  resultArea.classList.remove("negative");
  resultArea.classList.remove("neutral");

  var percent = "—";
  if (typeof score === "number") percent = (score * 100).toFixed(1);

  if (bucket === "positive") {
    resultArea.classList.add("positive");
    resultIcon.innerHTML = '<i class="fa-solid fa-thumbs-up"></i>';
  } else if (bucket === "negative") {
    resultArea.classList.add("negative");
    resultIcon.innerHTML = '<i class="fa-solid fa-thumbs-down"></i>';
  } else {
    resultArea.classList.add("neutral");
    resultIcon.innerHTML = '<i class="fa-solid fa-question-circle"></i>';
  }

  if (sentimentLabel) sentimentLabel.textContent = label;
  if (confidenceText) confidenceText.textContent = "(" + percent + "% confidence)";
  if (resultSubtext) resultSubtext.textContent = "Analysis complete.";
}

// ---------- LOGGING ----------
function sendLogToGoogleSheets(payload) {
  try {
    // режем, чтобы URL не был огромным
    payload.review_preview = String(payload.review_preview || "").slice(0, 200);
    payload.meta = String(payload.meta || "").slice(0, 300);

    var img = new Image();
    var encoded = encodeURIComponent(JSON.stringify(payload));
    img.src = GOOGLE_WEBAPP_URL + "?data=" + encoded + "&_=" + Date.now();
  } catch (err) {
    console.warn("Log failed:", err);
  }
}


// ---------- TSV ----------
async function loadReviewsTSV() {
  setStatus("Loading reviews_test.tsv...", false, false);
  logAction("tsv_start", "Loading TSV");

  var res = await fetch("reviews_test.tsv", { cache: "no-store" });
  if (!res.ok) {
    throw new Error("Cannot fetch reviews_test.tsv (HTTP " + res.status + ")");
  }

  var text = await res.text();

  var parsed = await new Promise(function(resolve, reject) {
    Papa.parse(text, {
      header: true,
      delimiter: "\t",
      skipEmptyLines: true,
      complete: resolve,
      error: reject
    });
  });

  reviews = parsed.data
    .map(function(r) { return r && r.text; })
    .filter(function(v) { return typeof v === "string" && v.trim().length > 0; })
    .map(function(v) { return v.trim(); });

  if (reviews.length === 0) {
    throw new Error('No valid rows found in TSV column "text"');
  }

  tsvReady = true;
  setStatus("TSV ready: " + reviews.length + " reviews loaded", false, false);
  logAction("tsv_success", "TSV loaded", { count: reviews.length });
  updateButtonState();
}

// ---------- MODEL ----------
async function initModel() {
  setStatus("Loading sentiment model... (first run may take a while)", false, false);
  logAction("model_start", "Loading model");

  sentimentPipeline = await pipeline(
    "text-classification",
    "Xenova/distilbert-base-uncased-finetuned-sst-2-english"
  );

  modelReady = true;
  setStatus("Model ready", true, false);
  logAction("model_success", "Model loaded");
  updateButtonState();
}

// ---------- INFERENCE ----------
function bucketize(label, score) {
  if (label === "POSITIVE" && score > 0.5) return "positive";
  if (label === "NEGATIVE" && score > 0.5) return "negative";
  return "neutral";
}

async function analyzeRandomReview() {
  clearError();

  if (!tsvReady || reviews.length === 0) {
    showError("No reviews loaded. Check that reviews_test.tsv exists and has a 'text' column.");
    return;
  }
  if (!modelReady || !sentimentPipeline) {
    showError("Model not ready yet. Wait for it to finish loading.");
    return;
  }
  if (isAnalyzing) return;

  var review = reviews[Math.floor(Math.random() * reviews.length)];
  if (reviewDisplay) reviewDisplay.textContent = review;

  setAnalyzeButtonLoading(true);
  if (resultSubtext) resultSubtext.textContent = "Running inference...";

  try {
    logAction("inference_start", "Inference started", { review_preview: review.slice(0, 200) });

    var output = await sentimentPipeline(review);
    if (!output || !output[0]) throw new Error("Unexpected model output");

    var label = String(output[0].label || "").toUpperCase();
    var score = Number(output[0].score);

    var bucket = bucketize(label, score);
    updateResultUI(bucket, label, score);

    logAction("inference_success", "Inference complete", { sentiment: label, confidence: score });
  } catch (err) {
    showError("Inference failed: " + (err && err.message ? err.message : String(err)));
    logAction("inference_fail", "Inference failed", { error: String(err) });
  } finally {
    setAnalyzeButtonLoading(false);
    updateButtonState();
  }
}

// ---------- STARTUP ----------
window.addEventListener("DOMContentLoaded", function() {
  setStatus("Initializing...", false, false);
  logAction("app_start", "App initialized");

  if (analyzeBtn) analyzeBtn.addEventListener("click", analyzeRandomReview);

  // Important: this must NOT be opened via file://
  // Use GitHub Pages / Hugging Face Spaces / local server.
  loadReviewsTSV().catch(function(err) {
    tsvReady = false;
    reviews = [];
    showError("TSV error: " + (err && err.message ? err.message : String(err)) +
      ". IMPORTANT: do not open via file://. Use http/https.");
    setStatus("TSV failed to load", false, true);
    updateButtonState();
  });

  initModel().catch(function(err) {
    modelReady = false;
    sentimentPipeline = null;
    showError("Model error: " + (err && err.message ? err.message : String(err)));
    setStatus("Model failed to load", false, true);
    updateButtonState();
  });

  updateButtonState();
});
