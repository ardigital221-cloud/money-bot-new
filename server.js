const express = require('express');
const { Telegraf, Markup } = require('telegraf');
const admin = require('firebase-admin');
const axios = require('axios');

if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
}
const db = admin.firestore();
const bot = new Telegraf(process.env.BOT_TOKEN);
const app = express();

app.use(express.static('public'));

// --- ФУНКЦИЯ НЕЙРОСЕТИ (OpenRouter) ---
async function parseWithAI(text) {
    try {
        const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
            model: 'mistralai/mistral-7b-instruct:free', // Бесплатная модель
            messages: [{
                role: 'system',
                content: `Ты финансовый ассистент. Преврати текст в JSON. 
                Кошельки: 'main' (баланс), 'deposit' (копилка), 'borrowed' (я взял в долг), 'lent' (я дал в долг).
                Правила:
                - "Депозит/копилка 5000": wallet='deposit', amount=-5000
                - "Взял в долг 2000": wallet='borrowed', amount=2000
                - "Дал в долг 3000": wallet='lent', amount=-3000
                - Обычные траты (еда, такси): wallet='main', amount=отрицательный.
                - Доходы (зарплата): wallet='main', amount=положительный.
                Верни ТОЛЬКО JSON: {"amount": число, "category": "строка", "wallet": "строка"}`
            }, { role: 'user', content: text }],
        }, {
            headers: { 'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' }
        });

        return JSON.parse(response.data.choices[0].message.content);
    } catch (e) {
        console.error("AI Error:", e.message);
        return null;
    }
}

// --- API ДЛЯ ПРИЛОЖЕНИЯ ---
app.get('/api/stats/:userId', async (req, res) => {
    const snap = await db.collection('users').doc(req.params.userId).collection('transactions').orderBy('date', 'desc').get();
    let s = { main: 0, deposit: 0, borrowed: 0, lent: 0, categories: {}, history: [] };

    snap.forEach(doc => {
        const d = doc.data();
        const v = d.amount;
        if (d.wallet === 'deposit') { s.deposit += Math.abs(v); s.main -= Math.abs(v); }
        else if (d.wallet === 'borrowed') { s.borrowed += Math.abs(v); s.main += Math.abs(v); }
        else if (d.wallet === 'lent') { s.lent += Math.abs(v); s.main -= Math.abs(v); }
        else { s.main += v; }
        if (v < 0) s.categories[d.category] = (s.categories[d.category] || 0) + Math.abs(v);
        s.history.push(d);
    });
    res.json(s);
});

// --- ЛОГИКА БОТА ---
bot.on('text', async (ctx) => {
    if (ctx.message.text.startsWith('/')) return;
    
    const waitMsg = await ctx.reply('⏳ Думаю...');
    const aiData = await parseWithAI(ctx.message.text);
    await ctx.deleteMessage(waitMsg.message_id);

    if (aiData) {
        await db.collection('users').doc(String(ctx.from.id)).collection('transactions').add({
            ...aiData, date: admin.firestore.FieldValue.serverTimestamp()
        });
        const status = aiData.amount > 0 ? '💰 Пришло' : '📉 Ушло';
        ctx.reply(`${status}: ${Math.abs(aiData.amount)} ₸\nКатегория: ${aiData.category}\nКошелек: ${aiData.wallet}`);
    } else {
        ctx.reply('Не понял тебя. Попробуй: "Такси 1500" или "Депозит 20к"');
    }
});

bot.start(ctx => ctx.reply('Салем! 🇰🇿 Я запомню каждую твою покупку.', Markup.keyboard([[Markup.button.webApp('📊 Мой учет ₸', process.env.APP_URL)]]).resize()));

bot.launch();
app.listen(process.env.PORT || 3000);
