
const express = require('express');
const { OpenAI } = require('openai');
const { Telegraf } = require('telegraf');

const app = express();
app.use(express.json({ limit: '1mb' }));

// ==========================================
// 1. CONFIGURATION
// ==========================================

const PORT = process.env.PORT || 3000;

const openai = process.env.OPENAI_API_KEY
    ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    : null;

const tgBot = process.env.TELEGRAM_BOT_TOKEN
    ? new Telegraf(process.env.TELEGRAM_BOT_TOKEN)
    : null;

const INSTAGRAM_VERIFY_TOKEN =
    process.env.INSTAGRAM_VERIFY_TOKEN || '';

const AI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

// ==========================================
// 2. BASE TOXICITY DICTIONARY
// RU / KZ / EN
// ==========================================

const baseTriggers = [
    // Russian
    'мамбет', 'котак', 'мыркымбай', 'шешен',
    'дебил', 'идиот', 'лох', 'мразь', 'тварь',
    'урод', 'сука', 'бля', 'пидор', 'сдохни',
    'убью', 'ненавижу', 'заткнись', 'чмо',
    'даун', 'жирный', 'тупой', 'ничтожество',

    // Kazakh
    'мамбет', 'қотақ', 'қатын', 'мал',
    'надан', 'ақымақ', 'жексұрын', 'оңбаған',

    // English
    'stupid', 'idiot', 'loser', 'kys',
    'killyourself', 'stfu', 'shutup',
    'bitch', 'ugly', 'moron', 'retard',
    'freak', 'pathetic', 'worthless',
    'trash', 'dumbass', 'asshole',
    'fuck', 'shit', 'bastard', 'slut',
    'whore', 'cunt', 'faggot', 'gtfo'
];

const dynamicDictionary = new Set(baseTriggers);

// ==========================================
// 3. TEXT NORMALIZATION
// ==========================================

function normalizeText(text) {
    return String(text)
        .toLowerCase()
        .normalize('NFKC')
        .replace(/[@4]/g, 'а')
        .replace(/0/g, 'о')
        .replace(/3/g, 'з')
        .replace(/[1!]/g, 'и')
        .replace(/[$5]/g, 'с')
        .replace(/[^a-zа-яёәіңғүұқөһ0-9\s]/gi, ' ')
        .replace(/(.)\1{2,}/gu, '$1$1')
        .replace(/\s+/g, ' ')
        .trim();
}

// ==========================================
// 4. LOCAL DICTIONARY CHECK
// ==========================================

function checkLocalDictionary(text) {
    const normalized = normalizeText(text);

    const words = normalized.split(/\s+/);

    const matches = words.filter(word =>
        word.length >= 3 && dynamicDictionary.has(word)
    );

    return {
        detected: matches.length > 0,
        matches
    };
}

// ==========================================
// 5. AI MODERATION ENGINE
// ==========================================

