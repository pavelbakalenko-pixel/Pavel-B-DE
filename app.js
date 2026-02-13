// app.js — Fully client-side TSV loading + Transformers.js inference + Google Sheets logging (CORS-free)
import { pipeline } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.6/dist/transformers.min.js";

const GOOGLE_WEBAPP_URL =
  "https://script.google.com/macros/s/AKfycbzdE1BRZOatG0tfEqe66aTMOhd0Qsjk5AZV7IQLy7tpapMJICoT3BeMKI5XnFPsSpVf/exec";

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
    img.src = `${GOOGLE_WEBAPP_URL}?data=${data}&_=${Date.n_
