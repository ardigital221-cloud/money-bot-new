const express = require('express');
const { Telegraf, Markup } = require('telegraf');
const admin = require('firebase-admin');
const path = require('path');

// Инициализация Firebase
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))
    });
}
const db = admin.firestore();

const app = express();
const bot = new Telegraf(process.env.BOT_TOKEN);

app.use(express.static('public'));

// --- ЛОГИКА ПАРСИНГА (Заменяет AI на первое время) ---
function parseFinance(text) {
    const msg = text.toLowerCase();
    const amountMatch = msg.match(/(\d+[.,]?\d*)\s*([kкк]?)/i);
    if (!amountMatch) return null;

    let amount = parseFloat(amountMatch[1].replace(',', '.'));
    if (amountMatch[2]) amount *= 1000;

    let category = text.replace(amountMatch[0], '').trim() || 'Разное';
    let is_savings = false;
    let is_debt = false;
    let type = 'expense';

    if (msg.includes('копилка') || msg.includes('отложил')) {
        is_savings = true;
        category = 'Копилка';
    }
    if (msg.includes('долг') || msg.includes('одолжил')) {
        is_debt = true;
        category = 'Долги';
    }
    if (msg.includes('зарплата') || msg.includes('пришло') || msg.includes('доход')) {
        type = 'income';
    }

    return {
        amount: type === 'expense' ? -Math.abs(amount) : Math.abs(amount),
        category,
        is_savings,
        is_debt,
        date: admin.firestore.FieldValue.serverTimestamp()
    };
}

// --- API ДЛЯ МИНИ-ПРИЛОЖЕНИЯ ---
app.get('/api/stats/:userId', async (req, res) => {
    const userId = req.params.userId;
    const snapshot = await db.collection('users').doc(userId).collection('transactions').get();
    
    let wallet = 0;
    let savings = 0;
    let debt = 0;
    let history = [];
    let categories = {};

    snapshot.forEach(doc => {
        const data = doc.data();
        const val = data.amount;
        
        if (data.is_savings) savings += Math.abs(val);
        else if (data.is_debt) debt += Math.abs(val);
        else wallet += val;

        if (val < 0) {
            categories[data.cat] = (categories[data.cat] || 0) + Math.abs(val);
        }
        
        history.push({ ...data, id: doc.id });
    });

    res.json({ wallet, savings, debt, history: history.slice(-20), categories });
});

// --- КОМАНДЫ БОТА ---
bot.on('text', async (ctx) => {
    if (ctx.message.text.startsWith('/')) return;
    const res = parseFinance(ctx.message.text);
    if (res) {
        await db.collection('users').doc(String(ctx.from.id)).collection('transactions').add(res);
        ctx.reply(`✅ Записал: ${res.amount} ₸ в "${res.category}"`);
    }
});

bot.start((ctx) => {
    ctx.reply('Салем! Веду учет. Жми кнопку или пиши текстом.', Markup.keyboard([
        [Markup.button.webApp('📊 Открыть приложение', process.env.APP_URL)]
    ]).resize());
});

bot.launch();
app.listen(process.env.PORT || 3000);
