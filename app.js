import { pipeline } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.6/dist/transformers.min.js";

/*
  ✅ Your Google Apps Script Web App URL (/exec)
*/
const GOOGLE_WEBAPP_URL =
  "https://script.google.com/macros/s/AKfycbw53018IfMJSKwRpdkntW1eZ5XxbGa4D1Gwaab5A8_JezAVG2A1228A5RdqVPkoe7M_/exec";

/*
  ✅ Load TSV from GitHub RAW (not "local")
  If your branch is "master", replace /main/ with /master/
*/
const TSV_URL =
  "https://raw.githubusercontent.com/pavelbakalenko-pixel/Pavel-B-DE/main/reviews_test.tsv";

// ---------------- STATE ----------------
var reviews = [];
var sentimentPipeline = null;
var modelReady = false;
var tsvReady = false;
var isAnalyzing = false;

// ---------------- DOM ----------------
function getEl(id) {
  return document.getElementById(id);
}

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

// ---------------- UI ----------------
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

function updateOverallStatus() {
  if (modelReady && tsvReady) {
    setStatus("Ready. Click “Analyze random review”.", true, false);
  } else if (modelReady && !tsvReady) {
    setStatus("Model ready — waiting for TSV…", false, false);
  } else if (!modelReady && tsvReady) {
    setStatus("TSV ready — waiting for model…", false, false);
  } else {
    setStatus("Initializing… (loading TSV + model)", false, false);
  }
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
    analyzeBtn.innerHTML =
      '<i class="fa-solid fa-shuffle"></i> Analyze random review';
    updateButtonState();
  }
}

function updateResultUI(bucket, label, score) {
  if (!resultArea) return;

  resultArea.classList.remove("positive");
  resultArea.classList.remove("negative");
  resultArea.classList.remove("neutral");

  var percent = "—";
  if (typeof score === "number" && isFinite(score)) {
    percent = (score * 100).toFixed(1);
  }

  if (bucket === "positive") {
    resultArea.classList.add("positive");
    if (resultIcon) resultIcon.innerHTML = '<i class="fa-solid fa-thumbs-up"></i>';
  } else if (bucket === "negative") {
    resultArea.classList.add("negative");
    if (resultIcon) resultIcon.innerHTML = '<i class="fa-solid fa-thumbs-down"></i>';
  } else {
    resultArea.classList.add("neutral");
    if (resultIcon) resultIcon.innerHTML = '<i class="fa-solid fa-question-circle"></i>';
  }

  if (sentimentLabel) sentimentLabel.textContent = label;
  if (confidenceText) confidenceText.textContent = "(" + percent + "% confidence)";
  if (resultSubtext) resultSubtext.textContent = "Analysis complete.";
}

// ---------------- LOGGING (NO ${}, NO template strings) ----------------
// Uses GET via Image beacon to avoid CORS. Keep payload small to avoid URL limits.
function sendLogToGoogleSheets(payload) {
  try {
    if (!GOOGLE_WEBAPP_URL) return;

    // Keep payload small (URL length limits)
    payload.review_preview = String(payload.review_preview || "").slice(0, 200);
    payload.meta = String(payload.meta || "").slice(0, 300);
    payload.message = String(payload.message || "").slice(0, 160);

    var encoded = encodeURIComponent(JSON.stringify(payload));
    var img = new Image();
    img.src = GOOGLE_WEBAPP_URL + "?data=" + encoded + "&_=" + Date.now();
  } catch (err) {
    console.warn("Log failed:", err);
  }
}

function logAction(eventName, message, extra) {
  var payload = {
    ts: new Date().toISOString(),
    event: eventName,
    message: message,
    sentiment: "",
    confidence: "",
    url: location.href,
    userAgent: navigator.userAgent,
    review_preview: "",
    meta: ""
  };

  if (extra && typeof extra === "object") {
    if (extra.sentiment != null) payload.sentiment = String(extra.sentiment);
    if (extra.confidence != null) payload.confidence = String(extra.confidence);
    if (extra.review_preview != null) payload.review_preview = String(extra.review_preview);
    if (extra.meta != null) payload.meta = String(extra.meta);
  }

  sendLogToGoogleSheets(payload);
}