async function checkTextToxicity(userText) {
    const startTime = Date.now();

    if (typeof userText !== 'string' || !userText.trim()) {
        throw new Error('Invalid text');
    }

    if (userText.length > 5000) {
        throw new Error('Text is too long');
    }

    const localResult = checkLocalDictionary(userText);

    // AI analysis
    if (openai) {
        try {
            const response = await openai.chat.completions.create({
                model: AI_MODEL,
                temperature: 0.1,
                max_tokens: 250,
                response_format: { type: 'json_object' },

                messages: [
                    {
                        role: 'system',
                        content: `
You are Aigis AI Shield, a multilingual cyberbullying
moderation assistant.

Analyze messages in Russian, Kazakh and English.

Detect:
- Direct insults and harassment
- Threats and intimidation
- Hate speech
- Cyberbullying
- Humiliation and targeted abuse

Important rules:
- Do not classify harmless jokes automatically as bullying.
- Do not classify supportive messages as toxic.
- Quoted insults used to report bullying are not automatically toxic.
- Consider the full context.
- Distinguish criticism of an idea from attacks against a person.

Return ONLY valid JSON:

{
  "toxic": true,
  "score": 0.95,
  "category": "Harassment",
  "reason": "Краткое объяснение на русском языке"
}

The score must be between 0 and 1.
`
                    },
                    {
                        role: 'user',
                        content: userText
                    }
                ]
            });

            const content = response.choices[0].message.content;
            const result = JSON.parse(content);

            if (
                typeof result.toxic !== 'boolean' ||
                typeof result.score !== 'number' ||
                !Number.isFinite(result.score)
            ) {
                throw new Error('Invalid AI response');
            }

            return {
                toxic: result.toxic,
                score: Math.max(0, Math.min(1, result.score)),
                category: String(result.category || 'Unknown').slice(0, 80),
                reason: String(result.reason || 'Результат анализа').slice(0, 300),
                latency: Date.now() - startTime,
                engine: 'OpenAI + Local Dictionary'
            };

        } catch (error) {
            console.error('AI analysis error:', error.message);
        }
    }

    // Fallback if OpenAI is unavailable
    const latency = Date.now() - startTime;

    if (localResult.detected) {
        return {
            toxic: true,
            score: 0.85,
            category: 'Potentially offensive language',
            reason: 'Обнаружена лексика, требующая проверки',
            latency,
            engine: 'Local Dictionary (Fallback)'
        };
    }

    return {
        toxic: false,
        score: 0.05,
        category: 'Safe Content',
        reason: 'Совпадений в локальном словаре не обнаружено',
        latency,
        engine: 'Local Dictionary (Fallback)'
    };
}

// ==========================================
// 6. TELEGRAM BOT
// ==========================================

function escapeHTML(text) {
    return String(text).replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[char]);
}

if (tgBot) {

    tgBot.start(async (ctx) => {
        await ctx.reply(
            `🛡️ <b>Aigis AI Shield</b>\n\n` +
            `Интеллектуальная система защиты от кибербуллинга.\n\n` +
            `🌍 Языки: RU / KZ / EN\n` +
            `🧠 AI Engine: ${openai ? 'Active' : 'Fallback Mode'}\n` +
            `📚 Dictionary: ${dynamicDictionary.size} patterns\n\n` +
            `Отправь сообщение, чтобы проверить его.`,
            { parse_mode: 'HTML' }
        );
    });

    tgBot.command('sync', async (ctx) => {
        await ctx.reply(
            `✅ Локальный словарь активен.\n` +
            `Количество паттернов: ${dynamicDictionary.size}`
        );
    });

    tgBot.command('status', async (ctx) => {
        await ctx.reply(
            `🛡️ Aigis System Status\n\n` +
            `AI: ${openai ? 'Connected' : 'Unavailable'}\n` +
            `Dictionary: ${dynamicDictionary.size}\n` +
            `Model: ${openai ? AI_MODEL : 'Local fallback'}`
        );
    });

    tgBot.on('text', async (ctx) => {
        const message = ctx.message.text;

        if (message.startsWith('/')) return;

        try {
            const analysis = await checkTextToxicity(message);

            if (analysis.toxic) {

                // Delete toxic messages in groups.
                if (ctx.chat.type !== 'private') {
                    try {
                        await ctx.deleteMessage();
                    } catch (error) {
                        console.log('Cannot delete message:', error.message);
                    }
                }

                await ctx.reply(
                    `🚨 <b>Aigis Shield: Potential bullying detected</b>\n\n` +
                    `• Reason: ${escapeHTML(analysis.reason)}\n` +
                    `• Category: ${escapeHTML(analysis.category)}\n` +
                    `• Toxicity score: ${analysis.score.toFixed(2)}\n` +
                    `• Analysis time: ${analysis.latency} ms`,
                    { parse_mode: 'HTML' }
                );

            } else {
                await ctx.reply(
                    `✨ <b>Aigis Shield: Message appears safe</b>\n\n` +
                    `• Toxicity score: ${analysis.score.toFixed(2)}\n` +
                    `• Analysis time: ${analysis.latency} ms`,
                    { parse_mode: 'HTML' }
                );
            }

        } catch (error) {
            console.error('Telegram moderation error:', error.message);
            await ctx.reply('⚠️ Не удалось проверить сообщение. Попробуйте позже.');
        }
    });

    tgBot.launch()
        .then(() => console.log('Telegram bot started!'))
        .catch(error => console.error('Telegram launch error:', error));

    process.once('SIGINT', () => tgBot.stop('SIGINT'));
    process.once('SIGTERM', () => tgBot.stop('SIGTERM'));
}

