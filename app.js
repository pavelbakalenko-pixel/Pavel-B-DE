import { pipeline } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.2/dist/transformers.min.js";

// ===== ПОЛУЧАЕМ ЭЛЕМЕНТЫ =====
const reviewBox = document.getElementById('reviewBox');
const analyzeBtn = document.getElementById('analyzeBtn');
const resultDiv = document.getElementById('result');
const statusDiv = document.getElementById('status');
const errorDiv = document.getElementById('error');
const footerDiv = document.getElementById('footer');

// СОЗДАЕМ элемент для действий
let actionDiv = document.getElementById('action-result');
if (!actionDiv) {
    actionDiv = document.createElement('div');
    actionDiv.id = 'action-result';
    actionDiv.style.margin = '20px 0';
    if (resultDiv && resultDiv.parentNode) {
        resultDiv.parentNode.insertBefore(actionDiv, resultDiv.nextSibling);
    } else {
        document.querySelector('.container').appendChild(actionDiv);
    }
}

// ===== ПЕРЕМЕННЫЕ =====
let reviews = [];
let model = null;
let isModelReady = false;
let isDataLoaded = false;

// URL для логирования - ВАШ URL
const SHEET_URL = 'https://script.google.com/macros/s/AKfycbzDGTzLKk5iB2CwCqctagrZOd4nnpT6H0DKMPtO62sCs_AZtRpHkZeAqj-pUBKaMq2wMw/exec';

// ===== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ =====
function updateStatus(text) {
    console.log('📌', text);
    if (statusDiv) statusDiv.textContent = text;
}

function showError(text) {
    console.error('❌', text);
    if (errorDiv) {
        errorDiv.textContent = text;
        errorDiv.style.display = 'block';
    }
}

function hideError() {
    if (errorDiv) errorDiv.style.display = 'none';
}

function showResult(text, type) {
    if (!resultDiv) return;
    resultDiv.className = `result ${type}`;
    resultDiv.innerHTML = text;
    resultDiv.style.display = 'block';
}

/**
 * ОПРЕДЕЛЕНИЕ БИЗНЕС-ДЕЙСТВИЯ (ТОЧНО ПО ЗАДАНИЮ)
 */
function determineBusinessAction(confidence, label) {
    console.log('🧠 Принимаем решение:', { label, confidence });
    
    // Нормализуем оценку в шкалу от 0 (плохо) до 1 (хорошо)
    let normalizedScore = 0.5;
    
    if (label === "POSITIVE") {
        normalizedScore = confidence; // 0.9 -> 0.9
    } else if (label === "NEGATIVE") {
        normalizedScore = 1.0 - confidence; // 0.9 негатива -> 0.1
    }
    
    console.log('📊 Нормализованная оценка:', normalizedScore.toFixed(2));
    
    // Применяем пороговые значения ИЗ ЗАДАНИЯ
    if (normalizedScore <= 0.4) {
        return {
            actionCode: "OFFER_COUPON",
            uiMessage: "🚨 Нам искренне жаль! Пожалуйста, примите купон на 50% скидку.",
            uiColor: "#ef4444",
            icon: "fa-gift",
            buttonText: "Получить купон",
            bgColor: "#fee2e2"
        };
    } else if (normalizedScore < 0.7) {
        return {
            actionCode: "REQUEST_FEEDBACK",
            uiMessage: "📝 Спасибо! Расскажите подробнее, как мы можем улучшить сервис?",
            uiColor: "#6b7280",
            icon: "fa-comment",
            buttonText: "Оставить отзыв",
            bgColor: "#f3f4f6"
        };
    } else {
        return {
            actionCode: "ASK_REFERRAL",
            uiMessage: "⭐ Рады, что вам понравилось! Порекомендуйте нас друзьям и получите бонусы.",
            uiColor: "#3b82f6",
            icon: "fa-share-alt",
            buttonText: "Пригласить друзей",
            bgColor: "#dbeafe"
        };
    }
}

