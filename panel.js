const { Markup } = require('telegraf');
const { LOCK_TYPES } = require('./locks');

const MAIN_MENU = Markup.inlineKeyboard([
  [Markup.button.callback('مدیریت کاربران', 'panel:users')],
  [Markup.button.callback('مدیریت گروه', 'panel:group')],
  [Markup.button.callback('پاکسازی', 'panel:cleanup')],
  [Markup.button.callback('قفل‌ها', 'panel:locks')],
  [Markup.button.callback('آمار و گزارش‌ها', 'panel:stats')]
]);

function backButton() {
  return Markup.inlineKeyboard([[Markup.button.callback('بازگشت', 'panel:main')]]);
}

const TEXTS = {
  main: 'پنل مدیریت گروه — یک بخش را انتخاب کنید:',
  users:
    'مدیریت کاربران:\n' +
    '/mute — سکوت (پشتیبانی از زمان: 30s 10m 1h 2d 1w 30d permanent)\n' +
    '/unmute — رفع سکوت\n/ban — بن\n/unban — رفع بن\n/kick — اخراج\n' +
    '/warn — اخطار\n/unwarn — حذف اخطار\n/clearwarn — پاک اخطار\n' +
    '/vip — ویژه\n/unvip — حذف ویژه\n/exempt — معاف\n/unexempt — حذف معاف\n' +
    '/promote — ترفیع مدیر\n/demote — عزل مدیر\n/admin — ادمین ربات\n/unadmin — حذف ادمین\n' +
    '/owner — مالک ربات\n/unowner — حذف مالک\n/user — پنل کاربر\n/roles — نقش‌ها\n/history — تاریخچه\n\n' +
    'هر دستور را می‌توان با ریپلای، یا با @یوزرنیم/آیدی عددی استفاده کرد. معادل فارسی هم کار می‌کند (مثال: سکوت @user 1h).',
  group:
    'مدیریت گروه:\n/settings — تنظیمات\n/locks — قفل‌ها\n/security — امنیت\n' +
    '/stats — آمار\n/today — آمار امروز\n/logs — گزارشات\n/admins — لیست ادمین‌ها\n' +
    '/owners — لیست مالکان\n/vips — لیست ویژه‌ها\n/exempts — لیست معاف‌ها\n' +
    '/mutelist — لیست سکوت\n/banlist — لیست بن\n/warnlist — لیست اخطار\n' +
    '/backup — بکاپ گرفتن\n/restore — بازیابی (ریپلای روی فایل بکاپ)\n' +
    '/rules /setrules — قوانین\n/welcome /setwelcome — خوش‌آمدگویی\n' +
    '/reset locks|welcome|rules|settings — بازنشانی',
  cleanup:
    'پاکسازی:\n/purge 100 — حذف ۱۰۰ پیام اخیر\n/purge bots — حذف پیام ربات‌ها\n' +
    '/purge links — حذف پیام‌های لینک‌دار\n/purge forwards — حذف پیام‌های فوروارد شده\n' +
    '/purge media — حذف رسانه‌ها\n/purge muted_messages — حذف پیام کاربران سکوت‌شده\n\n' +
    '/clear bans|mutes|warns|vips|exempts|managers|owners|logs|stats|today — خالی کردن لیست‌ها',
  stats: 'برای مشاهده جزئیات از /stats یا /today یا /logs استفاده کنید.'
};

function locksKeyboard(group) {
  const rows = [];
  for (let i = 0; i < LOCK_TYPES.length; i += 2) {
    const chunk = LOCK_TYPES.slice(i, i + 2).map((t) => {
      const on = !!(group.locks && group.locks[t]);
      return Markup.button.callback(`${on ? '🔒' : '🔓'} ${t}`, `lock:${t}`);
    });
    rows.push(chunk);
  }
  rows.push([Markup.button.callback('بازگشت', 'panel:main')]);
  return Markup.inlineKeyboard(rows);
}

async function showMain(ctx) {
  const text = TEXTS.main;
  if (ctx.updateType === 'callback_query') {
    await ctx.editMessageText(text, MAIN_MENU);
  } else {
    await ctx.reply(text, MAIN_MENU);
  }
}

async function handleCallback(ctx, db) {
  const data = ctx.callbackQuery.data;
  const chatId = ctx.chat.id;

  if (data === 'panel:main') return showMain(ctx);
  if (data === 'panel:users') return ctx.editMessageText(TEXTS.users, backButton());
  if (data === 'panel:group') return ctx.editMessageText(TEXTS.group, backButton());
  if (data === 'panel:cleanup') return ctx.editMessageText(TEXTS.cleanup, backButton());
  if (data === 'panel:stats') return ctx.editMessageText(TEXTS.stats, backButton());
  if (data === 'panel:locks') {
    const group = db.getGroup(chatId);
    return ctx.editMessageText('وضعیت قفل‌ها (برای تغییر لمس کنید):', locksKeyboard(group));
  }
  if (data.startsWith('lock:')) {
    const type = data.split(':')[1];
    const group = db.getGroup(chatId);
    group.locks[type] = !group.locks[type];
    db.saveGroup(chatId, group);
    return ctx.editMessageText('وضعیت قفل‌ها (برای تغییر لمس کنید):', locksKeyboard(group));
  }
  await ctx.answerCbQuery();
}

module.exports = { MAIN_MENU, showMain, handleCallback };