// ---------------- TSV (from GitHub RAW) ----------------
async function loadReviewsTSV() {
  logAction("tsv_start", "Loading TSV from GitHub RAW", { meta: TSV_URL });

  var res = await fetch(TSV_URL, { cache: "no-store" });
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
    throw new Error('No valid rows found in TSV column "text".');
  }

  tsvReady = true;
  logAction("tsv_success", "TSV loaded", { meta: "count=" + reviews.length });
}

// ---------------- MODEL ----------------
async function initModel() {
  logAction("model_start", "Loading sentiment model");

  sentimentPipeline = await pipeline(
    "text-classification",
    "Xenova/distilbert-base-uncased-finetuned-sst-2-english",
    { dtype: "q8" }
  );

  modelReady = true;
  logAction("model_success", "Model loaded");
}

// ---------------- INFERENCE ----------------
function bucketize(label, score) {
  if (label === "POSITIVE" && score > 0.5) return "positive";
  if (label === "NEGATIVE" && score > 0.5) return "negative";
  return "neutral";
}

async function analyzeRandomReview() {
  clearError();

  if (!tsvReady || reviews.length === 0) {
    showError("TSV not ready. Cannot analyze.");
    logAction("analyze_blocked", "TSV not ready");
    return;
  }
  if (!modelReady || !sentimentPipeline) {
    showError("Model not ready. Please wait.");
    logAction("analyze_blocked", "Model not ready");
    return;
  }
  if (isAnalyzing) return;

  var review = reviews[Math.floor(Math.random() * reviews.length)];
  if (reviewDisplay) reviewDisplay.textContent = review;

  setAnalyzeButtonLoading(true);
  if (resultSubtext) resultSubtext.textContent = "Running inference...";

  try {
    logAction("inference_start", "Inference started", {
      review_preview: review.slice(0, 200),
      meta: "len=" + review.length
    });

    var output = await sentimentPipeline(review);
    if (!output || !output[0]) throw new Error("Unexpected model output");

    var label = String(output[0].label || "").toUpperCase();
    var score = Number(output[0].score);

    var bucket = bucketize(label, score);
    updateResultUI(bucket, label, score);

    logAction("inference_success", "Inference complete", {
      sentiment: label,
      confidence: score,
      review_preview: review.slice(0, 200),
      meta: "bucket=" + bucket
    });
  } catch (err) {
    var msg = (err && err.message) ? err.message : String(err);
    showError("Inference failed: " + msg);
    logAction("inference_fail", "Inference failed", { meta: msg });
  } finally {
    setAnalyzeButtonLoading(false);
    updateButtonState();
  }
}

// ---------------- STARTUP ----------------
window.addEventListener("DOMContentLoaded", function() {
  setStatus("Initializing…", false, false);
  updateOverallStatus();
  updateButtonState();

  logAction("page_open", "Page opened");

  if (analyzeBtn) {
    analyzeBtn.addEventListener("click", analyzeRandomReview);
  }

  loadReviewsTSV()
    .then(function() {
      setStatus("TSV ready: " + reviews.length + " reviews loaded", false, false);
      updateOverallStatus();
      updateButtonState();
    })
    .catch(function(err) {
      tsvReady = false;
      reviews = [];
      var msg = (err && err.message) ? err.message : String(err);
      showError("TSV error: " + msg);
      setStatus("TSV failed to load", false, true);
      logAction("tsv_fail", "TSV failed", { meta: msg });
      updateOverallStatus();
      updateButtonState();
    });

  initModel()
    .then(function() {
      setStatus("Model ready", true, false);
      updateOverallStatus();
      updateButtonState();
    })
    .catch(function(err) {
      modelReady = false;
      sentimentPipeline = null;
      var msg = (err && err.message) ? err.message : String(err);
      showError("Model error: " + msg);
      setStatus("Model failed to load", false, true);
      logAction("model_fail", "Model failed", { meta: msg });
      updateOverallStatus();
      updateButtonState();
    });
});
