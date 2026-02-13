// app.js — complete browser‑side sentiment analysis + JSONP logging (CORS-free)
import { pipeline } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.6/dist/transformers.min.js";

// ==================== DOM элементы ====================
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

// ==================== состояние приложения ====================
let reviews = [];               // массив отзывов
let sentimentPipeline = null;    // модель
let modelReady = false;
let tsvLoaded = false;

// ==================== URL твоего Google Apps Script (ВСТАВЬ СВОЙ!) ====================
const GAS_URL = 'https://script.google.com/macros/s/AKfycbw_uzWIONJoCDlK5kEDVqk2KnCPrgzJiguxLs5UiVrzKapi-UtIaKC6PMRbthJNPrfd/exec';

// ==================== JSONP функция (обходит CORS) ====================
function jsonpRequest(data) {
  return new Promise((resolve, reject) => {
    // Создаем уникальное имя callback-функции
    const callbackName = 'jsonp_cb_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    
    // Таймаут на случай ошибки
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('JSONP timeout'));
    }, 10000);

    // Функция очистки
    function cleanup() {
      if (window[callbackName]) {
        delete window[callbackName];
      }
      const script = document.getElementById(callbackName);
      if (script) {
        document.body.removeChild(script);
      }
      clearTimeout(timeout);
    }

    // Создаем глобальную функцию обратного вызова
    window[callbackName] = function(response) {
      cleanup();
      console.log('✅ JSONP ответ:', response);
      resolve(response);
    };

    // Создаем script-тег (это и есть JSONP)
    const script = document.createElement('script');
    script.id = callbackName;
    
    // Кодируем данные и добавляем callback в URL
    const encodedData = encodeURIComponent(JSON.stringify(data));
    script.src = `${GAS_URL}?callback=${callbackName}&data=${encodedData}`;
    
    script.onerror = function(error) {
      cleanup();
      reject(new Error('JSONP error: ' + error));
    };

    // Добавляем скрипт на страницу - запрос уходит автоматически
    document.body.appendChild(script);
  });
}

// ==================== функция отправки лога в Google Sheets ====================
async function logToGoogleSheet(reviewText, sentimentResult, confidenceScore) {
  // Формируем данные для отправки
  const payload = {
    ts_iso: new Date().toISOString(),                    // колонка 1: временная метка
    review: reviewText,                                    // колонка 2: текст отзыва
    sentiment: `${sentimentResult} (${(confidenceScore * 100).toFixed(1)}%)`, // колонка 3: тональность
    meta: JSON.stringify({                                 // колонка 4: мета-информация
      userAgent: navigator.userAgent,
      url: window.location.href,
      timestamp: Date.now(),
      screen: `${window.innerWidth}x${window.innerHeight}`
    })
  };

  console.log('📤 Отправка в Google Sheets:', payload);

  try {
    // Отправляем через JSONP (обходит CORS)
    await jsonpRequest(payload);
    console.log('✅ Данные успешно отправлены через JSONP');
    
    // Запасной вариант через изображение (на всякий случай)
    const img = new Image();
    img.src = `${GAS_URL}?data=${encodeURIComponent(JSON.stringify(payload))}`;
    img.style.display = 'none';
    document.body.appendChild(img);
    setTimeout(() => {
      if (img.parentNode) document.body.removeChild(img);
    }, 1000);
    
  } catch (error) {
    console.error('❌ Ошибка отправки:', error);
    
    // Последний шанс - sendBeacon
    const blob = new Blob([JSON.stringify(payload)], { type: 'text/plain' });
    navigator.sendBeacon(GAS_URL, blob);
    console.log('📡 Отправлено через sendBeacon как fallback');
  }
}

// ==================== helpers UI ====================
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
  sentimentLabel.textContent = label.split('(')[0].trim();
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

// ==================== загрузка TSV ====================
async function loadReviewsTSV() {
  try {
    setStatus('⏳', '📦 loading reviews_test.tsv ...', false, true);
    const response = await fetch('reviews_test.tsv');
    if (!response.ok) throw new Error(`HTTP ${response.status} — cannot fetch TSV`);

    const tsvText = await response.text();
    
    Papa.parse(tsvText, {
      header: true,
      delimiter: '\t',
      skipEmptyLines: true,
      complete: (result) => {
        try {
          if (result.errors && result.errors.length) {
            console.warn('PapaParse warnings:', result.errors);
          }
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

// ==================== инициализация модели ====================
async function initModel() {
  try {
    setStatus('🧠', '⏳ loading sentiment model (first time may take a moment) …', false, true);
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
    statusMsg.textContent += ' — ready to analyze';
  }
}

// ==================== основной анализ ====================
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

  const randomIndex = Math.floor(Math.random() * reviews.length);
  const selectedReview = reviews[randomIndex];
  reviewDisplay.textContent = selectedReview;

  setLoadingAnalysis(true);

  try {
    const result = await sentimentPipeline(selectedReview);
    if (!Array.isArray(result) || result.length === 0) {
      throw new Error('Unexpected model output format');
    }

    const top = result[0];
    let rawLabel = top.label.toUpperCase();
    let rawScore = top.score;

    let finalSentiment = 'neutral';
    if (rawLabel.includes('POSITIVE') && rawScore > 0.5) {
      finalSentiment = 'positive';
    } else if (rawLabel.includes('NEGATIVE') && rawScore > 0.5) {
      finalSentiment = 'negative';
    } else {
      finalSentiment = 'neutral';
    }

    // Обновляем интерфейс
    updateResultUI(finalSentiment, rawScore);
    
    // 🚀 ОТПРАВЛЯЕМ ЛОГ В GOOGLE SHEETS (JSONP метод)
    await logToGoogleSheet(selectedReview, finalSentiment.toUpperCase(), rawScore);

  } catch (inferErr) {
    console.error('inference error:', inferErr);
    showError(`Analysis failed: ${inferErr.message}`, 6000);
    resultIcon.innerHTML = '<i class="fa-regular fa-circle-question"></i>';
    sentimentLabel.textContent = 'error';
    confidenceText.textContent = '—';
    resultArea.classList.remove('positive', 'negative', 'neutral');
  } finally {
    setLoadingAnalysis(false);
  }
}

// ==================== запуск ====================
window.addEventListener('DOMContentLoaded', async () => {
  setStatus('⏳', 'initializing...', false, true);
  await Promise.allSettled([loadReviewsTSV(), initModel()]);
  analyzeBtn.addEventListener('click', analyzeRandomReview);
  enableIfReady();
});
