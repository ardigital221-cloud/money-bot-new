const express = require('express');
const { Telegraf, Markup } = require('telegraf');
const path = require('path');

const app = express();
const bot = new Telegraf(process.env.BOT_TOKEN);
const PORT = process.env.PORT || 3000;
const APP_URL = process.env.APP_URL || 'https://google.com'; 

// Раздаем сайт из папки public
app.use(express.static(path.join(__dirname, 'public')));

// Бот
bot.start((ctx) => {
    ctx.reply(
        'Учет финансов 💰',
        Markup.keyboard([
            Markup.button.webApp('Отрыть приложение', APP_URL)
        ]).resize()
    );
});

bot.launch();

// Запуск сервера
app.listen(PORT, () => console.log(`Server started on ${PORT}`));

// Остановка
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
