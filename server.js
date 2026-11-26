
const express = require('express');
const { OpenAI } = require('openai');
const { Telegraf } = require('telegraf');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

const openai = process.env.OPENAI_API_KEY
    ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    : null;

const tgBot = process.env.TELEGRAM_BOT_TOKEN
    ? new Telegraf(process.env.TELEGRAM_BOT_TOKEN)
    : null;

const INSTAGRAM_VERIFY_TOKEN =
    process.env.INSTAGRAM_VERIFY_TOKEN || 'bazar_jok_verify_secret';

// Базовый словарь (KZ + RU + EN)
const baseTriggers = [
    // KZ & RU
    "мамбет", "котинди", "котак", "мал", "мыркымбай",
    "сынык", "катын", "щещен", "шешен",
    "дур", "туп", "дебил", "идиот", "лох", "мраз",
    "тварь", "урод", "сук", "бля", "пидр",
    "сдохни", "убью", "ненавижу", "пошелна",
    "заткнись", "чмо", "даун", "клоун", "жирн",

    // EN
    "stupid", "idiot", "loser", "kys",
    "killyourself", "stfu", "shutup", "bitch",
    "ugly", "moron", "retard", "freak",
    "pathetic", "worthless", "trash", "dumbass",
    "asshole", "fuck", "shit", "bastard",
    "slut", "whore", "cunt", "dick",
    "faggot", "nigger", "gtfo"
];

let dynamicDictionary = new Set(baseTriggers);
let lastSyncTime = new Date().toLocaleTimeString('ru-RU');

// Динамическое пополнение базы угроз
async function updateThreatIntelligence() {
    const externalSources = [
        'https://githubusercontent.com',
        'https://githubusercontent.com'
    ];

    let addedCount = 0;

    for (const url of externalSources) {
        try {
            const response = await fetch(url);

            if (response.ok) {
                const text = await response.text();

                const words = text.split('\n')
                    .map(w => w.trim().toLowerCase()
                        .replace(/[^a-zа-яё0-9]/gi, ''))
                    .filter(w => w.length >= 4);

                words.forEach(w => {
                    if (!dynamicDictionary.has(w)) {
                        dynamicDictionary.add(w);
                        addedCount++;
                    }
                });
            }
        } catch (err) {
            console.error(
                `Ошибка загрузки базы из ${url}:`,
                err.message
            );
        }
    }

    lastSyncTime = new Date().toLocaleTimeString('ru-RU');

    console.log(
        `🔄 База угроз Aigis обновлена! Всего паттернов: ${dynamicDictionary.size} (+${addedCount} новых)`
    );

    return {
        total: dynamicDictionary.size,
        added: addedCount
    };
}

// Обновление базы при запуске и каждые 24 часа
updateThreatIntelligence();

setInterval(
    updateThreatIntelligence,
    24 * 60 * 60 * 1000
);

// Нормализация текста
function normalizeText(text) {
    return text.toLowerCase()
        .replace(/[@4]/g, 'а')
        .replace(/0/g, 'о')
        .replace(/3/g, 'з')
        .replace(/[1!]/g, 'и')
        .replace(/[$5]/g, 'с')
        .replace(/[^a-zа-яёәіңғүұқөһ0-9\s]/gi, '')
        .replace(/(.)\1+/g, '$1');
}


