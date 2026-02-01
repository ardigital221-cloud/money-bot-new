const express = require('express');
const { Telegraf, Markup } = require('telegraf');
const path = require('path');
const admin = require('firebase-admin');

// 1. Инициализация Firebase Admin через твой секретный ключ
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))
    });
}
const db = admin.firestore();

const app = express();
const bot = new Telegraf(process.env.BOT_TOKEN);
const APP_URL = process.env.APP_URL;

app.use(express.static(path.join(__dirname, 'public')));

// --- ФУНКЦИЯ РАСПОЗНАВАНИЯ ТЕКСТА (ТВОЁ ТЗ) ---
function parseFinance(text) {
    const msg = text.toLowerCase();
    
    // Ищем число (понимает 15к, 15000, 1.5к, 15,5к)
    const amountMatch = msg.match(/(\d+[.,]?\d*)\s*([kкк]?)/i);
    if (!amountMatch) return null;

    let amount = parseFloat(amountMatch[1].replace(',', '.'));
    
    // Если есть приставка "к", умножаем на 1000
    if (amountMatch[2]) {
        amount = amount * 1000;
    }

    let category = text.replace(amountMatch[0], '').trim();
    let type = 'expense'; // По умолчанию — расход (-)

    // Правила для долгов и доходов
    if (msg.includes('взял в долг') || msg.includes('пришло') || msg.includes('зарплата') || msg.includes('заработал')) {
        type = 'income'; // Это плюс (+)
        if (msg.includes('взял в долг')) category = '📌 Взял в долг';
    } 
    else if (msg.includes('дал в долг') || msg.includes('одолжил')) {
        type = 'expense'; // Это минус (-)
        category = '🖇 Дал в долг';
    }

    return {
        amount: type === 'expense' ? -Math.abs(amount) : Math.abs(amount),
        cat: category || 'Прочее'
    };
}

// --- ОБРАБОТКА ТЕКСТА ---
bot.on('text', async (ctx) => {
    // Если это команда /start, не парсим её
    if (ctx.message.text.startsWith('/')) return;

    const result = parseFinance(ctx.message.text);

    if (result) {
        const userId = String(ctx.from.id);
        
        try {
            // Сохраняем в ту же базу Firebase (Firestore)
            await db.collection('users').doc(userId).collection('transactions').add({
                amount: result.amount,
                cat: result.cat,
                date: admin.firestore.FieldValue.serverTimestamp()
            });

            const status = result.amount > 0 ? '💰 Приход' : '📉 Расход';
            ctx.reply(`${status}: ${Math.abs(result.amount)} ₽\nКатегория: ${result.cat}`);
        } catch (e) {
            console.error(e);
            ctx.reply('Ошибка сохранения в базу!');
        }
    } else {
        ctx.reply('Не вижу сумму. Напиши например: "Бургер 750" или "Дал в долг 15к"');
    }
});

// Заглушка для голоса (Whisper подключим следующим шагом)
bot.on('voice', (ctx) => ctx.reply('Голосовой ввод почти готов! Пока пиши текстом (понимаю "15к", "взял в долг").'));

bot.start((ctx) => {
    ctx.reply('Привет! Я записываю твои деньги. Пиши просто: "Такси 300" или "Зарплата 50к". Всё сразу появится в приложении!', Markup.keyboard([
        Markup.button.webApp('📊 Открыть приложение', APP_URL)
    ]).resize());
});

bot.launch();

// Запуск сервера для сайта
app.listen(process.env.PORT || 3000, () => {
    console.log('Бот и сервер запущены');
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
