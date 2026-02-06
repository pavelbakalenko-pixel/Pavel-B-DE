import { pipeline } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.6/dist/transformers.min.js";

let reviews = [];
let sentimentPipeline = null;

// DOM elements
const analyzeBtn = document.getElementById("analyzeBtn");
const reviewBox = document.getElementById("reviewBox");
const resultEl = document.getElementById("result");
const statusEl = document.getElementById("status");
const errorEl = document.getElementById("error");

document.addEventListener("DOMContentLoaded", async () => {
  clearError();
  setStatus("Loading reviews and sentiment model…");

  try {
    await loadReviews();
    setStatus("Reviews loaded. Loading sentiment model…");
    await initModel();
    setStatus("Sentiment model ready.");
  } catch (err) {
    handleError(err, "Initialization failed. Please check the console for details.");
  }

  analyzeBtn.addEventListener("click", onAnalyzeClick);
});

/**
 * Fetches and parses the TSV file containing reviews.
 */
async function loadReviews() {
  let response;
  try {
    response = await fetch("reviews_test.tsv");
  } catch (err) {
    throw new Error("Network error while loading the TSV file.");
  }

  if (!response.ok) {
    throw new Error(`Failed to load TSV file (status ${response.status}).`);
  }

  const tsvText = await response.text();

  return new Promise((resolve, reject) => {
    Papa.parse(tsvText, {
      header: true,
      delimiter: "\t",
      skipEmptyLines: true,
      complete: (results) => {
        try {
          if (!results.data || !Array.isArray(results.data)) {
            throw new Error("Parsed data is invalid.");
          }

          // Attempt to extract the "text" column; fallback to first column if needed
          reviews = results.data
            .map((row) => {
              if (typeof row.text === "string") {
                return row.text.trim();
              }
              const firstKey = Object.keys(row)[0];
              return typeof row[firstKey] === "string" ? row[firstKey].trim() : null;
            })
            .filter((text) => typeof text === "string" && text.length > 0);

          if (reviews.length === 0) {
            throw new Error("No valid review texts found in TSV.");
          }

          resolve();
        } catch (err) {
          reject(err);
        }
      },
      error: (err) => {
        reject(new Error(`TSV parsing error: ${err.message}`));
      },
    });
  });
}

/**
 * Initializes the Transformers.js sentiment analysis pipeline.
 */
async function initModel() {
  try {
    sentimentPipeline = await pipeline(
      "text-classification",
      "Xenova/distilbert-base-uncased-finetuned-sst-2-english"
    );
  } catch (err) {
    console.error(err);
    throw new Error("Failed to load sentiment model.");
  }
}

/**
 * Handles the analyze button click.
 */
async function onAnalyzeClick() {
  clearError();
  resultEl.style.display = "none";

  if (!reviews || reviews.length === 0) {
    showError("No reviews are loaded. Cannot run analysis.");
    return;
  }

  if (!sentimentPipeline) {
    showError("Sentiment model is not ready yet.");
    return;
  }

  const review = getRandomReview();
  reviewBox.textContent = review;

  analyzeBtn.disabled = true;
  setStatus("Analyzing sentiment…");

  try {
    const output = await sentimentPipeline(review);
    const normalized = normalizeOutput(output);
    updateResult(normalized);
    setStatus("Analysis complete.");
  } catch (err) {
    handleError(err, "Sentiment analysis failed.");
  } finally {
    analyzeBtn.disabled = false;
  }
}

/**
 * Selects a random review from the loaded list.
 */
function getRandomReview() {
  const index = Math.floor(Math.random() * reviews.length);
  return reviews[index];
}

/**
 * Normalizes the pipeline output into a single { label, score } object.
 */
function normalizeOutput(output) {
  if (!Array.isArray(output) || output.length === 0) {
    throw new Error("Invalid model output.");
  }

  const top = output[0];
  if (typeof top.label !== "string" || typeof top.score !== "number") {
    throw new Error("Unexpected sentiment output format.");
  }

  return {
    label: top.label.toUpperCase(),
    score: top.score,
  };
}

/**
 * Maps the sentiment to positive, negative, or neutral and updates the UI.
 */
function updateResult({ label, score }) {
  let sentimentClass = "neutral";
  let iconClass = "fa-question-circle";
  let displayLabel = "NEUTRAL";

  if (label === "POSITIVE" && score > 0.5) {
    sentimentClass = "positive";
    iconClass = "fa-thumbs-up";
    displayLabel = "POSITIVE";
  } else if (label === "NEGATIVE" && score > 0.5) {
    sentimentClass = "negative";
    iconClass = "fa-thumbs-down";
    displayLabel = "NEGATIVE";
  }

  const confidence = (score * 100).toFixed(1);

  resultEl.className = `result ${sentimentClass}`;
  resultEl.innerHTML = `
    <i class="fa ${iconClass}"></i>
    <span>${displayLabel} (${confidence}% confidence)</span>
  `;
  resultEl.style.display = "flex";
}

/**
 * Updates the status text.
 */
function setStatus(message) {
  statusEl.textContent = message;
}

/**
 * Displays a user-friendly error message.
 */
function showError(message) {
  errorEl.textContent = message;
  errorEl.style.display = "block";
}

/**
 * Clears any visible error message.
 */
function clearError() {
  errorEl.textContent = "";
  errorEl.style.display = "none";
}

/**
 * Logs an error and shows a user-friendly message.
 */
function handleError(err, userMessage) {
  console.error(err);
  showError(userMessage);
  setStatus("");
}
