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

// --- ЗАПАСНОЙ ПАРСЕР (если AI упал) ---
function fallbackParse(text) {
    const msg = text.toLowerCase();
    const amountMatch = msg.match(/(\d+[.,]?\d*)\s*([kкк]?)/i);
    if (!amountMatch) return null;
    let amount = parseFloat(amountMatch[1].replace(',', '.'));
    if (amountMatch[2]) amount *= 1000;
    let category = text.replace(amountMatch[0], '').replace(/привет|бро|але|слыш/gi, '').trim() || 'Прочее';
    return { amount: -Math.abs(amount), category: category, wallet: 'main' };
}

// --- УЛУЧШЕННАЯ НЕЙРОСЕТЬ ---
async function parseWithAI(text) {
    try {
        const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
            model: 'mistralai/mistral-7b-instruct:free',
            messages: [{
                role: 'system',
                content: `Ты финансовый ассистент. Преврати текст в JSON. Кошельки: 'main', 'deposit', 'borrowed', 'lent'. Ответ должен содержать ТОЛЬКО JSON объект: {"amount": число, "category": "строка", "wallet": "строка"}`
            }, { role: 'user', content: text }],
        }, {
            headers: { 'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
            timeout: 10000 // Ждем максимум 10 сек
        });

        let content = response.data.choices[0].message.content;
        // Очистка ответа от Markdown (```json ... ```)
        content = content.replace(/```json|```/g, '').trim();
        return JSON.parse(content);
    } catch (e) { 
        console.log("AI Error, using fallback...");
        return fallbackParse(text); 
    }
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

bot.start(ctx => ctx.reply('Салем! 🇰🇿 Я слушаю. Напиши трату.', Markup.keyboard([
    [Markup.button.webApp('📊 Мой учет ₸', process.env.APP_URL)],
    ['📥 Экспорт']
]).resize()));

bot.hears('📥 Экспорт', async (ctx) => {
    const snap = await db.collection('users').doc(String(ctx.from.id)).collection('transactions').get();
    let csv = '\ufeffДата,Сумма,Категория,Кошелек\n';
    snap.forEach(doc => {
        const d = doc.data();
        const date = d.date ? d.date.toDate().toLocaleDateString() : '';
        csv += `${date},${d.amount},${d.category},${d.wallet}\n`;
    });
    ctx.replyWithDocument({ source: Buffer.from(csv), filename: 'finances.csv' });
});

bot.on('text', async (ctx) => {
    if (ctx.message.text.startsWith('/')) return;
    
    // Сначала пробуем AI, если он тупит — используем код
    const data = await parseWithAI(ctx.message.text);
    
    if (data && data.amount) {
        await db.collection('users').doc(String(ctx.from.id)).collection('transactions').add({
            ...data, date: admin.firestore.FieldValue.serverTimestamp()
        });
        const icon = data.amount > 0 ? '✅' : '📉';
        ctx.reply(`${icon} Записал: ${Math.abs(data.amount)} ₸`);
    } else {
        ctx.reply('Не понял сумму. Попробуй еще раз (например: "еда 500")');
    }
});

bot.launch();
app.listen(process.env.PORT || 3000);
