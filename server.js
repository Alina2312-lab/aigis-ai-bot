const express = require('express');
const WebSocket = require('ws');
const { OpenAI } = require('openai');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
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
        } catch (err) {
            console.error("Ошибка ИИ, работает локальный фильтр");
        }
    }
    if (hasTriggerWord || userText.length > 30) {
        return { toxic: true, reason: "Выявлен локальный хейт-сленг (Aigis Демо)" };
    }
    return { toxic: false, reason: "" };
}

app.get('/webhook/instagram', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token === INSTAGRAM_VERIFY_TOKEN) {
        console.log('✅ Webhook Aigis успешно верифицирован Meta!');
        res.status(200).send(challenge);
    } else {
        res.sendStatus(403);
    }
});

app.post('/webhook/instagram', async (req, res) => {
    const body = req.body;
    if (body.object === 'instagram') {
        for (const entry of body.entry) {
            if (!entry.messaging) continue;
            for (const hookEvent of entry.messaging) {
                const senderId = hookEvent.sender.id;
                if (hookEvent.message && hookEvent.message.text) {
                    const text = hookEvent.message.text;
                    console.log(`📥 Сообщение в Instagram Direct: "${text}"`);
                    const analysis = await checkTextToxicity(text);

                    if (analysis.toxic) {
                        console.log(`🚨 [Aigis Shield]: Перехват хейта!`);
                        await sendInstagramReply(senderId, `🚨 Модератор Aigis: Ваше сообщение заблокировано за буллинг. Причина: ${analysis.reason}`);
                    }
                }
            }
        }
        res.status(200).send('EVENT_RECEIVED');
    } else {
        res.sendStatus(404);
    }
});

async function sendInstagramReply(recipientId, textToSend) {
    const token = process.env.INSTAGRAM_PAGE_ACCESS_TOKEN;
    if (!token) {
        console.error("Ошибка: Токен INSTAGRAM_PAGE_ACCESS_TOKEN не найден в настройках Render!");
        return;
    }
    try {
        const url = `https://facebook.com{token}`;
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                recipient: { id: recipientId }, 
                message: { text: textToSend } 
            })
        });
        console.log("✅ Автоответ успешно отправлен хейтеру в Instagram Direct!");
    } catch (err) { 
        console.error("Ошибка отправки в Instagram:", err); 
    }
}
app.listen(PORT, () => { console.log(`🚀 Сервер Aigis в онлайне на порту ${PORT}`); });