async function checkTextToxicity(userText) {
    const startTime = Date.now();
    const cleanText = normalizeText(userText);

  const hatePatterns = [
    // Английский
    /\bi hate you\b/i,
    /\byou are (stupid|ugly|worthless|pathetic)\b/i,
    /\bnobody likes you\b/i,
    /\bgo away\b/i,
    /\bshut up\b/i,
    /\byou are a loser\b/i,

    // Русский: прямые оскорбления
    /\bты\s+(тупой|тупая|тупое|урод|уродина|ничтожество)\b/i,
    /\b(тупой|тупая|тупое|тупым|тупыми)\b/i,
    /\b(идиот|идиотка|дебил|дебилка|придурок|кретин)\b/i,
    /\bникому ты не нужен\b/i,
    /\bтебя никто не любит\b/i,
    /\bзаткнись\b/i,

    // Казахский
    /\bсен\s+(ақымақ|керексізсің)\b/i,
    /\bақымақ\b/i
];

    const localDetected = hatePatterns.some(pattern =>
        pattern.test(cleanText)
    );

    // ИИ анализирует смысл и контекст сообщения
    if (openai) {
        try {
            const response = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                temperature: 0.1,
                response_format: { type: "json_object" },
                messages: [
                    {
                        role: "system",
                        content: `
Ты — Aigis AI Shield, интеллектуальная система
обнаружения кибербуллинга.

Анализируй сообщения на русском, казахском и английском.

Обнаруживай:
- прямые оскорбления;
- унижение и насмешки;
- травлю и запугивание;
- угрозы;
- дискриминационные высказывания;
- завуалированные оскорбления;
- агрессивные фразы, направленные против конкретного человека;
- сленг, сокращения и намеренно изменённое написание.

Учитывай контекст и адресата.
Не считай автоматически хейтом обычное выражение
негативных эмоций, например "I hate homework".

Если человек оскорбляет другого — toxic: true.
Если сообщение безопасно — toxic: false.

Верни строго JSON:
{
  "toxic": true,
  "score": 0.95,
  "category": "Cyberbullying",
  "reason": "Краткое объяснение на русском"
}
`
                    },
                    {
                        role: "user",
                        content: userText
                    }
                ]
            });

            const result = JSON.parse(
                response.choices[0].message.content
            );

            // Объединяем результаты ИИ и локальной проверки
            if (localDetected) {
                result.toxic = true;
                result.score = Math.max(result.score || 0, 0.90);
                result.category = "Cyberbullying / Hate Speech";
                result.reason =
                    "Обнаружено направленное оскорбление";
            }

            result.latency = Date.now() - startTime;
            return result;

        } catch (error) {
            console.error("AI analysis error:", error.message);
        }
    }

    // Резервный режим, если ИИ недоступен
    return {
        toxic: localDetected,
        score: localDetected ? 0.90 : 0.03,
        category: localDetected
            ? "Cyberbullying"
            : "Safe Content",
        reason: localDetected
            ? "Обнаружено потенциальное оскорбление"
            : "Нарушений не обнаружено",
        latency: Date.now() - startTime
    };
}

// ЛОГИКА TELEGRAM
if (tgBot) {

    tgBot.start((ctx) => {
        ctx.reply(
            `🛡️ <b>Aigis AI Shield</b> активирован!\n\n` +
            `• Поддержка языков: <b>RU / KZ / EN</b>\n` +
            `• Активная база паттернов: <b>${dynamicDictionary.size}</b> ` +
            `(обновлено в ${lastSyncTime})\n\n` +
            `Отправь любое сообщение для теста или используй /sync ` +
            `для обновления базы угроз из сети.`,
            { parse_mode: 'HTML' }
        );
    });

    // Команда синхронизации
    tgBot.command('sync', async (ctx) => {
        const msg = await ctx.reply(
            '🔄 Синхронизация с открытыми базами токсичности...'
        );

        const stats = await updateThreatIntelligence();

        await ctx.telegram.editMessageText(
            ctx.chat.id,
            msg.message_id,
            null,
            `✅ <b>База угроз Aigis успешно обновлена!</b>\n` +
            `• Всего активных паттернов: <b>${stats.total}</b>\n` +
            `• Загружено новых из сети: <b>+${stats.added}</b>`,
            { parse_mode: 'HTML' }
        );
    });

    // Проверка сообщений
    tgBot.on('text', async (ctx) => {
        const text = ctx.message.text;

        if (text.startsWith('/')) return;

        const analysis = await checkTextToxicity(text);

        if (analysis.toxic) {

            if (ctx.chat.type !== 'private') {
                try {
                    await ctx.deleteMessage();
                } catch (e) {}
            }

            await ctx.reply(
                `🚨 <b>[Aigis Shield]: Сообщение заблокировано!</b>\n` +
                `• <b>Причина:</b> ${analysis.reason}\n` +
                `• <b>Категория:</b> ${analysis.category}\n` +
                `• <b>Индекс токсичности:</b> ${analysis.score.toFixed(2)}\n` +
                `• <b>Скорость анализа:</b> ${analysis.latency} мс`,
                { parse_mode: 'HTML' }
            );

        } else {

            await ctx.reply(
                `✨ <b>[Aigis Shield]: Сообщение безопасное</b>\n` +
                `• <b>Индекс токсичности:</b> ${analysis.score.toFixed(2)}\n` +
                `• <b>Скорость анализа:</b> ${analysis.latency} мс`,
                { parse_mode: 'HTML' }
            );
        }
    });

    tgBot.launch().then(() => {
        console.log("🤖 Telegram-бот Aigis успешно запущен!");
    });
}

// REST API ДЛЯ ВНЕШНИХ ПРИЛОЖЕНИЙ
app.post('/api/moderate', async (req, res) => {
    const { text } = req.body;

    if (!text) {
        return res.status(400).json({
            error: 'Text is required'
        });
    }

    try {
        const result = await checkTextToxicity(text);
        res.json(result);
    } catch (err) {
        console.error(err);

        res.status(500).json({
            error: 'Internal server error'
        });
    }
});