// ==========================================
// 7. REST API
// ==========================================

app.get('/api/health', (req, res) => {
    res.json({
        status: 'online',
        project: 'Aigis AI Shield',
        ai: openai ? 'connected' : 'fallback',
        dictionarySize: dynamicDictionary.size,
        timestamp: new Date().toISOString()
    });
});

app.post('/api/moderate', async (req, res) => {
    try {
        const { text } = req.body || {};

        if (typeof text !== 'string' || !text.trim()) {
            return res.status(400).json({
                error: 'Text is required'
            });
        }

        if (text.length > 5000) {
            return res.status(413).json({
                error: 'Text exceeds 5000 characters'
            });
        }

        const result = await checkTextToxicity(text);

        res.json(result);

    } catch (error) {
        console.error('API error:', error.message);

        res.status(500).json({
            error: 'Moderation service temporarily unavailable'
        });
    }
});

// ==========================================
// 8. INSTAGRAM WEBHOOK VERIFICATION
// ==========================================

app.get('/webhook/instagram', (req, res) => {

    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (
        mode === 'subscribe' &&
        token === INSTAGRAM_VERIFY_TOKEN &&
        challenge
    ) {
        return res.status(200).send(challenge);
    }

    return res.sendStatus(403);
});

// Receives Instagram webhook events.
// Full message moderation requires Meta app subscriptions,
// access tokens and signature verification.
app.post('/webhook/instagram', (req, res) => {
    console.log('Instagram webhook event received');

    res.sendStatus(200);
});

// ==========================================
// 9. WEB DEMONSTRATION
// ==========================================