/**
 * ОТОБРАЖЕНИЕ ДЕЙСТВИЯ
 */
function showAction(decision) {
    if (!actionDiv) return;
    
    console.log('🎯 Показываем действие:', decision.actionCode);
    
    actionDiv.innerHTML = `
        <div style="
            background: ${decision.bgColor};
            border: 2px solid ${decision.uiColor};
            border-radius: 12px;
            padding: 20px;
            margin: 20px 0;
            text-align: center;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        ">
            <i class="fas ${decision.icon}" style="
                font-size: 48px;
                color: ${decision.uiColor};
                margin-bottom: 10px;
            "></i>
            <p style="
                font-size: 18px;
                color: #1f2937;
                margin: 10px 0;
                font-weight: 500;
            ">${decision.uiMessage}</p>
            <button onclick="alert('✅ ${decision.actionCode}')" style="
                background: ${decision.uiColor};
                color: white;
                border: none;
                padding: 12px 30px;
                border-radius: 8px;
                cursor: pointer;
                font-size: 16px;
                font-weight: 600;
                margin-top: 10px;
                transition: transform 0.2s;
            " onmouseover="this.style.transform='scale(1.05)'" 
               onmouseout="this.style.transform='scale(1)'">
                ${decision.buttonText}
            </button>
        </div>
    `;
    
    actionDiv.style.display = 'block';
}

// ===== ЗАГРУЗКА ДАННЫХ =====
async function loadReviews() {
    updateStatus('Загрузка отзывов...');
    
    try {
        const response = await fetch('reviews_test.tsv');
        
        if (!response.ok) {
            throw new Error('Файл не найден');
        }
        
        const text = await response.text();
        
        const result = Papa.parse(text, {
            header: true,
            delimiter: '\t',
            skipEmptyLines: true
        });
        
        reviews = result.data
            .map(row => row.text || Object.values(row)[0])
            .filter(text => text && text.length > 10);
        
        if (reviews.length === 0) {
            throw new Error('Нет отзывов');
        }
        
        updateStatus(`Загружено ${reviews.length} отзывов`);
        
    } catch (error) {
        console.warn('Ошибка загрузки:', error);
        
        reviews = [
            "This product is amazing! I love it so much. Best purchase ever!",
            "Terrible quality, broke after 2 days. Very disappointed.",
            "It's okay, nothing special but works.",
            "Absolutely fantastic! Best purchase ever.",
            "Waste of money. Don't buy this.",
            "Good value for the price, would recommend.",
            "The worst experience I've ever had."
        ];
        
        showError('Используются тестовые данные');
        updateStatus(`Загружено ${reviews.length} тестовых отзывов`);
    }
    
    isDataLoaded = true;
}

// ===== ЗАГРУЗКА МОДЕЛИ =====
async function loadModel() {
    updateStatus('Загрузка модели... (может занять минуту)');
    
    try {
        model = await pipeline(
            'text-classification',
            'Xenova/distilbert-base-uncased-finetuned-sst-2-english',
            { quantized: true }
        );
        
        isModelReady = true;
        updateStatus('Модель готова! ✅');
        
    } catch (error) {
        console.error('Ошибка модели:', error);
        
        model = async (text) => {
            const rand = Math.random();
            if (rand > 0.6) return [{ label: 'POSITIVE', score: 0.95 }];
            if (rand > 0.3) return [{ label: 'NEGATIVE', score: 0.9 }];
            return [{ label: 'NEUTRAL', score: 0.6 }];
        };
        
        isModelReady = true;
        showError('Используется тестовая модель');
        updateStatus('Тестовая модель готова ⚠️');
    }
}

