const express = require('express');
const { Telegraf, Markup } = require('telegraf');
const admin = require('firebase-admin');
const path = require('path');

// Инициализация Firebase
if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
}
const db = admin.firestore();
const bot = new Telegraf(process.env.BOT_TOKEN);
const app = express();

app.use(express.static('public'));

// --- УМНЫЙ ПАРСЕР ---
function parseFinance(text) {
    const msg = text.toLowerCase();
    const amountMatch = msg.match(/(\d+[.,]?\d*)\s*([kкк]?)/i);
    if (!amountMatch) return null;

    let amount = parseFloat(amountMatch[1].replace(',', '.'));
    if (amountMatch[2]) amount *= 1000;

    let category = text.replace(amountMatch[0], '').trim() || 'Прочее';
    let wallet = 'main'; 
    let sign = -1;

    if (msg.includes('депозит') || msg.includes('копилка')) {
        wallet = 'deposit'; category = '💰 Депозит'; sign = -1;
    } else if (msg.includes('взял в долг')) {
        wallet = 'borrowed'; category = '🔴 Взял долг'; sign = 1;
    } else if (msg.includes('дал в долг')) {
        wallet = 'lent'; category = '🟢 Дал в долг'; sign = -1;
    } else if (msg.includes('зарплата') || msg.includes('пришло') || msg.includes('заработал')) {
        sign = 1; category = 'Работа';
    }

    if (msg.includes('подписка') || msg.includes('netflix') || msg.includes('яндекс')) category = '📺 Подписки';

    return { amount: amount * sign, category, wallet, rawAmount: amount, date: admin.firestore.FieldValue.serverTimestamp() };
}

// --- API ---
app.get('/api/stats/:userId', async (req, res) => {
    try {
        const snap = await db.collection('users').doc(req.params.userId).collection('transactions').orderBy('date', 'desc').get();
        let stats = { main: 0, deposit: 0, borrowed: 0, lent: 0, categories: {}, history: [] };

        snap.forEach(doc => {
            const d = doc.data();
            const val = d.amount;
            if (d.wallet === 'deposit') { stats.deposit += Math.abs(val); stats.main -= Math.abs(val); }
            else if (d.wallet === 'borrowed') { stats.borrowed += Math.abs(val); stats.main += Math.abs(val); }
            else if (d.wallet === 'lent') { stats.lent += Math.abs(val); stats.main -= Math.abs(val); }
            else { stats.main += val; }
            if (val < 0) stats.categories[d.category] = (stats.categories[d.category] || 0) + Math.abs(val);
            stats.history.push(d);
        });
        res.json(stats);
    } catch (e) { res.status(500).send(e.message); }
});

// --- КОМАНДЫ БОТА ---
bot.start((ctx) => {
    ctx.reply('Салем! Я твой финансовый бро 🇰🇿', 
    Markup.keyboard([
        [Markup.button.webApp('📊 Мой учет ₸', process.env.APP_URL)],
        ['📥 Экспорт в Excel', '❓ Справка']
    ]).resize());
});

// ЭКСПОРТ (БЕЗ БИБЛИОТЕК)
bot.hears('📥 Экспорт в Excel', async (ctx) => {
    try {
        const snap = await db.collection('users').doc(String(ctx.from.id)).collection('transactions').get();
        if (snap.empty) return ctx.reply('История пуста');

        // Создаем CSV вручную
        let csv = 'Дата,Сумма,Категория,Кошелек\n';
        snap.forEach(doc => {
            const d = doc.data();
            const date = d.date ? d.date.toDate().toLocaleDateString() : '';
            csv += `${date},${d.amount},${d.category},${d.wallet}\n`;
        });

        ctx.replyWithDocument({ source: Buffer.from(csv), filename: 'finances.csv' });
    } catch (e) { ctx.reply('Ошибка экспорта: ' + e.message); }
});

bot.on('text', async (ctx) => {
    const data = parseFinance(ctx.message.text);
    if (!data) return;
    if (Math.abs(data.amount) > 50000) ctx.reply('⚠️ Крупная трата!');
    await db.collection('users').doc(String(ctx.from.id)).collection('transactions').add(data);
    ctx.reply(`✅ Записал: ${Math.abs(data.amount)} ₸`);
});

bot.launch();
app.listen(process.env.PORT || 3000, () => console.log('Server started'));