app.get('/', (req, res) => {

    res.send(`<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">

<title>Aigis AI Shield</title>

<style>
* { box-sizing: border-box; }

body {
    font-family: 'Segoe UI', Arial, sans-serif;
    background: #0f172a;
    color: #f8fafc;
    min-height: 100vh;
    margin: 0;
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 20px;
}

.card {
    background: #1e293b;
    border: 1px solid #334155;
    border-radius: 20px;
    max-width: 580px;
    width: 100%;
    padding: 32px;
    box-shadow: 0 20px 50px rgba(0,0,0,.35);
}

.badge {
    display: inline-block;
    background: #2563eb;
    padding: 6px 13px;
    border-radius: 20px;
    font-size: 11px;
    font-weight: bold;
    letter-spacing: 1px;
    margin-bottom: 18px;
}

h1 {
    margin: 0;
    font-size: 30px;
}

.subtitle {
    color: #94a3b8;
    line-height: 1.6;
    font-size: 14px;
    margin: 14px 0 24px;
}

textarea {
    width: 100%;
    min-height: 120px;
    resize: vertical;
    padding: 15px;
    background: #0f172a;
    border: 1px solid #475569;
    border-radius: 12px;
    color: white;
    font-size: 15px;
    outline: none;
}

textarea:focus {
    border-color: #38bdf8;
}

button {
    width: 100%;
    margin-top: 15px;
    padding: 15px;
    border: none;
    border-radius: 10px;
    background: linear-gradient(135deg,#2563eb,#0284c7);
    color: white;
    font-size: 16px;
    font-weight: bold;
    cursor: pointer;
}

button:disabled {
    opacity: .6;
    cursor: wait;
}

.result {
    margin-top: 22px;
    padding: 18px;
    border-radius: 12px;
    display: none;
    line-height: 1.8;
    font-size: 14px;
    overflow-wrap: anywhere;
}

.toxic {
    background: rgba(239,68,68,.12);
    border: 1px solid #ef4444;
    color: #fca5a5;
}

.safe {
    background: rgba(34,197,94,.12);
    border: 1px solid #22c55e;
    color: #86efac;
}

.meta {
    color: #64748b;
    font-size: 12px;
    text-align: center;
    margin-top: 25px;
}
</style>
</head>

<body>

<div class="card">

<div class="badge">KIMEP AI CHALLENGE 2026</div>

<h1>🛡️ Aigis AI Shield</h1>

<p class="subtitle">
Интеллектуальная система обнаружения кибербуллинга
и токсичности в цифровом пространстве.
<br><br>
Поддержка русского, казахского и английского языков.
Попробуйте проверить сообщение с помощью AI.
</p>

<textarea
id="msg"
maxlength="5000"
placeholder="Введите сообщение для проверки..."
></textarea>

<button id="checkButton" onclick="checkMessage()">
Проверить сообщение
</button>

<div id="res" class="result"></div>

<div class="meta">
Aigis AI Shield • Hybrid AI Moderation System
<br>
Dictionary: ${dynamicDictionary.size} patterns
<br>
Telegram: @Aigisshieldbot
</div>

</div>

<script>
async function checkMessage() {

    const text = document.getElementById('msg').value.trim();
    const resBox = document.getElementById('res');
    const button = document.getElementById('checkButton');

    if (!text) {
        resBox.style.display = 'block';
        resBox.className = 'result toxic';
        resBox.textContent = 'Пожалуйста, введите сообщение.';
        return;
    }

    button.disabled = true;
    button.textContent = 'Анализируем...';

    resBox.style.display = 'block';
    resBox.className = 'result';
    resBox.textContent = '⏳ Aigis AI анализирует сообщение...';

    try {

        const response = await fetch('/api/moderate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ text })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Server error');
        }

        if (data.toxic) {

            resBox.className = 'result toxic';

            resBox.textContent =
                '🚨 ПОТЕНЦИАЛЬНО ТОКСИЧНОЕ СООБЩЕНИЕ\\n\\n' +
                'Причина: ' + data.reason + '\\n' +
                'Категория: ' + data.category + '\\n' +
                'Индекс токсичности: ' + data.score.toFixed(2) + '\\n' +
                'Время анализа: ' + data.latency + ' мс\\n' +
                'Движок: ' + data.engine;

        } else {

            resBox.className = 'result safe';

            resBox.textContent =
                '✨ СООБЩЕНИЕ НЕ СОДЕРЖИТ ОБНАРУЖЕННЫХ НАРУШЕНИЙ\\n\\n' +
                'Индекс токсичности: ' + data.score.toFixed(2) + '\\n' +
                'Время анализа: ' + data.latency + ' мс\\n' +
                'Движок: ' + data.engine;
        }

    } catch (error) {

        resBox.className = 'result toxic';
        resBox.textContent = 'Ошибка: ' + error.message;

    } finally {

        button.disabled = false;
        button.textContent = 'Проверить сообщение';
    }
}
</script>

</body>
</html>`);
});

// ==========================================
// 10. START SERVER
// ==========================================

app.listen(PORT, () => {
    console.log('================================');
    console.log('🛡️ AIGIS AI SHIELD');
    console.log('================================');
    console.log('Server running on port:', PORT);
    console.log('AI:', openai ? 'Connected' : 'Fallback mode');
    console.log('Dictionary:', dynamicDictionary.size);
    console.log('================================');
});