// ===== ЛОГИРОВАНИЕ - УПРОЩЕННАЯ ВЕРСИЯ =====
async function logToSheet(data) {
    try {
        console.log('📤 Отправляем данные:', data);
        
        // Создаем простые параметры
        const params = new URLSearchParams();
        params.append('timestamp', data.timestamp);
        params.append('review', data.review);
        params.append('sentiment', data.sentiment);
        params.append('confidence', data.confidence);
        params.append('action_taken', data.action_taken);
        params.append('meta', JSON.stringify(data.meta));
        
        const url = SHEET_URL + '?' + params.toString();
        console.log('📤 URL:', url);
        
        // Используем fetch с режимом no-cors
        fetch(url, {
            method: 'GET',
            mode: 'no-cors'
        }).catch(err => {
            console.warn('Fetch error, пробуем Image:', err);
            // Если fetch не работает, пробуем Image
            const img = new Image();
            img.src = url;
        });
        
        if (footerDiv) {
            footerDiv.innerHTML = '✅ Данные отправлены';
            footerDiv.style.color = '#4caf50';
        }
        
    } catch (error) {
        console.error('❌ Ошибка логирования:', error);
        if (footerDiv) {
            footerDiv.innerHTML = '⚠️ Ошибка сохранения';
            footerDiv.style.color = '#f44336';
        }
    }
}

// ===== АНАЛИЗ =====
async function analyze() {
    hideError();
    
    if (!isDataLoaded || reviews.length === 0) {
        showError('Нет отзывов для анализа');
        return;
    }
    
    if (!isModelReady || !model) {
        showError('Модель ещё не готова');
        return;
    }
    
    analyzeBtn.disabled = true;
    actionDiv.style.display = 'none';
    
    try {
        const randomIndex = Math.floor(Math.random() * reviews.length);
        const review = reviews[randomIndex];
        
        reviewBox.textContent = review;
        updateStatus('Анализ...');
        
        const result = await model(review);
        const sentiment = result[0];
        
        let type = 'neutral';
        let icon = 'fa-question-circle';
        let text = 'NEUTRAL';
        
        if (sentiment.label === 'POSITIVE' && sentiment.score > 0.5) {
            type = 'positive';
            icon = 'fa-thumbs-up';
            text = 'POSITIVE';
        } else if (sentiment.label === 'NEGATIVE' && sentiment.score > 0.5) {
            type = 'negative';
            icon = 'fa-thumbs-down';
            text = 'NEGATIVE';
        }
        
        const confidence = (sentiment.score * 100).toFixed(1);
        
        // Показываем результат анализа
        showResult(`
            <i class="fas ${icon}" style="font-size: 24px; margin-right: 10px;"></i>
            <strong>${text}</strong> (${confidence}% confidence)
        `, type);
        
        // Принимаем бизнес-решение
        const decision = determineBusinessAction(sentiment.score, sentiment.label);
        console.log('✅ Решение:', decision.actionCode);
        
        // Показываем действие
        showAction(decision);
        
        updateStatus('Анализ завершён');
        
        // Логируем с action_taken
        const meta = {
            userAgent: navigator.userAgent,
            language: navigator.language,
            screen: `${window.screen.width}x${window.screen.height}`,
            url: window.location.href,
            reviewsCount: reviews.length
        };
        
        await logToSheet({
            timestamp: new Date().toISOString(),
            review: review.substring(0, 300),
            sentiment: text,
            confidence: confidence,
            action_taken: decision.actionCode,
            meta: meta
        });
        
    } catch (error) {
        console.error('Ошибка:', error);
        showError('Ошибка при анализе');
        updateStatus('Ошибка');
        
    } finally {
        analyzeBtn.disabled = false;
    }
}

// ===== ЗАПУСК =====
document.addEventListener('DOMContentLoaded', async () => {
    console.log('🚀 Запуск приложения');
    updateStatus('Инициализация...');
    
    await loadReviews();
    await loadModel();
    
    if (analyzeBtn) {
        analyzeBtn.addEventListener('click', analyze);
    }
    
    updateStatus('Готово! Нажмите кнопку для анализа');
    if (footerDiv) footerDiv.innerHTML = '📊 Бизнес-логика активна';
});
