import { pipeline } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.6/dist/transformers.min.js";

const GOOGLE_WEBAPP_URL =
  "https://script.google.com/macros/s/AKfycbzdE1BRZOatG0tfEqe66aTMOhd0Qsjk5AZV7IQLy7tpapMJICoT3BeMKI5XnFPsSpVf/exec";

var reviews = [];
var sentimentPipeline = null;
var modelReady = false;
var tsvReady = false;
var isAnalyzing = false;

// ---------- DOM ----------
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

// ---------- UI ----------
function setStatus(message, ready, error) {
  if (!statusText) return;

  statusText.textContent = message;

  if (statusEl) {
    statusEl.classList.remove("ready");
    statusEl.classList.remove("error");

    if (ready === true) statusEl.classList.add("ready");
    if (error === true) statusEl.classList.add("error");
  }
}

function showError(message) {
  if (!errorBox) return;
  console.error(message);
  errorBox.textContent = message;
  errorBox.classList.add("show");
}

function clearError() {
  if (!errorBox) return;
  errorBox.textContent = "";
  errorBox.classList.remove("show");
}

function setAnalyzeButtonLoading(loading) {
  if (!analyzeBtn) return;

  isAnalyzing = loading;

  if (loading) {
    analyzeBtn.disabled = true;
    analyzeBtn.innerHTML =
      '<span class="spinner"></span> Analyzing...';
  } else {
    analyzeBtn.innerHTML =
      '<i class="fa-solid fa-shuffle"></i> Analyze random review';

    if (modelReady && tsvReady && reviews.length > 0) {
      analyzeBtn.disabled = false;
    } else {
      analyzeBtn.disabled = true;
    }
  }
}

function updateResultUI(bucket, label, score) {
  if (!resultArea) return;

  resultArea.classList.remove("positive");
  resultArea.classList.remove("negative");
  resultArea.classList.remove("neutral");

  var percent = "—";
  if (typeof score === "number") {
    percent = (score * 100).toFixed(1);
  }

  if (bucket === "positive") {
    resultArea.classList.add("positive");
    resultIcon.innerHTML =
      '<i class="fa-solid fa-thumbs-up"></i>';
  } else if (bucket === "negative") {
    resultArea.classList.add("negative");
    resultIcon.innerHTML =
      '<i class="fa-solid fa-thumbs-down"></i>';
  } else {
    resultArea.classList.add("neutral");
    resultIcon.innerHTML =
      '<i class="fa-solid fa-question-circle"></i>';
  }

  sentimentLabel.textContent = label;
  confidenceText.textContent =
    "(" + percent + "% confidence)";
  resultSubtext.textContent = "Analysis complete.";
}

// ---------- LOGGING ----------
function sendLogToGoogleSheets(payload) {
  try {
    var img = new Image();
    var encoded = encodeURIComponent(JSON.stringify(payload));
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

function logAction(eventName, message) {
  sendLogToGoogleSheets({
    ts: new Date().toISOString(),
    event: eventName,
    message: message,
    url: location.href,
    userAgent: navigator.userAgent
  });
}

// ---------- TSV ----------
async function loadReviewsTSV() {
  setStatus("Loading reviews_test.tsv...", false, false);
  logAction("tsv_start", "Loading TSV");

  var res = await fetch("reviews_test.tsv");
  if (!res.ok) {
    throw new Error("TSV fetch failed");
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
    .map(function(r) { return r.text; })
    .filter(function(v) {
      return typeof v === "string" && v.trim().length > 0;
    });

  if (reviews.length === 0) {
    throw new Error("No valid reviews found in TSV");
  }

  tsvReady = true;
  setStatus("TSV ready: " + reviews.length + " reviews loaded", false, false);
  logAction("tsv_success", "TSV loaded");
}

// ---------- MODEL ----------
async function initModel() {
  setStatus("Loading sentiment model...", false, false);
  logAction("model_start", "Loading model");

  sentimentPipeline = await pipeline(
    "text-classification",
    "Xenova/distilbert-base-uncased-finetuned-sst-2-english"
  );

  modelReady = true;
  setStatus("Model ready", true, false);
  logAction("model_success", "Model loaded");
}

// ---------- INFERENCE ----------
function bucketize(label, score) {
  if (label === "POSITIVE" && score > 0.5) {
    return "positive";
  }
  if (label === "NEGATIVE" && score > 0.5) {
    return "negative";
  }
  return "neutral";
}

async function analyzeRandomReview() {
  clearError();

  if (!tsvReady || !modelReady) {
    return;
  }

  var review =
    reviews[Math.floor(Math.random() * reviews.length)];

  reviewDisplay.textContent = review;
  setAnalyzeButtonLoading(true);

  try {
    var output = await sentimentPipeline(review);
    var top = output[0];
    var label = top.label.toUpperCase();
    var score = top.score;

    var bucket = bucketize(label, score);

    updateResultUI(bucket, label, score);

    logAction("inference_success", "Inference complete");
  } catch (err) {
    showError("Inference failed: " + err.message);
    logAction("inference_fail", err.message);
  } finally {
    setAnalyzeButtonLoading(false);
  }
}

// ---------- START ----------
window.addEventListener("DOMContentLoaded", async function() {
  setStatus("Initializing...", false, false);
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

  if (analyzeBtn) {
    analyzeBtn.addEventListener("click", analyzeRandomReview);
  }
});
