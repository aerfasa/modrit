const { Telegraf } = require('telegraf');
const registerCommands = require('./lib/commands');

let botInstance = null;

async function startBot(token, ownerId) {
  if (botInstance) {
    try { await botInstance.stop('restart'); } catch (e) {}
  }
  const bot = new Telegraf(token);
  registerCommands(bot, ownerId);

  bot.catch((err, ctx) => {
    console.error('Bot error for update', ctx.updateType, err);
  });

  await bot.launch();
  botInstance = bot;
  console.log('Bot started successfully.');

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));

  return bot;
}

module.exports = { startBot };
