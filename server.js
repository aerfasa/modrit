const fs = require('fs');
const path = require('path');
const express = require('express');
const { Telegraf, Markup } = require('telegraf');

/* ============================================================
   DB LAYER (simple JSON file storage)
   ============================================================ */
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const CONFIG_FILE = path.join(__dirname, 'config.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function loadJSON(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const raw = fs.readFileSync(file, 'utf8');
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    console.error('Failed to read', file, e.message);
    return fallback;
  }
}
function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

let store = loadJSON(DB_FILE, { groups: {}, users: {} });
function persist() { saveJSON(DB_FILE, store); }

function getConfig() { return loadJSON(CONFIG_FILE, null); }
function saveConfig(cfg) { saveJSON(CONFIG_FILE, cfg); }

function defaultGroup() {
  return {
    settings: { language: 'fa', warnLimit: 3, warnAction: 'ban' },
    welcome: 'سلام {name} خوش اومدی به گروه!',
    rules: '',
    owners: [],
    admins: [],
    managers: [],
    vips: {},
    exempts: [],
    mutes: {},
    bans: {},
    warns: {},
    locks: {},
    stats: { messages: 0, today: {}, lastReset: new Date().toISOString().slice(0, 10) },
    logs: [],
    recentMessages: []
  };
}

function getGroup(chatId) {
  chatId = String(chatId);
  if (!store.groups[chatId]) {
    store.groups[chatId] = defaultGroup();
    persist();
  }
  const g = store.groups[chatId];
  const d = defaultGroup();
  for (const k of Object.keys(d)) if (!(k in g)) g[k] = d[k];
  return g;
}
function saveGroup(chatId, data) {
  store.groups[String(chatId)] = data;
  persist();
}
function upsertUser(userId, info) {
  userId = String(userId);
  store.users[userId] = { ...(store.users[userId] || {}), ...info, id: Number(userId) };
  persist();
}
function findUserByUsername(username) {
  username = username.replace(/^@/, '').toLowerCase();
  for (const id in store.users) {
    if ((store.users[id].username || '').toLowerCase() === username) return store.users[id];
  }
  return null;
}
function getUser(userId) { return store.users[String(userId)] || null; }
function addLog(chatId, entry) {
  const g = getGroup(chatId);
  g.logs.unshift({ ...entry, date: new Date().toISOString() });
  g.logs = g.logs.slice(0, 200);
  saveGroup(chatId, g);
}

/* ============================================================
   UTILS: duration parsing, target extraction, formatting
   ============================================================ */
const UNIT_MS = { s: 1000, m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000, w: 7 * 24 * 60 * 60 * 1000 };
const PERMANENT_WORDS = ['permanent', 'دائم', 'دائمی', 'همیشه'];

function parseDuration(input) {
  if (!input) return null;
  const raw = input.trim().toLowerCase();
  if (PERMANENT_WORDS.some((w) => raw === w)) return { permanent: true };
  const match = raw.match(/^(\d+)\s*(s|sec|m|min|h|hr|d|day|w|week)?$/);
  if (!match) return null;
  const num = parseInt(match[1], 10);
  const unit = (match[2] || 'm')[0];
  if (!UNIT_MS[unit]) return null;
  return { ms: num * UNIT_MS[unit] };
}
function formatDuration(ms) {
  if (ms == null) return 'دائمی';
  const units = [['w', UNIT_MS.w], ['d', UNIT_MS.d], ['h', UNIT_MS.h], ['m', UNIT_MS.m], ['s', UNIT_MS.s]];
  for (const [u, v] of units) if (ms >= v) return `${Math.round(ms / v)}${u}`;
  return `${ms}ms`;
}
function extractTarget(ctx, argsText) {
  const reply = ctx.message && ctx.message.reply_to_message;
  if (reply && reply.from) {
    return {
      id: reply.from.id,
      name: reply.from.first_name || reply.from.username || String(reply.from.id),
      username: reply.from.username || null,
      restText: (argsText || '').trim()
    };
  }
  if (!argsText) return null;
  const parts = argsText.trim().split(/\s+/);
  const first = parts[0];
  if (!first) return null;
  const rest = parts.slice(1).join(' ');

  const tgMatch = first.match(/tg:\/\/user\?id=(\d+)/);
  if (tgMatch) {
    const u = getUser(tgMatch[1]);
    return { id: Number(tgMatch[1]), name: u ? u.firstName : tgMatch[1], username: u ? u.username : null, restText: rest };
  }
  if (/^\d+$/.test(first)) {
    const u = getUser(first);
    return { id: Number(first), name: u ? u.firstName : first, username: u ? u.username : null, restText: rest };
  }
  if (first.startsWith('@')) {
    const u = findUserByUsername(first);
    if (!u) return { id: null, name: first, username: first.replace('@', ''), restText: rest, notFound: true };
    return { id: u.id, name: u.firstName || u.username, username: u.username, restText: rest };
  }
  return null;
}
function mention(name, id) {
  const safe = String(name).replace(/[<>&]/g, '');
  return `<a href="tg://user?id=${id}">${safe}</a>`;
}

/* ============================================================
   ROLES
   ============================================================ */
const LEVEL = { OWNER: 100, GOWNER: 90, ADMIN: 80, MANAGER: 70, VIP: 50, EXEMPT: 40, MEMBER: 0 };
function getRole(group, userId, botOwnerId) {
  userId = Number(userId);
  if (botOwnerId && userId === Number(botOwnerId)) return LEVEL.OWNER;
  if (group.owners.includes(userId)) return LEVEL.GOWNER;
  if (group.admins.includes(userId)) return LEVEL.ADMIN;
  if (group.managers.includes(userId)) return LEVEL.MANAGER;
  if (group.vips && group.vips[userId] !== undefined) return LEVEL.VIP;
  if (group.exempts.includes(userId)) return LEVEL.EXEMPT;
  return LEVEL.MEMBER;
}
function roleName(level) { return Object.keys(LEVEL).find((k) => LEVEL[k] === level) || 'MEMBER'; }
function canAct(actorLevel, targetLevel) {
  if (actorLevel === LEVEL.OWNER) return true;
  return actorLevel > targetLevel;
}

