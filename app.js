import { pipeline } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.6/dist/transformers.min.js";

/* Google Apps Script Web App (/exec) */
const GOOGLE_WEBAPP_URL =
  "https://script.google.com/macros/s/AKfycbzdE1BRZOatG0tfEqe66aTMOhd0Qsjk5AZV7IQLy7tpapMJICoT3BeMKI5XnFPsSpVf/exec";

/* TSV from GitHub RAW (change main -> master if needed) */
const TSV_URL =
  "https://raw.githubusercontent.com/pavelbakalenko-pixel/Pavel-B-DE/main/reviews_test.tsv";

/* ---------------- DOM ---------------- */
function getEl(id) { return document.getElementById(id); }

var els = {
  analyzeBtn: getEl("analyzeBtn"),
  status: getEl("status"),
  statusText: getEl("statusText"),
  errorBox: getEl("errorBox"),
  reviewDisplay: getEl("reviewDisplay"),
  resultArea: getEl("resultArea"),
  resultIcon: getEl("resultIcon"),
  sentimentLabel: getEl("sentimentLabel"),
  confidenceText: getEl("confidenceText"),
  resultSubtext: getEl("resultSubtext"),
  actionMessage: getEl("actionMessage")
};

/* ---------------- STATE ---------------- */
var reviews = [];
var model = null;
var modelReady = false;
var tsvReady = false;
var isAnalyzing = false;

/* ---------------- UI ---------------- */
function setStatus(message, ready, error) {
  if (els.statusText) els.statusText.textContent = message;

  if (els.status) {
    els.status.classList.remove("ready");
    els.status.classList.remove("error");
    if (ready === true) els.status.classList.add("ready");
    if (error === true) els.status.classList.add("error");
  }
}

function showError(message) {
  console.error(message);
  if (!els.errorBox) return;
  els.errorBox.textContent = message;
  els.errorBox.classList.add("show");
}

function clearError() {
  if (!els.errorBox) return;
  els.errorBox.textContent = "";
  els.errorBox.classList.remove("show");
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
  if (!els.analyzeBtn) return;
  var enabled = modelReady && tsvReady && reviews.length > 0 && !isAnalyzing;
  els.analyzeBtn.disabled = !enabled;
}

function setAnalyzeButtonLoading(loading) {
  if (!els.analyzeBtn) return;

  isAnalyzing = loading;

  if (loading) {
    els.analyzeBtn.disabled = true;
    els.analyzeBtn.innerHTML = '<span class="spinner"></span> Analyzing...';
  } else {
    els.analyzeBtn.innerHTML = '<i class="fa-solid fa-shuffle"></i> Analyze random review';
    updateButtonState();
  }
}

function updateResultUI(bucket, label, score) {
  if (!els.resultArea) return;

  els.resultArea.classList.remove("positive");
  els.resultArea.classList.remove("negative");
  els.resultArea.classList.remove("neutral");

  var percent = "—";
  if (typeof score === "number" && isFinite(score)) {
    percent = (score * 100).toFixed(1);
  }

  if (bucket === "positive") {
    els.resultArea.classList.add("positive");
    if (els.resultIcon) els.resultIcon.innerHTML = '<i class="fa-solid fa-thumbs-up"></i>';
  } else if (bucket === "negative") {
    els.resultArea.classList.add("negative");
    if (els.resultIcon) els.resultIcon.innerHTML = '<i class="fa-solid fa-thumbs-down"></i>';
  } else {
    els.resultArea.classList.add("neutral");
    if (els.resultIcon) els.resultIcon.innerHTML = '<i class="fa-solid fa-question-circle"></i>';
  }

  if (els.sentimentLabel) els.sentimentLabel.textContent = label;
  if (els.confidenceText) els.confidenceText.textContent = "(" + percent + "% confidence)";
  if (els.resultSubtext) els.resultSubtext.textContent = "Analysis complete.";
}

function updateBusinessMessage(action) {
  if (!els.actionMessage) return;

  if (action === "OFFER_COUPON") {
    els.actionMessage.textContent = "We’re sorry about your experience. Here’s a coupon to make it right.";
    els.actionMessage.className = "action negative";
  } else if (action === "UPSELL") {
    els.actionMessage.textContent = "Glad you loved it! Check out our premium option.";
    els.actionMessage.className = "action positive";
  } else {
    els.actionMessage.textContent = "Thanks for your feedback!";
    els.actionMessage.className = "action neutral";
  }
}

