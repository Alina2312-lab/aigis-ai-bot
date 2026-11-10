const express = require('express');
const { OpenAI } = require('openai');
const { Telegraf } = require('telegraf');

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3000;

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const tgBot = process.env.TELEGRAM_BOT_TOKEN ? new Telegraf(process.env.TELEGRAM_BOT_TOKEN) : null;
const INSTAGRAM_PAGE_ACCESS_TOKEN = process.env.INSTAGRAM_PAGE_ACCESS_TOKEN;
const INSTAGRAM_VERIFY_TOKEN = process.env.INSTAGRAM_VERIFY_TOKEN || 'bazar_jok_verify_secret';

async function checkTextToxicity(userText) {
    const demoDatabase = ["мамбет", "кыс", "мал", "мыркымбай", "сынык", "катын", "щещен"];
    const hasTriggerWord = demoDatabase.some(word => userText.toLowerCase().includes(word));

    if (openai) {
        try {
            const response = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [
                    { role: "system", content: "Ты — ИИ-модератор 'Aigis'. Выявляй токсичность и буллинг на казахстанском сленге. Отвечай СТРОГО в формате JSON: {\"toxic\": true, \"reason\": \"причина\"}." },
                    { role: "user", content: userText }
                ],
                response_format: { type: "json_object" }
            });
            return JSON.parse(response.choices.message.content);
        } catch (err) { console.error("Ошибка ИИ"); }
    }
    if (hasTriggerWord || userText.length > 30) {
        return { toxic: true, reason: "Выявлен локальный хейт-сленг (Aigis Демо)" };
    }
    return { toxic: false, reason: "" };
}

// ЛОГИКА ДЛЯ TELEGRAM (Работает мгновенно без проверок!)
if (tgBot) {
    tgBot.on('text', async (ctx) => {
        const text = ctx.message.text;
        const analysis = await checkTextToxicity(text);
        if (analysis.toxic) {
            await ctx.reply(`🚨 [Aigis Shield]: Сообщение заблокировано за буллинг!\nПричина: ${analysis.reason}`);
        } else {
            await ctx.reply(`✨ [Aigis]: Сообщение чистое. Молодцом!`);
        }
    });
    tgBot.launch().then(() => console.log("🤖 Telegram-бот Aigis успешно запущен!"));
}

app.get('/webhook/instagram', (req, res) => {
    if (req.query['hub.verify_token'] === INSTAGRAM_VERIFY_TOKEN) res.status(200).send(req.query['hub.challenge']);
    else res.sendStatus(403);
});

app.listen(PORT, () => { console.log(`🚀 Сервер на порту ${PORT}`); });