/* ============================================================
   LOCKS
   ============================================================ */
const LOCK_TYPES = ['links', 'username', 'forward', 'media', 'photo', 'video', 'gif', 'sticker', 'voice', 'audio', 'file', 'contact', 'location', 'poll', 'game', 'inline', 'spam', 'flood', 'emoji', 'english', 'persian'];
const floodTracker = {};
const spamTracker = {};

function detectTypes(msg) {
  const types = new Set();
  if (!msg) return types;
  const entities = msg.entities || msg.caption_entities || [];
  if (entities.some((e) => e.type === 'url' || e.type === 'text_link')) types.add('links');
  if (/https?:\/\/|t\.me\//i.test(msg.text || msg.caption || '')) types.add('links');
  if (entities.some((e) => e.type === 'mention' || e.type === 'text_mention')) types.add('username');
  if (msg.forward_from || msg.forward_from_chat || msg.forward_origin) types.add('forward');
  if (msg.photo) { types.add('photo'); types.add('media'); }
  if (msg.video) { types.add('video'); types.add('media'); }
  if (msg.animation) { types.add('gif'); types.add('media'); }
  if (msg.sticker) { types.add('sticker'); types.add('media'); }
  if (msg.voice) { types.add('voice'); types.add('media'); }
  if (msg.audio) { types.add('audio'); types.add('media'); }
  if (msg.document) { types.add('file'); types.add('media'); }
  if (msg.contact) types.add('contact');
  if (msg.location || msg.venue) types.add('location');
  if (msg.poll) types.add('poll');
  if (msg.game) types.add('game');
  if (msg.via_bot) types.add('inline');
  const text = msg.text || msg.caption || '';
  if (text) {
    const emojiRegex = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu;
    const emojiCount = (text.match(emojiRegex) || []).length;
    if (emojiCount > 0 && emojiCount >= text.replace(/\s/g, '').length * 0.5) types.add('emoji');
    if (/[A-Za-z]{2,}/.test(text)) types.add('english');
    if (/[\u0600-\u06FF]/.test(text)) types.add('persian');
  }
  return types;
}
function checkFlood(chatId, userId, limitCount = 5, windowMs = 10000) {
  const key = `${chatId}:${userId}`;
  const now = Date.now();
  const arr = (floodTracker[key] || []).filter((t) => now - t < windowMs);
  arr.push(now);
  floodTracker[key] = arr;
  return arr.length > limitCount;
}
function checkSpam(chatId, userId, text) {
  if (!text) return false;
  const key = `${chatId}:${userId}`;
  const now = Date.now();
  const prev = spamTracker[key];
  spamTracker[key] = { text, time: now };
  return !!(prev && prev.text === text && now - prev.time < 15000);
}

/* ============================================================
   PANEL (inline keyboards)
   ============================================================ */
const MAIN_MENU = Markup.inlineKeyboard([
  [Markup.button.callback('مدیریت کاربران', 'panel:users')],
  [Markup.button.callback('مدیریت گروه', 'panel:group')],
  [Markup.button.callback('پاکسازی', 'panel:cleanup')],
  [Markup.button.callback('قفل‌ها', 'panel:locks')],
  [Markup.button.callback('آمار و گزارش‌ها', 'panel:stats')]
]);
function backButton() { return Markup.inlineKeyboard([[Markup.button.callback('بازگشت', 'panel:main')]]); }

const PANEL_TEXTS = {
  main: 'پنل مدیریت گروه — یک بخش را انتخاب کنید:',
  users:
    'مدیریت کاربران:\n/mute — سکوت (30s 10m 1h 2d 1w 30d permanent)\n/unmute — رفع سکوت\n' +
    '/ban — بن\n/unban — رفع بن\n/kick — اخراج\n/warn — اخطار\n/unwarn — حذف اخطار\n/clearwarn — پاک اخطار\n' +
    '/vip — ویژه\n/unvip — حذف ویژه\n/exempt — معاف\n/unexempt — حذف معاف\n' +
    '/promote — ترفیع مدیر\n/demote — عزل مدیر\n/admin — ادمین ربات\n/unadmin — حذف ادمین\n' +
    '/owner — مالک ربات\n/unowner — حذف مالک\n/user — پنل کاربر\n/roles — نقش‌ها\n/history — تاریخچه\n\n' +
    'با ریپلای یا @یوزرنیم/آیدی، فارسی هم کار می‌کند (مثال: سکوت @user 1h).',
  group:
    'مدیریت گروه:\n/settings — تنظیمات\n/locks — قفل‌ها\n/security — امنیت\n/stats — آمار\n/today — آمار امروز\n' +
    '/logs — گزارشات\n/admins /owners /vips /exempts /mutelist /banlist /warnlist — لیست‌ها\n' +
    '/backup /restore — بکاپ و بازیابی\n/rules /setrules — قوانین\n/welcome /setwelcome — خوش‌آمدگویی\n' +
    '/setwarn <تعداد> <ban|mute|kick> — تنظیم آستانه اخطار\n/reset <نوع> — بازنشانی',
  cleanup:
    'پاکسازی:\n/purge 100 — حذف ۱۰۰ پیام اخیر\n/purge bots — حذف پیام ربات‌ها\n' +
    '/purge links|forwards|media|muted_messages\n\n' +
    '/clear bans|mutes|warns|vips|exempts|managers|owners|logs|stats|today',
  stats: 'برای جزئیات: /stats یا /today یا /logs'
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
async function showPanelMain(ctx) {
  if (ctx.updateType === 'callback_query') await ctx.editMessageText(PANEL_TEXTS.main, MAIN_MENU);
  else await ctx.reply(PANEL_TEXTS.main, MAIN_MENU);
}
async function handlePanelCallback(ctx) {
  const data = ctx.callbackQuery.data;
  const chatId = ctx.chat.id;
  if (data === 'panel:main') return showPanelMain(ctx);
  if (data === 'panel:users') return ctx.editMessageText(PANEL_TEXTS.users, backButton());
  if (data === 'panel:group') return ctx.editMessageText(PANEL_TEXTS.group, backButton());
  if (data === 'panel:cleanup') return ctx.editMessageText(PANEL_TEXTS.cleanup, backButton());
  if (data === 'panel:stats') return ctx.editMessageText(PANEL_TEXTS.stats, backButton());
  if (data === 'panel:locks') {
    const group = getGroup(chatId);
    return ctx.editMessageText('وضعیت قفل‌ها (برای تغییر لمس کنید):', locksKeyboard(group));
  }
  if (data.startsWith('lock:')) {
    const type = data.split(':')[1];
    const group = getGroup(chatId);
    group.locks[type] = !group.locks[type];
    saveGroup(chatId, group);
    return ctx.editMessageText('وضعیت قفل‌ها (برای تغییر لمس کنید):', locksKeyboard(group));
  }
  await ctx.answerCbQuery();
}

/* ============================================================
   COMMANDS
   ============================================================ */
const PERSIAN_TRIGGERS = [
  ['رفع سکوت', 'unmute'], ['سکوت دائمی', 'mute'], ['سکوت', 'mute'],
  ['رفع بن', 'unban'], ['بن دائمی', 'ban'], ['بن', 'ban'],
  ['اخراج', 'kick'], ['حذف اخطار', 'unwarn'], ['پاک اخطار', 'clearwarn'], ['اخطار', 'warn'],
  ['حذف ویژه', 'unvip'], ['ویژه', 'vip'], ['حذف معاف', 'unexempt'], ['معاف', 'exempt'],
  ['ترفیع', 'promote'], ['عزل', 'demote'], ['حذف ادمین', 'unadmin'], ['ادمین', 'admin'],
  ['حذف مالک', 'unowner'], ['مالک', 'owner']
].sort((a, b) => b[0].length - a[0].length);

const WARN_ACTION_LABELS = { ban: 'بن دائم', mute: 'سکوت دائم', kick: 'اخراج' };

function timeNow() { return Math.floor(Date.now() / 1000); }

function registerCommands(bot, botOwnerId) {
  // ---- tracking + lock enforcement middleware ----
  bot.on('message', async (ctx, next) => {
    const msg = ctx.message;
    if (msg.from) {
      upsertUser(msg.from.id, { username: msg.from.username || null, firstName: msg.from.first_name || msg.from.username || String(msg.from.id) });
    }
    if (ctx.chat && (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup')) {
      const group = getGroup(ctx.chat.id);
      group.stats.messages = (group.stats.messages || 0) + 1;
      const today = new Date().toISOString().slice(0, 10);
      if (group.stats.lastReset !== today) { group.stats.today = {}; group.stats.lastReset = today; }
      group.stats.today[msg.from.id] = (group.stats.today[msg.from.id] || 0) + 1;

      const types = Array.from(detectTypes(msg));
      group.recentMessages.unshift({ id: msg.message_id, from: msg.from.id, isBot: !!msg.from.is_bot, types, date: Date.now() });
      group.recentMessages = group.recentMessages.slice(0, 800);
      saveGroup(ctx.chat.id, group);

      const actorLevel = getRole(group, msg.from.id, botOwnerId);
      if (actorLevel < LEVEL.VIP && group.locks) {
        let violated = types.find((t) => group.locks[t]);
        if (!violated && group.locks.flood && checkFlood(ctx.chat.id, msg.from.id)) violated = 'flood';
        if (!violated && group.locks.spam && checkSpam(ctx.chat.id, msg.from.id, msg.text)) violated = 'spam';
        if (violated) {
          try { await ctx.deleteMessage(msg.message_id); addLog(ctx.chat.id, { type: 'lock', by: 'system', target: msg.from.id, note: `deleted for locked type: ${violated}` }); } catch (e) {}
          return;
        }
      }
    }
    return next();
  });

  bot.on('new_chat_members', async (ctx) => {
    const me = await ctx.telegram.getMe();
    for (const member of ctx.message.new_chat_members) {
      if (member.id === me.id) {
        await ctx.reply('ربات با موفقیت در گروه نصب شد.\nبرای مشاهده امکانات از /panel استفاده کنید.', MAIN_MENU);
      } else {
        const group = getGroup(ctx.chat.id);
        const text = (group.welcome || 'خوش اومدی {name}!').replace('{name}', member.first_name || member.username || '');
        await ctx.reply(text);
      }
    }
  });

  bot.action(/panel:.*/, (ctx) => handlePanelCallback(ctx));
  bot.action(/lock:.*/, (ctx) => handlePanelCallback(ctx));
  bot.command(['panel', 'gpanel'], (ctx) => showPanelMain(ctx));

  const ACTIONS = {
    mute: { minLevel: LEVEL.ADMIN, duration: true, apply: applyMute, label: 'سکوت' },
    unmute: { minLevel: LEVEL.ADMIN, apply: applyUnmute, label: 'رفع سکوت' },
    ban: { minLevel: LEVEL.ADMIN, duration: true, apply: applyBan, label: 'بن' },
    unban: { minLevel: LEVEL.ADMIN, apply: applyUnban, label: 'رفع بن' },
    kick: { minLevel: LEVEL.ADMIN, apply: applyKick, label: 'اخراج' },
    warn: { minLevel: LEVEL.ADMIN, apply: applyWarn, label: 'اخطار' },
    unwarn: { minLevel: LEVEL.ADMIN, apply: applyUnwarn, label: 'حذف اخطار' },
    clearwarn: { minLevel: LEVEL.ADMIN, apply: applyClearWarn, label: 'پاک کردن اخطارها' },
    vip: { minLevel: LEVEL.GOWNER, duration: true, apply: applyVip, label: 'ویژه' },
    unvip: { minLevel: LEVEL.GOWNER, apply: applyUnvip, label: 'حذف ویژه' },
    exempt: { minLevel: LEVEL.ADMIN, apply: applyExempt, label: 'معاف' },
    unexempt: { minLevel: LEVEL.ADMIN, apply: applyUnexempt, label: 'حذف معافیت' },
    admin: { minLevel: LEVEL.GOWNER, apply: applyAdmin, label: 'ادمین ربات' },
    unadmin: { minLevel: LEVEL.GOWNER, apply: applyUnadmin, label: 'حذف ادمین' },
    owner: { minLevel: LEVEL.OWNER, apply: applyOwner, label: 'مالک' },
    unowner: { minLevel: LEVEL.OWNER, apply: applyUnowner, label: 'حذف مالک' },
    promote: { minLevel: LEVEL.GOWNER, apply: applyPromote, label: 'ترفیع مدیر' },
    demote: { minLevel: LEVEL.GOWNER, apply: applyDemote, label: 'عزل مدیر' }
  };

  async function dispatch(ctx, canonical, argsText) {
    if (!ctx.chat || (ctx.chat.type !== 'group' && ctx.chat.type !== 'supergroup')) return ctx.reply('این دستور فقط داخل گروه کار می‌کند.');
    const action = ACTIONS[canonical];
    const group = getGroup(ctx.chat.id);
    const actorLevel = getRole(group, ctx.from.id, botOwnerId);
    if (actorLevel < action.minLevel) return ctx.reply('شما دسترسی لازم برای این دستور را ندارید.');

    const target = extractTarget(ctx, argsText);
    if (!target) return ctx.reply('کاربر مورد نظر را ریپلای کنید یا @یوزرنیم / آیدی عددی وارد کنید.');
    if (target.notFound || !target.id) return ctx.reply('این کاربر در دیتابیس ربات پیدا نشد (باید قبلاً در گروه پیام داده باشد).');
    if (target.id === ctx.from.id) return ctx.reply('نمی‌توانید این عملیات را روی خودتان انجام دهید.');

    const targetLevel = getRole(group, target.id, botOwnerId);
    if (!canAct(actorLevel, targetLevel)) return ctx.reply('این کاربر نقش بالاتر یا مساوی شما دارد، امکان انجام عملیات نیست.');

    let duration = null;
    if (action.duration) {
      duration = parseDuration(target.restText);
      if (target.restText && !duration) return ctx.reply('فرمت زمان نامعتبر است. مثال: 30s, 10m, 1h, 2d, 1w, permanent');
      if (!duration) duration = { permanent: true };
    }

    try {
      const resultText = await action.apply(ctx, group, target, duration, botOwnerId);
      saveGroup(ctx.chat.id, group);
      addLog(ctx.chat.id, { type: canonical, by: ctx.from.id, target: target.id });
      await ctx.reply(resultText || `${action.label} برای ${target.name} انجام شد.`, { parse_mode: 'HTML' });
    } catch (e) {
      await ctx.reply('خطا در اجرای عملیات: ' + e.message);
    }
  }

  for (const canonical of Object.keys(ACTIONS)) {
    bot.command(canonical, (ctx) => dispatch(ctx, canonical, ctx.message.text.split(/\s+/).slice(1).join(' ')));
  }

  bot.hears(/^[\S\s]+/, async (ctx, next) => {
    const text = ctx.message.text || '';
    if (text.startsWith('/')) return next();
    for (const [trigger, canonical] of PERSIAN_TRIGGERS) {
      if (text === trigger || text.startsWith(trigger + ' ')) {
        return dispatch(ctx, canonical, text.slice(trigger.length).trim());
      }
    }
    return next();
  });

  async function applyMute(ctx, group, target, duration) {
    const untilDate = duration.permanent ? 0 : timeNow() + Math.floor(duration.ms / 1000);
    await ctx.telegram.restrictChatMember(ctx.chat.id, target.id, {
      permissions: {
        can_send_messages: false, can_send_audios: false, can_send_documents: false, can_send_photos: false,
        can_send_videos: false, can_send_video_notes: false, can_send_voice_notes: false, can_send_polls: false,
        can_send_other_messages: false, can_add_web_page_previews: false
      },
      until_date: untilDate
    });
    group.mutes[target.id] = { until: untilDate, permanent: duration.permanent };
    return `${mention(target.name, target.id)} به مدت ${duration.permanent ? 'دائمی' : formatDuration(duration.ms)} سکوت شد.`;
  }
  async function applyUnmute(ctx, group, target) {
    await ctx.telegram.restrictChatMember(ctx.chat.id, target.id, {
      permissions: {
        can_send_messages: true, can_send_audios: true, can_send_documents: true, can_send_photos: true,
        can_send_videos: true, can_send_video_notes: true, can_send_voice_notes: true, can_send_polls: true,
        can_send_other_messages: true, can_add_web_page_previews: true
      }
    });
    delete group.mutes[target.id];
    return `سکوت ${mention(target.name, target.id)} برداشته شد.`;
  }
  async function applyBan(ctx, group, target, duration) {
    const untilDate = duration.permanent ? 0 : timeNow() + Math.floor(duration.ms / 1000);
    await ctx.telegram.banChatMember(ctx.chat.id, target.id, untilDate || undefined);
    group.bans[target.id] = { until: untilDate, permanent: duration.permanent };
    return `${mention(target.name, target.id)} به مدت ${duration.permanent ? 'دائمی' : formatDuration(duration.ms)} بن شد.`;
  }
  async function applyUnban(ctx, group, target) {
    await ctx.telegram.unbanChatMember(ctx.chat.id, target.id, { only_if_banned: true });
    delete group.bans[target.id];
    return `بن ${mention(target.name, target.id)} برداشته شد.`;
  }
  async function applyKick(ctx, group, target) {
    await ctx.telegram.banChatMember(ctx.chat.id, target.id);
    await ctx.telegram.unbanChatMember(ctx.chat.id, target.id, { only_if_banned: true });
    return `${mention(target.name, target.id)} از گروه اخراج شد.`;
  }
  async function applyWarn(ctx, group, target) {
    const limit = group.settings.warnLimit || 3;
    const action = group.settings.warnAction || 'ban';
    group.warns[target.id] = (group.warns[target.id] || 0) + 1;
    const count = group.warns[target.id];
    if (count >= limit) {
      if (action === 'ban') {
        await ctx.telegram.banChatMember(ctx.chat.id, target.id);
        group.bans[target.id] = { until: 0, permanent: true };
      } else if (action === 'mute') {
        await ctx.telegram.restrictChatMember(ctx.chat.id, target.id, { permissions: { can_send_messages: false }, until_date: 0 });
        group.mutes[target.id] = { until: 0, permanent: true };
      } else if (action === 'kick') {
        await ctx.telegram.banChatMember(ctx.chat.id, target.id);
        await ctx.telegram.unbanChatMember(ctx.chat.id, target.id, { only_if_banned: true });
      }
      group.warns[target.id] = 0;
      return `${mention(target.name, target.id)} به دلیل رسیدن به ${limit} اخطار، ${WARN_ACTION_LABELS[action]} شد.`;
    }
    return `${mention(target.name, target.id)} اخطار گرفت (${count}/${limit}).`;
  }
  async function applyUnwarn(ctx, group, target) {
    const limit = group.settings.warnLimit || 3;
    group.warns[target.id] = Math.max(0, (group.warns[target.id] || 0) - 1);
    return `یک اخطار از ${mention(target.name, target.id)} حذف شد (${group.warns[target.id]}/${limit}).`;
  }
  async function applyClearWarn(ctx, group, target) {
    group.warns[target.id] = 0;
    return `تمام اخطارهای ${mention(target.name, target.id)} پاک شد.`;
  }
  async function applyVip(ctx, group, target, duration) {
    const until = duration.permanent ? null : Date.now() + duration.ms;
    group.vips[target.id] = { until };
    return `${mention(target.name, target.id)} ویژه شد${until ? ' برای ' + formatDuration(duration.ms) : ' (دائمی)'}.`;
  }
  async function applyUnvip(ctx, group, target) {
    delete group.vips[target.id];
    return `عضویت ویژه ${mention(target.name, target.id)} حذف شد.`;
  }
  async function applyExempt(ctx, group, target) {
    if (!group.exempts.includes(target.id)) group.exempts.push(target.id);
    return `${mention(target.name, target.id)} از قفل‌ها و فیلترها معاف شد.`;
  }
  async function applyUnexempt(ctx, group, target) {
    group.exempts = group.exempts.filter((id) => id !== target.id);
    return `معافیت ${mention(target.name, target.id)} حذف شد.`;
  }
  async function applyAdmin(ctx, group, target) {
    if (!group.admins.includes(target.id)) group.admins.push(target.id);
    return `${mention(target.name, target.id)} ادمین ربات شد.`;
  }
  async function applyUnadmin(ctx, group, target) {
    group.admins = group.admins.filter((id) => id !== target.id);
    return `دسترسی ادمین ${mention(target.name, target.id)} حذف شد.`;
  }
  async function applyOwner(ctx, group, target) {
    if (!group.owners.includes(target.id)) group.owners.push(target.id);
    return `${mention(target.name, target.id)} مالک گروه شد.`;
  }
  async function applyUnowner(ctx, group, target) {
    group.owners = group.owners.filter((id) => id !== target.id);
    return `مالکیت ${mention(target.name, target.id)} حذف شد.`;
  }
  async function applyPromote(ctx, group, target) {
    await ctx.telegram.promoteChatMember(ctx.chat.id, target.id, {
      can_delete_messages: true, can_restrict_members: true, can_invite_users: true,
      can_pin_messages: true, can_manage_chat: true, can_change_info: false, can_promote_members: false
    });
    if (!group.managers.includes(target.id)) group.managers.push(target.id);
    return `${mention(target.name, target.id)} به مدیریت (ادمین تلگرام) ترفیع یافت.`;
  }
  async function applyDemote(ctx, group, target) {
    await ctx.telegram.promoteChatMember(ctx.chat.id, target.id, {
      can_delete_messages: false, can_restrict_members: false, can_invite_users: false,
      can_pin_messages: false, can_manage_chat: false, can_change_info: false, can_promote_members: false
    });
    group.managers = group.managers.filter((id) => id !== target.id);
    return `${mention(target.name, target.id)} از مدیریت عزل شد.`;
  }

  bot.command(['user', 'ustats', 'roles', 'history'], async (ctx) => {
    const argsText = ctx.message.text.split(/\s+/).slice(1).join(' ');
    const group = getGroup(ctx.chat.id);
    const target = extractTarget(ctx, argsText) || { id: ctx.from.id, name: ctx.from.first_name || ctx.from.username, restText: '' };
    if (!target.id) return ctx.reply('کاربر پیدا نشد.');
    const level = getRole(group, target.id, botOwnerId);
    const cmd = ctx.message.text.split(/\s+/)[0].replace('/', '');
    if (cmd === 'history') {
      const logs = group.logs.filter((l) => l.target === target.id).slice(0, 10);
      const text = logs.length ? logs.map((l) => `${l.type} — ${new Date(l.date).toLocaleString('fa-IR')}`).join('\n') : 'تاریخچه‌ای یافت نشد.';
      return ctx.reply(`تاریخچه ${target.name}:\n${text}`);
    }
    const msgCount = (group.stats.today && group.stats.today[target.id]) || 0;
    const warns = group.warns[target.id] || 0;
    const muted = !!group.mutes[target.id];
    const banned = !!group.bans[target.id];
    await ctx.replyWithHTML(`پنل کاربر ${mention(target.name, target.id)}\nنقش: ${roleName(level)}\nپیام امروز: ${msgCount}\nاخطار: ${warns}/3\nوضعیت: ${banned ? 'بن' : muted ? 'سکوت' : 'عادی'}`);
  });

  bot.command('settings', async (ctx) => {
    const group = getGroup(ctx.chat.id);
    await ctx.reply(
      `تنظیمات گروه:\nزبان: ${group.settings.language}\nتعداد ادمین‌ها: ${group.admins.length}\n` +
      `تعداد مالکان: ${group.owners.length}\nتعداد ویژه‌ها: ${Object.keys(group.vips).length}\n` +
      `آستانه اخطار: ${group.settings.warnLimit || 3}\nمجازات اخطار: ${WARN_ACTION_LABELS[group.settings.warnAction || 'ban']}\n\n` +
      `برای تغییر: /setwarn <تعداد> <ban|mute|kick>  مثال: /setwarn 5 mute`
    );
  });

  bot.command('setwarn', async (ctx) => {
    const group = getGroup(ctx.chat.id);
    const actorLevel = getRole(group, ctx.from.id, botOwnerId);
    if (actorLevel < LEVEL.GOWNER) return ctx.reply('فقط مالک گروه می‌تواند این تنظیم را تغییر دهد.');
    const parts = ctx.message.text.split(/\s+/);
    const count = parseInt(parts[1], 10);
    const action = (parts[2] || '').toLowerCase();
    if (!count || count < 1 || !['ban', 'mute', 'kick'].includes(action)) return ctx.reply('فرمت درست: /setwarn <تعداد> <ban|mute|kick>  مثال: /setwarn 5 mute');
    group.settings.warnLimit = count;
    group.settings.warnAction = action;
    saveGroup(ctx.chat.id, group);
    await ctx.reply(`تنظیم شد: بعد از ${count} اخطار → ${WARN_ACTION_LABELS[action]}`);
  });

  bot.command(['locks', 'security'], async (ctx) => {
    const group = getGroup(ctx.chat.id);
    await ctx.reply('وضعیت قفل‌ها:', locksKeyboard(group));
  });

  bot.command('stats', async (ctx) => {
    const group = getGroup(ctx.chat.id);
    await ctx.reply(`آمار گروه:\nکل پیام‌ها: ${group.stats.messages}\nادمین‌ها: ${group.admins.length}\nمالکان: ${group.owners.length}\nویژه‌ها: ${Object.keys(group.vips).length}`);
  });

  bot.command('today', async (ctx) => {
    const group = getGroup(ctx.chat.id);
    const entries = Object.entries(group.stats.today || {}).sort((a, b) => b[1] - a[1]).slice(0, 15);
    if (!entries.length) return ctx.reply('امروز پیامی ثبت نشده.');
    const lines = entries.map(([id, count]) => { const u = getUser(id); return `${u ? u.firstName : id}: ${count}`; });
    await ctx.reply(`آمار امروز:\n${lines.join('\n')}`);
  });

  bot.command('logs', async (ctx) => {
    const group = getGroup(ctx.chat.id);
    if (!group.logs.length) return ctx.reply('گزارشی ثبت نشده.');
    const lines = group.logs.slice(0, 10).map((l) => `${l.type} — ${new Date(l.date).toLocaleString('fa-IR')}`);
    await ctx.reply(`آخرین گزارشات:\n${lines.join('\n')}`);
  });

  function listCommand(name, field, formatter) {
    bot.command(name, async (ctx) => {
      const group = getGroup(ctx.chat.id);
      const data = group[field];
      const ids = Array.isArray(data) ? data : Object.keys(data);
      if (!ids.length) return ctx.reply('لیست خالی است.');
      const lines = ids.map((id) => {
        const u = getUser(id);
        const label = u ? u.firstName : id;
        return formatter ? formatter(id, label, data) : `- ${label} (${id})`;
      });
      await ctx.reply(lines.join('\n'));
    });
  }
  listCommand('admins', 'admins');
  listCommand('owners', 'owners');
  listCommand('exempts', 'exempts');
  listCommand('mutelist', 'mutes');
  listCommand('banlist', 'bans');
  listCommand('vips', 'vips', (id, label, data) => `- ${label} (${id}) تا ${data[id].until ? new Date(data[id].until).toLocaleDateString('fa-IR') : 'همیشه'}`);

  bot.command('warnlist', async (ctx) => {
    const group = getGroup(ctx.chat.id);
    const entries = Object.entries(group.warns).filter(([, c]) => c > 0);
    if (!entries.length) return ctx.reply('کاربری با اخطار وجود ندارد.');
    const lines = entries.map(([id, c]) => { const u = getUser(id); return `- ${u ? u.firstName : id}: ${c}/3`; });
    await ctx.reply(lines.join('\n'));
  });

  bot.command('backup', async (ctx) => {
    const group = getGroup(ctx.chat.id);
    const buffer = Buffer.from(JSON.stringify(group, null, 2), 'utf8');
    await ctx.replyWithDocument({ source: buffer, filename: `backup-${ctx.chat.id}.json` });
  });

  bot.command('restore', async (ctx) => {
    const reply = ctx.message.reply_to_message;
    if (!reply || !reply.document) return ctx.reply('برای بازیابی، روی فایل بکاپ ریپلای کنید.');
    try {
      const link = await ctx.telegram.getFileLink(reply.document.file_id);
      const res = await fetch(link.href);
      const data = await res.json();
      saveGroup(ctx.chat.id, data);
      await ctx.reply('بازیابی با موفقیت انجام شد.');
    } catch (e) {
      await ctx.reply('خطا در بازیابی: ' + e.message);
    }
  });

  bot.command('reset', async (ctx) => {
    const what = ctx.message.text.split(/\s+/)[1];
    const group = getGroup(ctx.chat.id);
    const map = {
      locks: () => (group.locks = {}),
      welcome: () => (group.welcome = 'سلام {name} خوش اومدی به گروه!'),
      rules: () => (group.rules = ''),
      filters: () => {},
      buttons: () => {},
      colors: () => {},
      settings: () => (group.settings = { language: 'fa', warnLimit: 3, warnAction: 'ban' })
    };
    if (!map[what]) return ctx.reply('نوع بازنشانی نامعتبر است.');
    map[what]();
    saveGroup(ctx.chat.id, group);
    await ctx.reply(`${what} بازنشانی شد.`);
  });

  bot.command('clear', async (ctx) => {
    const what = ctx.message.text.split(/\s+/)[1];
    const group = getGroup(ctx.chat.id);
    const map = {
      bans: () => (group.bans = {}),
      mutes: () => (group.mutes = {}),
      warns: () => (group.warns = {}),
      vips: () => (group.vips = {}),
      exempts: () => (group.exempts = []),
      managers: () => (group.managers = []),
      owners: () => (group.owners = []),
      reports: () => {},
      today: () => (group.stats.today = {}),
      stats: () => (group.stats = { messages: 0, today: {}, lastReset: new Date().toISOString().slice(0, 10) }),
      logs: () => (group.logs = [])
    };
    if (!map[what]) return ctx.reply('نوع پاکسازی نامعتبر است.');
    map[what]();
    saveGroup(ctx.chat.id, group);
    await ctx.reply(`${what} پاک شد.`);
  });

  bot.command('del', async (ctx) => {
    const reply = ctx.message.reply_to_message;
    if (!reply) return ctx.reply('روی پیام مورد نظر ریپلای کنید.');
    try { await ctx.deleteMessage(reply.message_id); await ctx.deleteMessage(ctx.message.message_id); } catch (e) {}
  });
  bot.command('pin', async (ctx) => {
    const reply = ctx.message.reply_to_message;
    if (!reply) return ctx.reply('روی پیام مورد نظر ریپلای کنید.');
    await ctx.pinChatMessage(reply.message_id);
    await ctx.reply('پیام پین شد.');
  });
  bot.command('unpin', async (ctx) => { await ctx.unpinChatMessage(); await ctx.reply('پین برداشته شد.'); });
  bot.command('rules', async (ctx) => { const group = getGroup(ctx.chat.id); await ctx.reply(group.rules || 'قوانینی ثبت نشده است.'); });
  bot.command('setrules', async (ctx) => {
    const text = ctx.message.text.split(/\s+/).slice(1).join(' ');
    const group = getGroup(ctx.chat.id);
    group.rules = text;
    saveGroup(ctx.chat.id, group);
    await ctx.reply('قوانین به‌روزرسانی شد.');
  });
  bot.command('welcome', async (ctx) => { const group = getGroup(ctx.chat.id); await ctx.reply(group.welcome); });
  bot.command(['setwelcome', 'editwelcome'], async (ctx) => {
    const text = ctx.message.text.split(/\s+/).slice(1).join(' ');
    if (!text) return ctx.reply('متن خوش‌آمدگویی را بنویسید. از {name} برای نام کاربر استفاده کنید.');
    const group = getGroup(ctx.chat.id);
    group.welcome = text;
    saveGroup(ctx.chat.id, group);
    await ctx.reply('پیام خوش‌آمدگویی به‌روزرسانی شد.');
  });

  bot.command(['lock', 'unlock'], async (ctx) => {
    const group = getGroup(ctx.chat.id);
    const actorLevel = getRole(group, ctx.from.id, botOwnerId);
    if (actorLevel < LEVEL.ADMIN) return ctx.reply('دسترسی لازم را ندارید.');
    const [cmd, type] = ctx.message.text.split(/\s+/);
    const action = cmd.replace('/', '');
    if (!type) return ctx.reply('نوع قفل را مشخص کنید. مثال: /lock links');
    group.locks[type] = action === 'lock';
    saveGroup(ctx.chat.id, group);
    await ctx.reply(`قفل ${type} ${action === 'lock' ? 'فعال' : 'غیرفعال'} شد.`);
  });

  bot.command(['purge', 'cleanup'], async (ctx) => {
    const group = getGroup(ctx.chat.id);
    const actorLevel = getRole(group, ctx.from.id, botOwnerId);
    if (actorLevel < LEVEL.ADMIN) return ctx.reply('دسترسی لازم را ندارید.');
    const arg = ctx.message.text.split(/\s+/)[1];
    if (!arg) return ctx.reply('نوع پاکسازی را وارد کنید: عدد، bots، links، forwards، media، muted_messages');
    let toDelete = [];
    if (/^\d+$/.test(arg)) toDelete = group.recentMessages.slice(0, parseInt(arg, 10));
    else if (arg === 'bots') toDelete = group.recentMessages.filter((m) => m.isBot);
    else if (arg === 'muted_messages') toDelete = group.recentMessages.filter((m) => group.mutes[m.from]);
    else if (['links', 'forwards', 'media'].includes(arg)) {
      const typeKey = arg === 'forwards' ? 'forward' : arg;
      toDelete = group.recentMessages.filter((m) => m.types.includes(typeKey));
    } else return ctx.reply('نوع پاکسازی نامعتبر است.');

    let deleted = 0;
    for (const m of toDelete) {
      try { await ctx.telegram.deleteMessage(ctx.chat.id, m.id); deleted++; } catch (e) {}
    }
    group.recentMessages = group.recentMessages.filter((m) => !toDelete.includes(m));
    saveGroup(ctx.chat.id, group);
    await ctx.reply(`${deleted} پیام حذف شد.`);
  });
}

/* ============================================================
   BOT LIFECYCLE
   ============================================================ */
let botInstance = null;
async function startBot(token, ownerId) {
  if (botInstance) { try { await botInstance.stop('restart'); } catch (e) {} }
  const bot = new Telegraf(token);
  registerCommands(bot, ownerId);
  bot.catch((err, ctx) => console.error('Bot error for update', ctx.updateType, err));
  await bot.launch();
  botInstance = bot;
  console.log('Bot started successfully.');
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
  return bot;
}

/* ============================================================
   EXPRESS SERVER + SETUP WIZARD
   ============================================================ */
const app = express();
app.use(express.urlencoded({ extended: true }));
const PORT = process.env.PORT || 3000;
let status = { running: false, error: null, botUsername: null };

const PAGE_STYLE = `
<style>
  body{font-family:sans-serif;max-width:480px;margin:60px auto;padding:0 16px;background:#f7f7f5;color:#222}
  .card{background:#fff;border:1px solid #e2e2df;border-radius:12px;padding:24px}
  h1{font-size:20px;margin:0 0 8px}
  p{color:#555;font-size:14px;line-height:1.6}
  label{display:block;margin:16px 0 6px;font-size:13px;color:#333}
  input{width:100%;box-sizing:border-box;padding:10px;border:1px solid #ccc;border-radius:8px;font-size:14px}
  button{margin-top:20px;width:100%;padding:12px;border:none;border-radius:8px;background:#222;color:#fff;font-size:15px;cursor:pointer}
  .ok{color:#137333}
  .err{color:#c5221f}
</style>`;

function renderSetupForm(error) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>راه‌اندازی ربات</title>${PAGE_STYLE}</head>
  <body><div class="card">
  <h1>راه‌اندازی ربات مدیریت گروه</h1>
  <p>توکن ربات خود (از BotFather) و آیدی عددی تلگرام خودتان (مالک ربات) را وارد کنید.</p>
  ${error ? `<p class="err">${error}</p>` : ''}
  <form method="POST" action="/setup">
    <label>توکن ربات</label>
    <input name="token" placeholder="123456:ABC-DEF..." required />
    <label>آیدی عددی مالک ربات</label>
    <input name="ownerId" placeholder="123456789" required pattern="\\d+" />
    <button type="submit">ساخت و راه‌اندازی ربات</button>
  </form>
  </div></body></html>`;
}
function renderStatus() {
  return `<!doctype html><html><head><meta charset="utf-8"><title>وضعیت ربات</title>${PAGE_STYLE}</head>
  <body><div class="card">
  <h1>ربات فعال است</h1>
  <p class="ok">✓ ربات ${status.botUsername ? '@' + status.botUsername : ''} با موفقیت در حال اجراست.</p>
  <p>حالا ربات را به گروه خود اضافه کنید و به آن دسترسی ادمین (حذف پیام، مسدود کردن کاربران، پین کردن) بدهید.</p>
  <p>برای مشاهده امکانات داخل گروه دستور <b>/panel</b> را بفرستید.</p>
  <form method="GET" action="/reconfigure"><button type="submit" style="background:#777">تغییر توکن / مالک</button></form>
  </div></body></html>`;
}

async function tryAutoStart() {
  let cfg = getConfig();
  if (!cfg && process.env.BOT_TOKEN && process.env.OWNER_ID) {
    cfg = { token: process.env.BOT_TOKEN, ownerId: process.env.OWNER_ID };
    saveConfig(cfg);
  }
  if (!cfg) return;
  try {
    const bot = await startBot(cfg.token, cfg.ownerId);
    const me = await bot.telegram.getMe();
    status = { running: true, error: null, botUsername: me.username };
  } catch (e) {
    status = { running: false, error: e.message, botUsername: null };
  }
}

app.get('/', (req, res) => { if (status.running) return res.send(renderStatus()); res.send(renderSetupForm(status.error)); });
app.get('/reconfigure', (req, res) => { status = { running: false, error: null, botUsername: null }; res.send(renderSetupForm(null)); });
app.post('/setup', async (req, res) => {
  const { token, ownerId } = req.body;
  if (!token || !ownerId) return res.send(renderSetupForm('لطفاً هر دو مقدار را وارد کنید.'));
  try {
    const testBot = new Telegraf(token);
    const me = await testBot.telegram.getMe();
    saveConfig({ token, ownerId });
    await startBot(token, ownerId);
    status = { running: true, error: null, botUsername: me.username };
    res.redirect('/');
  } catch (e) {
    res.send(renderSetupForm('توکن نامعتبر است یا خطایی رخ داد: ' + e.message));
  }
});
app.get('/health', (req, res) => res.json({ ok: true, running: status.running }));

app.listen(PORT, async () => {
  console.log('Server listening on port', PORT);
  await tryAutoStart();
});