/* ---------------- BUSINESS LOGIC ---------------- */
function mapSentimentToAction(bucket) {
  if (bucket === "negative") return "OFFER_COUPON";
  if (bucket === "positive") return "UPSELL";
  return "NO_ACTION";
}

/* ---------------- LOGGING (CORS-free GET beacon) ---------------- */
function sendLogToGoogleSheets(payload) {
  try {
    if (!GOOGLE_WEBAPP_URL) return;

    // Keep payload small (URL limits)
    payload.review = String(payload.review || "").slice(0, 800);
    payload.sentiment = String(payload.sentiment || "").slice(0, 80);
    payload.meta = String(payload.meta || "").slice(0, 800);
    payload.action_taken = String(payload.action_taken || "").slice(0, 40);

    var encoded = encodeURIComponent(JSON.stringify(payload));
    var img = new Image();
    img.src = GOOGLE_WEBAPP_URL + "?data=" + encoded + "&_=" + Date.now();
  } catch (err) {
    console.warn("Log failed:", err);
  }
}

function buildMeta() {
  var metaObj = {
    ua: navigator.userAgent,
    page: location.href,
    screen: window.innerWidth + "x" + window.innerHeight,
    t: Date.now()
  };
  return JSON.stringify(metaObj);
}

/* ---------------- TSV ---------------- */
async function loadReviewsTSV() {
  var res = await fetch(TSV_URL, { cache: "no-store" });
  if (!res.ok) throw new Error("Cannot fetch TSV (HTTP " + res.status + ")");

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

  if (reviews.length === 0) throw new Error('No valid rows found in TSV column "text".');

  tsvReady = true;
}

/* ---------------- MODEL ---------------- */
async function initModel() {
  model = await pipeline(
    "text-classification",
    "Xenova/distilbert-base-uncased-finetuned-sst-2-english",
    { dtype: "q8" }
  );
  modelReady = true;
}

/* ---------------- INFERENCE HELPERS ---------------- */
function bucketize(label, score) {
  if (label === "POSITIVE" && score > 0.5) return "positive";
  if (label === "NEGATIVE" && score > 0.5) return "negative";
  return "neutral";
}

/* ---------------- MAIN FLOW ---------------- */
async function analyzeRandomReview() {
  clearError();

  if (!tsvReady || reviews.length === 0) {
    showError("TSV not ready.");
    return;
  }
  if (!modelReady || !model) {
    showError("Model not ready.");
    return;
  }
  if (isAnalyzing) return;

  var review = reviews[Math.floor(Math.random() * reviews.length)];
  if (els.reviewDisplay) els.reviewDisplay.textContent = review;

  setAnalyzeButtonLoading(true);
  if (els.resultSubtext) els.resultSubtext.textContent = "Running inference...";

  try {
    var output = await model(review);
    if (!output || !output[0]) throw new Error("Unexpected model output");

    var label = String(output[0].label || "").toUpperCase();
    var score = Number(output[0].score);

    var bucket = bucketize(label, score);

    // 1) UI sentiment result
    updateResultUI(bucket, label, score);

    // 2) Decision maker: sentiment -> action
    var actionTaken = mapSentimentToAction(bucket);

    // 3) UI business message
    updateBusinessMessage(actionTaken);

    // 4) Enhanced logging: required columns
    var payload = {
      ts_iso: new Date().toISOString(),
      review: review,
      sentiment: label + " (" + (score * 100).toFixed(1) + "%)",
      meta: buildMeta(),
      action_taken: actionTaken
    };

    sendLogToGoogleSheets(payload);
  } catch (err) {
    showError("Analysis failed: " + (err && err.message ? err.message : String(err)));
  } finally {
    setAnalyzeButtonLoading(false);
    updateButtonState();
  }
}

/* ---------------- STARTUP ---------------- */
window.addEventListener("DOMContentLoaded", function() {
  setStatus("Initializing…", false, false);
  updateOverallStatus();
  updateButtonState();

  if (els.analyzeBtn) els.analyzeBtn.addEventListener("click", analyzeRandomReview);

  loadReviewsTSV()
    .then(function() {
      setStatus("TSV ready: " + reviews.length + " reviews loaded", false, false);
      updateOverallStatus();
      updateButtonState();
    })
    .catch(function(err) {
      tsvReady = false;
      reviews = [];
      showError("TSV error: " + (err && err.message ? err.message : String(err)));
      setStatus("TSV failed", false, true);
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
      model = null;
      showError("Model error: " + (err && err.message ? err.message : String(err)));
      setStatus("Model failed", false, true);
      updateOverallStatus();
      updateButtonState();
    });
});