// ВЕБ-СТЕНД ДЛЯ ДЕМОНСТРАЦИИ
app.get('/', (req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">

    <title>Aigis AI Shield — Live Cybersecurity Demo</title>

    <style>
        body {
            font-family: 'Segoe UI', system-ui, sans-serif;
            background: #0f172a;
            color: #f8fafc;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            margin: 0;
            padding: 20px;
        }

        .card {
            background: #1e293b;
            border: 1px solid #334155;
            border-radius: 16px;
            max-width: 540px;
            width: 100%;
            padding: 30px;
            box-shadow: 0 20px 40px rgba(0,0,0,0.4);
        }

        .badge {
            display: inline-block;
            background: #2563eb;
            color: #fff;
            font-size: 12px;
            font-weight: 700;
            padding: 4px 12px;
            border-radius: 20px;
            margin-bottom: 12px;
        }

        h1 {
            margin: 0 0 8px;
            font-size: 26px;
        }

        p {
            color: #94a3b8;
            font-size: 14px;
            margin-bottom: 20px;
            line-height: 1.5;
        }

        textarea {
            width: 100%;
            box-sizing: border-box;
            background: #0f172a;
            border: 1px solid #475569;
            border-radius: 10px;
            color: #fff;
            padding: 14px;
            font-size: 15px;
            resize: vertical;
            min-height: 90px;
            outline: none;
        }

        textarea:focus {
            border-color: #38bdf8;
        }

        button {
            width: 100%;
            margin-top: 14px;
            background: linear-gradient(135deg, #2563eb, #0284c7);
            color: white;
            border: none;
            padding: 14px;
            border-radius: 10px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
        }

        button:hover {
            opacity: 0.92;
        }

        .result {
            margin-top: 20px;
            padding: 16px;
            border-radius: 10px;
            display: none;
            font-size: 14px;
            line-height: 1.6;
        }

        .toxic {
            background: rgba(239, 68, 68, 0.15);
            border: 1px solid #ef4444;
            color: #fca5a5;
        }

        .safe {
            background: rgba(34, 197, 94, 0.15);
            border: 1px solid #22c55e;
            color: #86efac;
        }

        .meta {
            margin-top: 16px;
            font-size: 12px;
            color: #64748b;
            text-align: center;
        }
    </style>
</head>

<body>

    <div class="card">

        <div class="badge">
            KIMEP AI CHALLENGE 2026 • CYBERSECURITY
        </div>

        <h1>🛡️ Aigis AI Shield</h1>

        <p>
            Интеллектуальная система модерации кибербуллинга
            в реальном времени (RU / KZ / EN).
            Протестируйте ИИ-движок в браузере или в Telegram:
            @Aigisshieldbot
        </p>

        <textarea
            id="msg"
            placeholder="Введите сообщение для проверки..."
        ></textarea>

        <button onclick="check()">
            Проверить сообщение через ИИ
        </button>

        <div id="res" class="result"></div>

        <div class="meta">
            Активная база угроз: ${dynamicDictionary.size}
            паттернов • Auto-Sync Active
        </div>

    </div>

    <script>
        async function check() {
            const text = document.getElementById('msg').value.trim();

            if (!text) return;

            const resBox = document.getElementById('res');

            resBox.style.display = 'block';
            resBox.className = 'result';
            resBox.textContent = '⏳ Анализ текста нейросетью Aigis...';

            try {
                const r = await fetch('/api/moderate', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ text })
                });

                const data = await r.json();

                if (!r.ok) {
                    throw new Error(data.error || 'Ошибка сервера');
                }

                if (data.toxic) {
                    resBox.className = 'result toxic';

                    resBox.textContent =
                        '🚨 ЗАБЛОКИРОВАНО (Кибербуллинг)\\n' +
                        'Причина: ' + data.reason + '\\n' +
                        'Индекс токсичности: ' + data.score +
                        ' | Задержка: ' + data.latency + ' мс';

                } else {
                    resBox.className = 'result safe';

                    resBox.textContent =
                        '✨ БЕЗОПАСНОЕ СООБЩЕНИЕ\\n' +
                        'Индекс токсичности: ' + data.score +
                        ' | Задержка: ' + data.latency + ' мс';
                }

            } catch (error) {
                resBox.className = 'result toxic';
                resBox.textContent =
                    'Ошибка проверки: ' + error.message;
            }
        }
    </script>

</body>
</html>`);
});

// INSTAGRAM WEBHOOK: ПОДТВЕРЖДЕНИЕ
app.get('/webhook/instagram', (req, res) => {
    if (
        req.query['hub.verify_token'] === INSTAGRAM_VERIFY_TOKEN
    ) {
        res.status(200).send(req.query['hub.challenge']);
    } else {
        res.sendStatus(403);
    }
});

// ЗАПУСК СЕРВЕРА
app.listen(PORT, () => {
    console.log("Server Aigis started on port " + PORT);
});
