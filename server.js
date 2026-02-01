const express = require('express');
const { Telegraf, Markup } = require('telegraf');
const admin = require('firebase-admin');
const axios = require('axios');

// Инициализация Firebase
if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
}
const db = admin.firestore();
const bot = new Telegraf(process.env.BOT_TOKEN);
const app = express();

app.use(express.static('public'));

// --- НЕЙРОСЕТЬ ---
async function parseWithAI(text) {
    try {
        const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
            model: 'mistralai/mistral-7b-instruct:free',
            messages: [{
                role: 'system',
                content: `Ты финансовый ассистент. Преврати текст в JSON. 
                Кошельки: 'main', 'deposit', 'borrowed', 'lent'.
                Верни ТОЛЬКО JSON: {"amount": число, "category": "строка", "wallet": "строка"}`
            }, { role: 'user', content: text }],
        }, {
            headers: { 'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' }
        });
        return JSON.parse(response.data.choices[0].message.content);
    } catch (e) { return null; }
}

// --- API ---
app.get('/api/stats/:userId', async (req, res) => {
    try {
        const snap = await db.collection('users').doc(req.params.userId).collection('transactions').orderBy('date', 'desc').get();
        let s = { main: 0, deposit: 0, borrowed: 0, lent: 0, categories: {}, history: [] };
        snap.forEach(doc => {
            const d = doc.data(); const v = d.amount;
            if (d.wallet === 'deposit') { s.deposit += Math.abs(v); s.main -= Math.abs(v); }
            else if (d.wallet === 'borrowed') { s.borrowed += Math.abs(v); s.main += Math.abs(v); }
            else if (d.wallet === 'lent') { s.lent += Math.abs(v); s.main -= Math.abs(v); }
            else { s.main += v; }
            if (v < 0) s.categories[d.category] = (s.categories[d.category] || 0) + Math.abs(v);
            s.history.push(d);
        });
        res.json(s);
    } catch (e) { res.status(500).send(e.message); }
});

// --- БОТ ---
bot.start(ctx => ctx.reply('Салем! 🇰🇿', Markup.keyboard([
    [Markup.button.webApp('📊 Мой учет ₸', process.env.APP_URL)],
    ['📥 Экспорт', '❓ Справка']
]).resize()));

// ЭКСПОРТ БЕЗ БИБЛИОТЕК
bot.hears('📥 Экспорт', async (ctx) => {
    const snap = await db.collection('users').doc(String(ctx.from.id)).collection('transactions').get();
    if (snap.empty) return ctx.reply('Пусто');
    let csv = '\ufeffДата,Сумма,Категория,Кошелек\n'; // \ufeff для поддержки кириллицы в Excel
    snap.forEach(doc => {
        const d = doc.data();
        const date = d.date ? d.date.toDate().toLocaleDateString() : '';
        csv += `${date},${d.amount},${d.category},${d.wallet}\n`;
    });
    ctx.replyWithDocument({ source: Buffer.from(csv), filename: 'finances.csv' });
});

bot.on('text', async (ctx) => {
    if (ctx.message.text.startsWith('/')) return;
    const aiData = await parseWithAI(ctx.message.text);
    if (aiData) {
        await db.collection('users').doc(String(ctx.from.id)).collection('transactions').add({
            ...aiData, date: admin.firestore.FieldValue.serverTimestamp()
        });
        ctx.reply(`✅ Записал: ${aiData.amount} ₸`);
    } else { ctx.reply('Не понял сумму.'); }
});

bot.launch();
app.listen(process.env.PORT || 3000, () => console.log('Server started'));
