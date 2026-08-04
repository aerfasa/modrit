const fs = require('fs');
const path = require('path');
const express = require('express');
const { Telegraf, Markup } = require('telegraf');

/* ============================================================
   DB LAYER
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
  } catch (e) { console.error('read fail', file, e.message); return fallback; }
}
function saveJSON(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8'); }

let store = loadJSON(DB_FILE, { groups: {}, users: {} });
function persist() { saveJSON(DB_FILE, store); }
function getConfig() { return loadJSON(CONFIG_FILE, null); }
function saveConfig(cfg) { saveJSON(CONFIG_FILE, cfg); }

function defaultGroup() {
  return {
    settings: { language: 'fa', warnLimit: 3, warnAction: 'ban' },
    welcome: 'سلام {name} خوش اومدی به گروه! 🌸',
    rules: '',
    owners: [], admins: [], managers: [],
    vips: {}, exempts: [],
    mutes: {}, bans: {}, warns: {},
    locks: {}, filters: [], nicknames: {},
    stats: { messages: 0, today: {}, lastReset: new Date().toISOString().slice(0, 10) },
    logs: [], recentMessages: []
  };
}
function getGroup(chatId) {
  chatId = String(chatId);
  if (!store.groups[chatId]) { store.groups[chatId] = defaultGroup(); persist(); }
  const g = store.groups[chatId];
  const d = defaultGroup();
  for (const k of Object.keys(d)) if (!(k in g)) g[k] = d[k];
  return g;
}
function saveGroup(chatId, data) { store.groups[String(chatId)] = data; persist(); }
function upsertUser(userId, info) {
  userId = String(userId);
  store.users[userId] = { ...(store.users[userId] || {}), ...info, id: Number(userId) };
  persist();
}
function findUserByUsername(username) {
  username = username.replace(/^@/, '').toLowerCase();
  for (const id in store.users) if ((store.users[id].username || '').toLowerCase() === username) return store.users[id];
  return null;
}
function getUser(userId) { return store.users[String(userId)] || null; }
function addLog(chatId, entry) {
  const g = getGroup(chatId);
  g.logs.unshift({ ...entry, date: new Date().toISOString() });
  g.logs = g.logs.slice(0, 200);
  saveGroup(chatId, g);
}
// distinct sender ids seen recently in a group (from the rolling message buffer)
function knownSenderIds(group, { botsOnly = false } = {}) {
  const seen = new Map();
  for (const m of group.recentMessages) {
    if (botsOnly && !m.isBot) continue;
    if (!seen.has(m.from)) seen.set(m.from, m);
  }
  return Array.from(seen.keys());
}

/* ============================================================
   UTILS
   ============================================================ */
const UNIT_MS = { s: 1000, m: 60e3, h: 3.6e6, d: 8.64e7, w: 6.048e8 };
const PERMANENT_WORDS = ['permanent', 'دائم', 'دائمی', 'همیشه'];
function parseDuration(input) {
  if (!input) return null;
  const raw = input.trim().toLowerCase();
  if (PERMANENT_WORDS.some((w) => raw === w)) return { permanent: true };
  const m = raw.match(/^(\d+)\s*(s|sec|m|min|h|hr|d|day|w|week)?$/);
  if (!m) return null;
  const num = parseInt(m[1], 10);
  const unit = (m[2] || 'm')[0];
  if (!UNIT_MS[unit]) return null;
  return { ms: num * UNIT_MS[unit] };
}
function formatDuration(ms) {
  if (ms == null) return 'دائمی';
  const u = [['w', UNIT_MS.w], ['d', UNIT_MS.d], ['h', UNIT_MS.h], ['m', UNIT_MS.m], ['s', UNIT_MS.s]];
  for (const [k, v] of u) if (ms >= v) return `${Math.round(ms / v)}${k}`;
  return `${ms}ms`;
}
function extractTarget(ctx, argsText) {
  const reply = ctx.message && ctx.message.reply_to_message;
  if (reply && reply.from) {
    return { id: reply.from.id, name: reply.from.first_name || reply.from.username || String(reply.from.id), username: reply.from.username || null, restText: (argsText || '').trim() };
  }
  if (!argsText) return null;
  const parts = argsText.trim().split(/\s+/);
  const first = parts[0];
  if (!first) return null;
  const rest = parts.slice(1).join(' ');
  const tg = first.match(/tg:\/\/user\?id=(\d+)/);
  if (tg) { const u = getUser(tg[1]); return { id: Number(tg[1]), name: u ? u.firstName : tg[1], username: u ? u.username : null, restText: rest }; }
  if (/^\d+$/.test(first)) { const u = getUser(first); return { id: Number(first), name: u ? u.firstName : first, username: u ? u.username : null, restText: rest }; }
  if (first.startsWith('@')) {
    const u = findUserByUsername(first);
    if (!u) return { id: null, name: first, username: first.replace('@', ''), restText: rest, notFound: true };
    return { id: u.id, name: u.firstName || u.username, username: u.username, restText: rest };
  }
  return null;
}
function mention(name, id) { return `<a href="tg://user?id=${id}">${String(name).replace(/[<>&]/g, '')}</a>`; }
function esc(s) { return String(s == null ? '' : s).replace(/[<>&]/g, ''); }

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
function roleLabel(level) {
  return { 100: '👑 مالک ربات', 90: '👑 مالک گروه', 80: '🛡️ ادمین', 70: '🎖️ مدیر', 50: '⭐ ویژه', 40: '🎗️ معاف', 0: '👤 عادی' }[level] || '👤 عادی';
}
function canAct(actorLevel, targetLevel) { return actorLevel === LEVEL.OWNER || actorLevel > targetLevel; }

const FULL_PERMS = {
  can_send_messages: true, can_send_audios: true, can_send_documents: true, can_send_photos: true,
  can_send_videos: true, can_send_video_notes: true, can_send_voice_notes: true, can_send_polls: true,
  can_send_other_messages: true, can_add_web_page_previews: true
};
const MUTE_PERMS = {
  can_send_messages: false, can_send_audios: false, can_send_documents: false, can_send_photos: false,
  can_send_videos: false, can_send_video_notes: false, can_send_voice_notes: false, can_send_polls: false,
  can_send_other_messages: false, can_add_web_page_previews: false
};

/* ============================================================
   LOCKS — types, Persian aliases, detection
   ============================================================ */
const LOCK_META = {
  links: { emoji: '🔗', fa: 'لینک', cat: 'content' },
  hyperlink: { emoji: '🔗', fa: 'هایپرلینک', cat: 'content' },
  username: { emoji: '🏷️', fa: 'تگ/یوزرنیم', cat: 'content' },
  hashtag: { emoji: '#️⃣', fa: 'هشتگ', cat: 'content' },
  forward: { emoji: '↪️', fa: 'فوروارد', cat: 'content' },
  text: { emoji: '📝', fa: 'متن', cat: 'content' },
  group: { emoji: '🔐', fa: 'قفل کامل گروه', cat: 'content' },
  photo: { emoji: '📷', fa: 'عکس', cat: 'media' },
  video: { emoji: '🎥', fa: 'فیلم', cat: 'media' },
  gif: { emoji: '🎞️', fa: 'گیف', cat: 'media' },
  sticker: { emoji: '🎭', fa: 'استیکر', cat: 'media' },
  animatedsticker: { emoji: '🌀', fa: 'استیکر متحرک', cat: 'media' },
  videonote: { emoji: '🤳', fa: 'فیلم سلفی', cat: 'media' },
  voice: { emoji: '🎙️', fa: 'ویس', cat: 'media' },
  audio: { emoji: '🎵', fa: 'آهنگ', cat: 'media' },
  file: { emoji: '📁', fa: 'فایل', cat: 'media' },
  media: { emoji: '🖼️', fa: 'کل رسانه‌ها', cat: 'media' },
  editmedia: { emoji: '✏️', fa: 'ویرایش رسانه', cat: 'media' },
  spam: { emoji: '🚫', fa: 'اسپم/تبلیغ', cat: 'behavior' },
  flood: { emoji: '🌊', fa: 'رگبار/لیمیت پیام', cat: 'behavior' },
  bot: { emoji: '🤖', fa: 'پیام ربات‌ها', cat: 'behavior' },
  addbot: { emoji: '➕🤖', fa: 'اد کردن ربات', cat: 'behavior' },
  inline: { emoji: '🕹️', fa: 'اینلاین', cat: 'behavior' },
  commands: { emoji: '⌨️', fa: 'دستورات', cat: 'behavior' },
  edit: { emoji: '✏️', fa: 'ویرایش پیام', cat: 'behavior' },
  service: { emoji: '🛠️', fa: 'سرویس تلگرام', cat: 'behavior' },
  auth: { emoji: '🔰', fa: 'احراز هویت ورودی‌ها', cat: 'behavior' },
  strict: { emoji: '🛡️', fa: 'حالت سختگیرانه', cat: 'behavior' },
  emoji: { emoji: '😀', fa: 'ایموجی زیاد', cat: 'emoji' },
  onlyemoji: { emoji: '😶', fa: 'ایموجی تنها', cat: 'emoji' },
  animatedemoji: { emoji: '✨', fa: 'ایموجی متحرک', cat: 'emoji' },
  contact: { emoji: '📇', fa: 'مخاطب', cat: 'misc' },
  location: { emoji: '📍', fa: 'موقعیت مکانی', cat: 'misc' },
  poll: { emoji: '📊', fa: 'نظرسنجی', cat: 'misc' },
  game: { emoji: '🎮', fa: 'بازی', cat: 'misc' },
  persian: { emoji: '🔡', fa: 'زبان فارسی', cat: 'misc' },
  english: { emoji: '🔤', fa: 'زبان انگلیسی', cat: 'misc' }
};
const LOCK_CATEGORIES = {
  content: '📝 محتوا و لینک', media: '🖼️ رسانه', behavior: '🤖 رفتار و امنیت', emoji: '😀 ایموجی', misc: '📌 متفرقه'
};

const PERSIAN_LOCK_ALIASES = [
  ['اد ربات', 'addbot'], ['استیکر متحرک', 'animatedsticker'], ['ایموجی متحرک', 'animatedemoji'],
  ['ایموجی تنها', 'onlyemoji'], ['فیلم سلفی', 'videonote'], ['ویرایش رسانه', 'editmedia'],
  ['سرویس تلگرام', 'service'], ['احراز هویت', 'auth'], ['سختگیرانه', 'strict'],
  ['استیکر', 'sticker'], ['گیف', 'gif'], ['عکس', 'photo'], ['فیلم', 'video'], ['رسانه', 'media'],
  ['ویرایش', 'edit'], ['ایموجی', 'emoji'], ['بازی', 'game'], ['فایل', 'file'], ['دستورات', 'commands'],
  ['مخاطب', 'contact'], ['مکان', 'location'], ['هشتگ', 'hashtag'], ['فوروارد', 'forward'],
  ['گروه', 'group'], ['متن', 'text'], ['فارسی', 'persian'], ['انگلیسی', 'english'], ['آهنگ', 'audio'],
  ['ویس', 'voice'], ['تبچی', 'spam'], ['رگبار', 'flood'], ['لیمیت', 'flood'],
  ['لینک', 'links'], ['هایپر', 'hyperlink'], ['تگ', 'username'], ['اینلاین', 'inline'], ['ربات', 'bot']
];

const LOCK_TYPES = Object.keys(LOCK_META);
const floodTracker = {};
const spamTracker = {};

function detectTypes(msg) {
  const types = new Set();
  if (!msg) return types;
  const entities = msg.entities || msg.caption_entities || [];
  if (entities.some((e) => e.type === 'url')) types.add('links');
  if (entities.some((e) => e.type === 'text_link')) { types.add('links'); types.add('hyperlink'); }
  if (/https?:\/\/|t\.me\//i.test(msg.text || msg.caption || '')) types.add('links');
  if (entities.some((e) => e.type === 'mention' || e.type === 'text_mention')) types.add('username');
  if (entities.some((e) => e.type === 'hashtag')) types.add('hashtag');
  if (entities.some((e) => e.type === 'custom_emoji')) types.add('animatedemoji');
  if (msg.forward_from || msg.forward_from_chat || msg.forward_origin) types.add('forward');
  if (msg.from && msg.from.is_bot) types.add('bot');

  if (msg.photo) { types.add('photo'); types.add('media'); }
  if (msg.video) { types.add('video'); types.add('media'); }
  if (msg.animation) { types.add('gif'); types.add('media'); }
  if (msg.sticker) {
    types.add('sticker'); types.add('media');
    if (msg.sticker.is_animated || msg.sticker.is_video) types.add('animatedsticker');
  }
  if (msg.video_note) { types.add('videonote'); types.add('media'); }
  if (msg.voice) { types.add('voice'); types.add('media'); }
  if (msg.audio) { types.add('audio'); types.add('media'); }
  if (msg.document) { types.add('file'); types.add('media'); }
  if (msg.contact) types.add('contact');
  if (msg.location || msg.venue) types.add('location');
  if (msg.poll) types.add('poll');
  if (msg.game) types.add('game');
  if (msg.via_bot) types.add('inline');
  if (msg.pinned_message || msg.new_chat_title || msg.new_chat_photo || msg.delete_chat_photo || msg.video_chat_started || msg.video_chat_ended) types.add('service');

  const text = msg.text || msg.caption || '';
  if (text) {
    if (text.startsWith('/')) types.add('commands'); else types.add('text');
    const emojiRegex = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu;
    const stripped = text.replace(/\s/g, '');
    const emojiCount = (text.match(emojiRegex) || []).length;
    if (emojiCount > 0 && emojiCount >= stripped.length * 0.5) types.add('emoji');
    const onlyEmojiLeft = stripped.replace(emojiRegex, '').replace(/[\u{FE0F}\u{200D}]/gu, '');
    if (stripped.length > 0 && onlyEmojiLeft.length === 0) types.add('onlyemoji');
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

// Build "قفل X" / "بازکردن X" / "باز کردن X" / "حذف قفل X" trigger phrases
const LOCK_PHRASE_TRIGGERS = [];
for (const [word, type] of PERSIAN_LOCK_ALIASES) {
  LOCK_PHRASE_TRIGGERS.push({ phrase: `قفل ${word}`, type, on: true });
  LOCK_PHRASE_TRIGGERS.push({ phrase: `بازکردن ${word}`, type, on: false });
  LOCK_PHRASE_TRIGGERS.push({ phrase: `باز کردن ${word}`, type, on: false });
  LOCK_PHRASE_TRIGGERS.push({ phrase: `حذف قفل ${word}`, type, on: false });
}
LOCK_PHRASE_TRIGGERS.sort((a, b) => b.phrase.length - a.phrase.length);

/* ============================================================
   MASTER TRIGGER TABLE (Persian plain-text commands)
   ============================================================ */
const MASTER_TRIGGERS = [];
function addTrigger(phrase, run) { MASTER_TRIGGERS.push({ phrase, run }); }
function sortTriggers() { MASTER_TRIGGERS.sort((a, b) => b.phrase.length - a.phrase.length); }

/* ============================================================
   PANEL (inline UI) — kept small per screen, categorized
   ============================================================ */
function backBtn(target = 'panel:main') { return [Markup.button.callback('⬅️ بازگشت', target)]; }

function mainMenuKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('👥 مدیریت کاربران', 'panel:users'), Markup.button.callback('⚙️ مدیریت گروه', 'panel:group')],
    [Markup.button.callback('🔒 قفل‌ها', 'panel:locks'), Markup.button.callback('🧹 پاکسازی', 'panel:cleanup')],
    [Markup.button.callback('📊 آمار', 'panel:stats'), Markup.button.callback('📖 راهنما', 'panel:guide')]
  ]);
}
const PANEL_TEXTS = {
  main: '🧭 <b>پنل مدیریت گروه</b>\n\nیه بخش رو انتخاب کن 👇',
  users:
    '👥 <b>مدیریت کاربران</b>\n\n' +
    '🔇 سکوت / 🔊 رفع سکوت\n⛔ بن / ✅ رفع بن\n👢 اخراج\n⚠️ اخطار / حذف اخطار / پاک اخطار\n' +
    '⭐ ویژه / حذف ویژه\n🎗️ معاف / حذف معاف\n🎖️ ترفیع / عزل مدیر\n🛡️ ادمین / حذف ادمین\n👑 مالک / حذف مالک\n' +
    '👤 پنل کاربر / نقش‌ها / تاریخچه\n\n' +
    '📌 با ریپلای یا @یوزرنیم/آیدی کار می‌کنه، هم فارسی هم انگلیسی.\nمثال: روی پیام کسی ریپلای کن و بنویس «سکوت 1h»',
  group:
    '⚙️ <b>مدیریت گروه</b>\n\n' +
    '🆔 آیدی — نمایش آیدی عددی\n👑 تنظیم مالک — تشخیص خودکار مالک واقعی گروه\n' +
    '📋 قوانین / تنظیم قوانین\n👋 خوش‌آمد / تنظیم خوش‌آمد\n' +
    '🗑️ حذف پیام / 📌 پین / حذف پین\n' +
    '💾 بکاپ / بازیابی\n⚠️ تنظیم اخطار <تعداد> <ban|mute|kick>\n' +
    '🚱 افزودن فیلتر <کلمه> / حذف فیلتر / لیست فیلتر',
  guide:
    '📖 <b>راهنمای سریع</b>\n\n' +
    '🔒 برای قفل کردن یک مورد بنویس: «قفل + نام مورد»\nمثال: «قفل لینک» یا «قفل عکس»\n' +
    '🔓 برای باز کردن: «بازکردن + نام مورد»\nمثال: «بازکردن لینک»\n\n' +
    '👤 مدیریت کاربر: ریپلای روی پیام + نوشتن دستور\nمثال: ریپلای + «سکوت 1h» یا «بن»\n\n' +
    '🧹 پاکسازی: بنویس «پاکسازی لیست بن» یا «پاکسازی ربات‌ها»\n\n' +
    'برای دیدن لیست کامل قفل‌ها، از دکمه‌ی 🔒 قفل‌ها استفاده کن.'
};

function locksMainKeyboard() {
  const rows = Object.entries(LOCK_CATEGORIES).map(([key, label]) => [Markup.button.callback(label, `lockcat:${key}`)]);
  rows.push([Markup.button.callback('📖 راهنمای قفل‌ها', 'lockguide')]);
  rows.push(backBtn());
  return Markup.inlineKeyboard(rows);
}
function locksCategoryKeyboard(group, cat) {
  const types = LOCK_TYPES.filter((t) => LOCK_META[t].cat === cat);
  const rows = [];
  for (let i = 0; i < types.length; i += 2) {
    rows.push(types.slice(i, i + 2).map((t) => {
      const on = !!(group.locks && group.locks[t]);
      const meta = LOCK_META[t];
      return Markup.button.callback(`${on ? '🔒' : '🔓'} ${meta.emoji} ${meta.fa}`, `lock:${t}`);
    }));
  }
  rows.push(backBtn('panel:locks'));
  return Markup.inlineKeyboard(rows);
}
function lockGuideText() {
  let text = '📖 <b>راهنمای دستوری قفل‌ها</b>\n\nبرای قفل: «قفل + کلمه» — برای باز کردن: «بازکردن + کلمه»\n\n';
  for (const [word, type] of PERSIAN_LOCK_ALIASES) {
    const meta = LOCK_META[type];
    text += `${meta.emoji} ${word}\n`;
  }
  return text;
}

async function showPanelMain(ctx) {
  const text = PANEL_TEXTS.main;
  const extra = { parse_mode: 'HTML', ...mainMenuKeyboard() };
  if (ctx.updateType === 'callback_query') await ctx.editMessageText(text, extra);
  else await ctx.reply(text, extra);
}

async function handlePanelCallback(ctx) {
  const data = ctx.callbackQuery.data;
  const chatId = ctx.chat.id;
  const edit = (text, kb) => ctx.editMessageText(text, { parse_mode: 'HTML', ...kb });

  if (data === 'panel:main') return showPanelMain(ctx);
  if (data === 'panel:users') return edit(PANEL_TEXTS.users, Markup.inlineKeyboard([backBtn()]));
  if (data === 'panel:group') return edit(PANEL_TEXTS.group, Markup.inlineKeyboard([backBtn()]));
  if (data === 'panel:guide') return edit(PANEL_TEXTS.guide, Markup.inlineKeyboard([backBtn()]));
  if (data === 'panel:cleanup') {
    const text = '🧹 <b>پاکسازی</b>\n\n📌 عدد: «پاکسازی 100» (حذف ۱۰۰ پیام اخیر)\n🤖 «پاکسازی ربات‌ها»\n' +
      '🔗 «پاکسازی لیست بن / سکوت / ویژه / معاف / مدیران / اخطار / فیلتر / فیک / دلیت»';
    return edit(text, Markup.inlineKeyboard([backBtn()]));
  }
  if (data === 'panel:stats') {
    const group = getGroup(chatId);
    const text = `📊 <b>آمار گروه</b>\n\n💬 کل پیام‌ها: ${group.stats.messages}\n🛡️ ادمین‌ها: ${group.admins.length}\n👑 مالکان: ${group.owners.length}\n⭐ ویژه‌ها: ${Object.keys(group.vips).length}`;
    return edit(text, Markup.inlineKeyboard([[Markup.button.callback('📅 آمار امروز', 'today'), Markup.button.callback('📜 گزارشات', 'logs')], backBtn()]));
  }
  if (data === 'today') { const t = await buildTodayText(chatId); return edit(t, Markup.inlineKeyboard([backBtn('panel:stats')])); }
  if (data === 'logs') { const t = buildLogsText(chatId); return edit(t, Markup.inlineKeyboard([backBtn('panel:stats')])); }

  if (data === 'panel:locks') return edit('🔒 <b>قفل‌ها</b>\nیک دسته رو انتخاب کن:', locksMainKeyboard());
  if (data === 'lockguide') return edit(lockGuideText(), Markup.inlineKeyboard([backBtn('panel:locks')]));
  if (data.startsWith('lockcat:')) {
    const cat = data.split(':')[1];
    const group = getGroup(chatId);
    return edit(`${LOCK_CATEGORIES[cat]}\nبرای تغییر لمس کن:`, locksCategoryKeyboard(group, cat));
  }
  if (data.startsWith('lock:')) {
    const type = data.split(':')[1];
    const group = getGroup(chatId);
    group.locks[type] = !group.locks[type];
    saveGroup(chatId, group);
    const cat = LOCK_META[type].cat;
    return edit(`${LOCK_CATEGORIES[cat]}\nبرای تغییر لمس کن:`, locksCategoryKeyboard(group, cat));
  }

  if (data.startsWith('mlist:')) return renderMemberListCallback(ctx, data);
  if (data.startsWith('member:')) return renderMemberCardCallback(ctx, data);
  if (data.startsWith('act:')) return performMemberActionCallback(ctx, data);
  if (data.startsWith('verify:')) return handleVerifyCallback(ctx, data);

  await ctx.answerCbQuery();
}

/* ---- member list UI (buttons instead of raw text dumps) ---- */
const LIST_META = {
  admins: { emoji: '🛡️', title: 'ادمین‌های ربات', removeLabel: '🗑️ حذف ادمین', minLevel: LEVEL.GOWNER },
  owners: { emoji: '👑', title: 'مالکان گروه', removeLabel: '🗑️ حذف مالک', minLevel: LEVEL.OWNER },
  vips: { emoji: '⭐', title: 'کاربران ویژه', removeLabel: '🗑️ حذف ویژه', minLevel: LEVEL.GOWNER },
  exempts: { emoji: '🎗️', title: 'معاف‌شده‌ها', removeLabel: '🗑️ حذف معافیت', minLevel: LEVEL.ADMIN },
  mutes: { emoji: '🔇', title: 'سکوت‌شده‌ها', removeLabel: '🔊 رفع سکوت', minLevel: LEVEL.ADMIN },
  bans: { emoji: '⛔', title: 'بن‌شده‌ها', removeLabel: '✅ رفع بن', minLevel: LEVEL.ADMIN }
};
function memberListText(field) { return `${LIST_META[field].emoji} <b>${LIST_META[field].title}</b>`; }
function memberListKeyboard(group, field) {
  const data = group[field];
  const ids = (Array.isArray(data) ? data : Object.keys(data)).slice(0, 20);
  const rows = ids.map((id) => {
    const u = getUser(id);
    return [Markup.button.callback(`${LIST_META[field].emoji} ${u ? u.firstName : id}`, `member:${field}:${id}`)];
  });
  if (!rows.length) rows.push([Markup.button.callback('📭 لیست خالیه', 'noop')]);
  rows.push(backBtn());
  return Markup.inlineKeyboard(rows);
}
async function sendMemberList(ctx, field) {
  const group = getGroup(ctx.chat.id);
  await ctx.reply(memberListText(field), { parse_mode: 'HTML', ...memberListKeyboard(group, field) });
}
async function renderMemberListCallback(ctx, data) {
  const field = data.split(':')[1];
  const group = getGroup(ctx.chat.id);
  await ctx.editMessageText(memberListText(field), { parse_mode: 'HTML', ...memberListKeyboard(group, field) });
}
async function renderMemberCardCallback(ctx, data) {
  const [, field, idStr] = data.split(':');
  const id = Number(idStr);
  const u = getUser(id);
  const name = u ? u.firstName : idStr;
  const text = `${LIST_META[field].emoji} ${mention(name, id)}\n🆔 <code>${id}</code>`;
  const kb = Markup.inlineKeyboard([
    [Markup.button.callback(LIST_META[field].removeLabel, `act:${field}:${id}`)],
    backBtn(`mlist:${field}`)
  ]);
  await ctx.editMessageText(text, { parse_mode: 'HTML', ...kb });
}
async function performMemberActionCallback(ctx, data) {
  const [, field, idStr] = data.split(':');
  const id = Number(idStr);
  const chatId = ctx.chat.id;
  const group = getGroup(chatId);
  const actorLevel = getRole(group, ctx.from.id, ctx.state.botOwnerId);
  if (actorLevel < LIST_META[field].minLevel) return ctx.answerCbQuery('⛔ دسترسی نداری', { show_alert: true });

  try {
    if (field === 'admins') group.admins = group.admins.filter((x) => x !== id);
    else if (field === 'owners') group.owners = group.owners.filter((x) => x !== id);
    else if (field === 'vips') delete group.vips[id];
    else if (field === 'exempts') group.exempts = group.exempts.filter((x) => x !== id);
    else if (field === 'mutes') { try { await ctx.telegram.restrictChatMember(chatId, id, { permissions: FULL_PERMS }); } catch (e) {} delete group.mutes[id]; }
    else if (field === 'bans') { try { await ctx.telegram.unbanChatMember(chatId, id, { only_if_banned: true }); } catch (e) {} delete group.bans[id]; }
    saveGroup(chatId, group);
    await ctx.answerCbQuery('✅ انجام شد');
    await ctx.editMessageText(memberListText(field), { parse_mode: 'HTML', ...memberListKeyboard(group, field) });
  } catch (e) {
    await ctx.answerCbQuery('خطا: ' + e.message, { show_alert: true });
  }
}
async function handleVerifyCallback(ctx, data) {
  const uid = Number(data.split(':')[1]);
  if (ctx.from.id !== uid) return ctx.answerCbQuery('❌ این دکمه برای شما نیست', { show_alert: true });
  try { await ctx.telegram.restrictChatMember(ctx.chat.id, uid, { permissions: FULL_PERMS }); } catch (e) {}
  await ctx.editMessageText('✅ هویت تایید شد، خوش اومدی! 🎉');
  await ctx.answerCbQuery('تایید شد ✅');
}

async function buildTodayText(chatId) {
  const group = getGroup(chatId);
  const entries = Object.entries(group.stats.today || {}).sort((a, b) => b[1] - a[1]).slice(0, 15);
  if (!entries.length) return '📅 امروز پیامی ثبت نشده.';
  const lines = entries.map(([id, c], i) => { const u = getUser(id); return `${i + 1}. ${u ? u.firstName : id} — ${c} 💬`; });
  return `📅 <b>آمار امروز</b>\n\n${lines.join('\n')}`;
}
function buildLogsText(chatId) {
  const group = getGroup(chatId);
  if (!group.logs.length) return '📜 گزارشی ثبت نشده.';
  const lines = group.logs.slice(0, 10).map((l) => `• ${l.type} — ${new Date(l.date).toLocaleString('fa-IR')}`);
  return `📜 <b>آخرین گزارشات</b>\n\n${lines.join('\n')}`;
}

/* ============================================================
   COMMANDS
   ============================================================ */
const ACTION_PERSIAN_TRIGGERS = [
  ['رفع سکوت', 'unmute'], ['سکوت دائمی', 'mute'], ['سکوت', 'mute'],
  ['رفع بن', 'unban'], ['بن دائمی', 'ban'], ['بن', 'ban'],
  ['اخراج', 'kick'], ['حذف اخطار', 'unwarn'], ['پاک اخطار', 'clearwarn'], ['اخطار', 'warn'],
  ['حذف ویژه', 'unvip'], ['ویژه', 'vip'], ['حذف معاف', 'unexempt'], ['معاف', 'exempt'],
  ['ترفیع', 'promote'], ['عزل', 'demote'], ['حذف ادمین', 'unadmin'], ['ادمین', 'admin'],
  ['حذف مالک', 'unowner'], ['مالک', 'owner']
];

const WARN_LABELS = { ban: '⛔ بن دائم', mute: '🔇 سکوت دائم', kick: '👢 اخراج' };
function timeNow() { return Math.floor(Date.now() / 1000); }

function registerCommands(bot, botOwnerId) {
  MASTER_TRIGGERS.length = 0; // avoid duplicate triggers if the bot is restarted/reconfigured
  bot.use((ctx, next) => { ctx.state = ctx.state || {}; ctx.state.botOwnerId = botOwnerId; return next(); });

  /* ---------- tracking + lock enforcement ---------- */
  bot.on('message', async (ctx, next) => {
    const msg = ctx.message;
    if (msg.from) upsertUser(msg.from.id, { username: msg.from.username || null, firstName: msg.from.first_name || msg.from.username || String(msg.from.id) });

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
      if (actorLevel < LEVEL.EXEMPT) {
        let violated = null;
        if (group.locks.group) violated = 'group';
        if (!violated) violated = types.find((t) => group.locks[t]);
        if (!violated && group.locks.strict) {
          const forced = ['links', 'forward', 'username', 'spam', 'flood', 'bot'];
          violated = types.find((t) => forced.includes(t));
        }
        if (!violated && group.locks.flood && checkFlood(ctx.chat.id, msg.from.id)) violated = 'flood';
        if (!violated && group.locks.spam && checkSpam(ctx.chat.id, msg.from.id, msg.text)) violated = 'spam';
        if (!violated && group.filters && group.filters.length && msg.text) {
          const lower = msg.text.toLowerCase();
          if (group.filters.some((w) => lower.includes(w.toLowerCase()))) violated = 'filter';
        }
        if (violated) {
          try { await ctx.deleteMessage(msg.message_id); addLog(ctx.chat.id, { type: 'lock', by: 'system', target: msg.from.id, note: violated }); } catch (e) {}
          return;
        }
      }
    }
    return next();
  });

  bot.on('edited_message', async (ctx) => {
    const msg = ctx.editedMessage || ctx.update.edited_message;
    if (!ctx.chat || (ctx.chat.type !== 'group' && ctx.chat.type !== 'supergroup') || !msg) return;
    const group = getGroup(ctx.chat.id);
    const actorLevel = getRole(group, msg.from.id, botOwnerId);
    if (actorLevel >= LEVEL.EXEMPT) return;
    const types = Array.from(detectTypes(msg));
    const isMedia = types.some((t) => ['photo', 'video', 'gif', 'sticker', 'file', 'media', 'voice', 'audio', 'videonote'].includes(t));
    if (group.locks.edit || (group.locks.editmedia && isMedia)) {
      try { await ctx.telegram.deleteMessage(ctx.chat.id, msg.message_id); } catch (e) {}
    }
  });

  /* ---------- join / leave / bot-added handling ---------- */
  bot.on('new_chat_members', async (ctx) => {
    const me = await ctx.telegram.getMe();
    const group = getGroup(ctx.chat.id);
    const actorLevel = getRole(group, ctx.message.from.id, botOwnerId);
    for (const member of ctx.message.new_chat_members) {
      if (member.id === me.id) {
        await ctx.reply('🎉 ربات با موفقیت در گروه نصب شد!\n\nبرای دیدن امکانات دکمه‌ی زیر رو بزن 👇', { parse_mode: 'HTML', ...mainMenuKeyboard() });
        continue;
      }
      if (member.is_bot) {
        if (group.locks.addbot && actorLevel < LEVEL.ADMIN) {
          try {
            await ctx.telegram.banChatMember(ctx.chat.id, member.id);
            await ctx.telegram.unbanChatMember(ctx.chat.id, member.id, { only_if_banned: true });
            await ctx.reply(`🤖⛔ ربات ${esc(member.first_name)} به دلیل قفل «اد ربات» اخراج شد.`);
          } catch (e) {}
        } else {
          await ctx.reply(`🤖 ربات ${esc(member.first_name)} اضافه شد.`);
        }
        continue;
      }
      if (group.locks.auth) {
        try {
          await ctx.telegram.restrictChatMember(ctx.chat.id, member.id, { permissions: MUTE_PERMS });
          await ctx.reply(`🔰 ${mention(member.first_name || 'کاربر', member.id)} خوش اومدی! برای شروع، تایید کن که ربات نیستی 👇`, {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([[Markup.button.callback('✅ تایید می‌کنم ربات نیستم', `verify:${member.id}`)]])
          });
        } catch (e) {}
      } else {
        const text = (group.welcome || 'خوش اومدی {name}! 🌸').replace('{name}', member.first_name || member.username || '');
        await ctx.reply(text);
      }
    }
  });

  bot.action(/^panel:/, handlePanelCallback);
  bot.action(/^lock/, handlePanelCallback);
  bot.action(/^today$/, handlePanelCallback);
  bot.action(/^logs$/, handlePanelCallback);
  bot.action(/^mlist:/, handlePanelCallback);
  bot.action(/^member:/, handlePanelCallback);
  bot.action(/^act:/, handlePanelCallback);
  bot.action(/^verify:/, handlePanelCallback);
  bot.action('noop', (ctx) => ctx.answerCbQuery());

  bot.command(['panel', 'gpanel'], showPanelMain);
  bot.start(async (ctx) => {
    if (ctx.chat.type === 'private') {
      await ctx.reply('🤖 سلام! من ربات مدیریت گروه هستم.\nمنو رو به یک گروه اضافه کن و ادمینم کن تا شروع کنیم 🚀');
    }
  });

  /* ---------- moderation ACTIONS ---------- */
  const ACTIONS = {
    mute: { minLevel: LEVEL.ADMIN, duration: true, apply: applyMute, label: '🔇 سکوت' },
    unmute: { minLevel: LEVEL.ADMIN, apply: applyUnmute, label: '🔊 رفع سکوت' },
    ban: { minLevel: LEVEL.ADMIN, duration: true, apply: applyBan, label: '⛔ بن' },
    unban: { minLevel: LEVEL.ADMIN, apply: applyUnban, label: '✅ رفع بن' },
    kick: { minLevel: LEVEL.ADMIN, apply: applyKick, label: '👢 اخراج' },
    warn: { minLevel: LEVEL.ADMIN, apply: applyWarn, label: '⚠️ اخطار' },
    unwarn: { minLevel: LEVEL.ADMIN, apply: applyUnwarn, label: '➖ حذف اخطار' },
    clearwarn: { minLevel: LEVEL.ADMIN, apply: applyClearWarn, label: '🧹 پاک کردن اخطارها' },
    vip: { minLevel: LEVEL.GOWNER, duration: true, apply: applyVip, label: '⭐ ویژه' },
    unvip: { minLevel: LEVEL.GOWNER, apply: applyUnvip, label: '➖ حذف ویژه' },
    exempt: { minLevel: LEVEL.ADMIN, apply: applyExempt, label: '🎗️ معاف' },
    unexempt: { minLevel: LEVEL.ADMIN, apply: applyUnexempt, label: '➖ حذف معافیت' },
    admin: { minLevel: LEVEL.GOWNER, apply: applyAdmin, label: '🛡️ ادمین ربات' },
    unadmin: { minLevel: LEVEL.GOWNER, apply: applyUnadmin, label: '➖ حذف ادمین' },
    owner: { minLevel: LEVEL.OWNER, apply: applyOwner, label: '👑 مالک' },
    unowner: { minLevel: LEVEL.OWNER, apply: applyUnowner, label: '➖ حذف مالک' },
    promote: { minLevel: LEVEL.GOWNER, apply: applyPromote, label: '🎖️ ترفیع مدیر' },
    demote: { minLevel: LEVEL.GOWNER, apply: applyDemote, label: '➖ عزل مدیر' }
  };

  async function dispatch(ctx, canonical, argsText) {
    if (!ctx.chat || (ctx.chat.type !== 'group' && ctx.chat.type !== 'supergroup')) return ctx.reply('⚠️ این دستور فقط داخل گروه کار می‌کند.');
    const action = ACTIONS[canonical];
    const group = getGroup(ctx.chat.id);
    const actorLevel = getRole(group, ctx.from.id, botOwnerId);
    if (actorLevel < action.minLevel) return ctx.reply('⛔ شما دسترسی لازم برای این دستور را ندارید.');

    const target = extractTarget(ctx, argsText);
    if (!target) return ctx.reply('❓ کاربر مورد نظر را ریپلای کنید یا @یوزرنیم / آیدی عددی وارد کنید.');
    if (target.notFound || !target.id) return ctx.reply('❌ این کاربر در دیتابیس ربات پیدا نشد (باید قبلاً در گروه پیام داده باشد).');
    if (target.id === ctx.from.id) return ctx.reply('🙅 نمی‌توانید این عملیات را روی خودتان انجام دهید.');

    const targetLevel = getRole(group, target.id, botOwnerId);
    if (!canAct(actorLevel, targetLevel)) return ctx.reply('⛔ این کاربر نقش بالاتر یا مساوی شما دارد.');

    let duration = null;
    if (action.duration) {
      duration = parseDuration(target.restText);
      if (target.restText && !duration) return ctx.reply('⏱️ فرمت زمان نامعتبر است. مثال: 30s, 10m, 1h, 2d, 1w, permanent');
      if (!duration) duration = { permanent: true };
    }
    try {
      const resultText = await action.apply(ctx, group, target, duration);
      saveGroup(ctx.chat.id, group);
      addLog(ctx.chat.id, { type: canonical, by: ctx.from.id, target: target.id });
      await ctx.reply(resultText || `${action.label} برای ${target.name} انجام شد.`, { parse_mode: 'HTML' });
    } catch (e) {
      await ctx.reply('❌ خطا در اجرای عملیات: ' + e.message);
    }
  }
  for (const c of Object.keys(ACTIONS)) bot.command(c, (ctx) => dispatch(ctx, c, ctx.message.text.split(/\s+/).slice(1).join(' ')));
  for (const [phrase, canonical] of ACTION_PERSIAN_TRIGGERS) addTrigger(phrase, (ctx, args) => dispatch(ctx, canonical, args));

  async function applyMute(ctx, group, target, duration) {
    const until = duration.permanent ? 0 : timeNow() + Math.floor(duration.ms / 1000);
    await ctx.telegram.restrictChatMember(ctx.chat.id, target.id, { permissions: MUTE_PERMS, until_date: until });
    group.mutes[target.id] = { until, permanent: duration.permanent };
    return `🔇 ${mention(target.name, target.id)} به مدت ${duration.permanent ? 'دائمی ♾️' : formatDuration(duration.ms) + ' ⏱️'} سکوت شد.`;
  }
  async function applyUnmute(ctx, group, target) {
    await ctx.telegram.restrictChatMember(ctx.chat.id, target.id, { permissions: FULL_PERMS });
    delete group.mutes[target.id];
    return `🔊 سکوت ${mention(target.name, target.id)} برداشته شد.`;
  }
  async function applyBan(ctx, group, target, duration) {
    const until = duration.permanent ? 0 : timeNow() + Math.floor(duration.ms / 1000);
    await ctx.telegram.banChatMember(ctx.chat.id, target.id, until || undefined);
    group.bans[target.id] = { until, permanent: duration.permanent };
    return `⛔ ${mention(target.name, target.id)} به مدت ${duration.permanent ? 'دائمی ♾️' : formatDuration(duration.ms) + ' ⏱️'} بن شد.`;
  }
  async function applyUnban(ctx, group, target) {
    await ctx.telegram.unbanChatMember(ctx.chat.id, target.id, { only_if_banned: true });
    delete group.bans[target.id];
    return `✅ بن ${mention(target.name, target.id)} برداشته شد.`;
  }
  async function applyKick(ctx, group, target) {
    await ctx.telegram.banChatMember(ctx.chat.id, target.id);
    await ctx.telegram.unbanChatMember(ctx.chat.id, target.id, { only_if_banned: true });
    return `👢 ${mention(target.name, target.id)} از گروه اخراج شد.`;
  }
  async function applyWarn(ctx, group, target) {
    const limit = group.settings.warnLimit || 3;
    const action = group.settings.warnAction || 'ban';
    group.warns[target.id] = (group.warns[target.id] || 0) + 1;
    const count = group.warns[target.id];
    if (count >= limit) {
      if (action === 'ban') { await ctx.telegram.banChatMember(ctx.chat.id, target.id); group.bans[target.id] = { until: 0, permanent: true }; }
      else if (action === 'mute') { await ctx.telegram.restrictChatMember(ctx.chat.id, target.id, { permissions: MUTE_PERMS, until_date: 0 }); group.mutes[target.id] = { until: 0, permanent: true }; }
      else if (action === 'kick') { await ctx.telegram.banChatMember(ctx.chat.id, target.id); await ctx.telegram.unbanChatMember(ctx.chat.id, target.id, { only_if_banned: true }); }
      group.warns[target.id] = 0;
      return `⚠️➡️ ${mention(target.name, target.id)} به دلیل رسیدن به ${limit} اخطار، ${WARN_LABELS[action]} شد.`;
    }
    return `⚠️ ${mention(target.name, target.id)} اخطار گرفت (${count}/${limit}).`;
  }
  async function applyUnwarn(ctx, group, target) {
    const limit = group.settings.warnLimit || 3;
    group.warns[target.id] = Math.max(0, (group.warns[target.id] || 0) - 1);
    return `➖⚠️ یک اخطار از ${mention(target.name, target.id)} حذف شد (${group.warns[target.id]}/${limit}).`;
  }
  async function applyClearWarn(ctx, group, target) { group.warns[target.id] = 0; return `🧹 تمام اخطارهای ${mention(target.name, target.id)} پاک شد.`; }
  async function applyVip(ctx, group, target, duration) {
    const until = duration.permanent ? null : Date.now() + duration.ms;
    group.vips[target.id] = { until };
    return `⭐ ${mention(target.name, target.id)} ویژه شد${until ? ' برای ' + formatDuration(duration.ms) + ' ⏱️' : ' (دائمی ♾️)'}.`;
  }
  async function applyUnvip(ctx, group, target) { delete group.vips[target.id]; return `➖⭐ عضویت ویژه ${mention(target.name, target.id)} حذف شد.`; }
  async function applyExempt(ctx, group, target) { if (!group.exempts.includes(target.id)) group.exempts.push(target.id); return `🎗️ ${mention(target.name, target.id)} از قفل‌ها معاف شد.`; }
  async function applyUnexempt(ctx, group, target) { group.exempts = group.exempts.filter((id) => id !== target.id); return `➖🎗️ معافیت ${mention(target.name, target.id)} حذف شد.`; }
  async function applyAdmin(ctx, group, target) { if (!group.admins.includes(target.id)) group.admins.push(target.id); return `🛡️ ${mention(target.name, target.id)} ادمین ربات شد.`; }
  async function applyUnadmin(ctx, group, target) { group.admins = group.admins.filter((id) => id !== target.id); return `➖🛡️ دسترسی ادمین ${mention(target.name, target.id)} حذف شد.`; }
  async function applyOwner(ctx, group, target) { if (!group.owners.includes(target.id)) group.owners.push(target.id); return `👑 ${mention(target.name, target.id)} مالک گروه شد.`; }
  async function applyUnowner(ctx, group, target) { group.owners = group.owners.filter((id) => id !== target.id); return `➖👑 مالکیت ${mention(target.name, target.id)} حذف شد.`; }
  async function applyPromote(ctx, group, target) {
    await ctx.telegram.promoteChatMember(ctx.chat.id, target.id, { can_delete_messages: true, can_restrict_members: true, can_invite_users: true, can_pin_messages: true, can_manage_chat: true, can_change_info: false, can_promote_members: false });
    if (!group.managers.includes(target.id)) group.managers.push(target.id);
    return `🎖️ ${mention(target.name, target.id)} به مدیریت (ادمین تلگرام) ترفیع یافت.`;
  }
  async function applyDemote(ctx, group, target) {
    await ctx.telegram.promoteChatMember(ctx.chat.id, target.id, { can_delete_messages: false, can_restrict_members: false, can_invite_users: false, can_pin_messages: false, can_manage_chat: false, can_change_info: false, can_promote_members: false });
    group.managers = group.managers.filter((id) => id !== target.id);
    return `➖🎖️ ${mention(target.name, target.id)} از مدیریت عزل شد.`;
  }

  /* ---------- info: user / ustats / roles / history ---------- */
  async function fnUserInfo(ctx, argsText, forceCmd) {
    const group = getGroup(ctx.chat.id);
    const target = extractTarget(ctx, argsText) || { id: ctx.from.id, name: ctx.from.first_name || ctx.from.username, restText: '' };
    if (!target.id) return ctx.reply('❓ کاربر پیدا نشد.');
    const level = getRole(group, target.id, botOwnerId);
    const cmd = forceCmd || (ctx.message.text.split(/\s+/)[0] || '').replace('/', '');
    if (cmd === 'history' || cmd === 'تاریخچه') {
      const logs = group.logs.filter((l) => l.target === target.id).slice(0, 10);
      const text = logs.length ? logs.map((l) => `• ${l.type} — ${new Date(l.date).toLocaleString('fa-IR')}`).join('\n') : '📭 تاریخچه‌ای یافت نشد.';
      return ctx.reply(`🕘 <b>تاریخچه ${esc(target.name)}</b>\n\n${text}`, { parse_mode: 'HTML' });
    }
    const msgCount = (group.stats.today && group.stats.today[target.id]) || 0;
    const warns = group.warns[target.id] || 0;
    const muted = !!group.mutes[target.id];
    const banned = !!group.bans[target.id];
    const nick = group.nicknames[target.id];
    await ctx.replyWithHTML(
      `👤 <b>پنل کاربر</b> ${mention(target.name, target.id)}\n\n` +
      `🎭 نقش: ${roleLabel(level)}\n💬 پیام امروز: ${msgCount}\n⚠️ اخطار: ${warns}/${group.settings.warnLimit || 3}\n` +
      `📌 وضعیت: ${banned ? '⛔ بن' : muted ? '🔇 سکوت' : '✅ عادی'}` + (nick ? `\n🏷️ لقب: ${esc(nick)}` : '')
    );
  }
  bot.command(['user', 'ustats', 'roles', 'history'], (ctx) => fnUserInfo(ctx, ctx.message.text.split(/\s+/).slice(1).join(' ')));
  addTrigger('پنل کاربر', (ctx, a) => fnUserInfo(ctx, a, 'user'));
  addTrigger('آمار کاربر', (ctx, a) => fnUserInfo(ctx, a, 'ustats'));
  addTrigger('نقش‌ها', (ctx, a) => fnUserInfo(ctx, a, 'roles'));
  addTrigger('تاریخچه', (ctx, a) => fnUserInfo(ctx, a, 'history'));

  /* ---------- id ---------- */
  async function fnId(ctx) {
    const reply = ctx.message.reply_to_message;
    let text = `🆔 آیدی شما: <code>${ctx.from.id}</code>\n🆔 آیدی گروه: <code>${ctx.chat.id}</code>`;
    if (reply && reply.from) text += `\n🆔 آیدی کاربر ریپلای‌شده: <code>${reply.from.id}</code>`;
    await ctx.reply(text, { parse_mode: 'HTML' });
  }
  bot.command('id', fnId);
  addTrigger('آیدی', fnId);

  /* ---------- set real owner (auto-detect telegram creator) ---------- */
  async function fnSetRealOwner(ctx) {
    const group = getGroup(ctx.chat.id);
    const actorLevel = getRole(group, ctx.from.id, botOwnerId);
    if (actorLevel < LEVEL.ADMIN) return ctx.reply('⛔ دسترسی لازم را ندارید.');
    try {
      const admins = await ctx.telegram.getChatAdministrators(ctx.chat.id);
      const creator = admins.find((a) => a.status === 'creator');
      if (!creator) return ctx.reply('❌ مالک واقعی گروه پیدا نشد.');
      upsertUser(creator.user.id, { username: creator.user.username || null, firstName: creator.user.first_name });
      if (!group.owners.includes(creator.user.id)) group.owners.push(creator.user.id);
      saveGroup(ctx.chat.id, group);
      await ctx.replyWithHTML(`👑 ${mention(creator.user.first_name, creator.user.id)} به‌عنوان مالک واقعی گروه ثبت شد.`);
    } catch (e) { await ctx.reply('❌ خطا: ' + e.message); }
  }
  bot.command('setrealowner', fnSetRealOwner);
  addTrigger('تنظیم مالک', fnSetRealOwner);

  /* ---------- settings / setwarn ---------- */
  async function fnSettings(ctx) {
    const group = getGroup(ctx.chat.id);
    const text =
      `⚙️ <b>تنظیمات گروه</b>\n\n` +
      `🌐 زبان: ${group.settings.language === 'en' ? 'English' : 'فارسی'}\n` +
      `🛡️ ادمین‌ها: ${group.admins.length}\n👑 مالکان: ${group.owners.length}\n⭐ ویژه‌ها: ${Object.keys(group.vips).length}\n` +
      `⚠️ آستانه اخطار: ${group.settings.warnLimit || 3}\n🚨 مجازات اخطار: ${WARN_LABELS[group.settings.warnAction || 'ban']}\n\n` +
      `📝 برای تغییر آستانه: <code>/setwarn 5 mute</code> یا «تنظیم اخطار 5 mute»`;
    await ctx.reply(text, { parse_mode: 'HTML' });
  }
  bot.command('settings', fnSettings);
  addTrigger('تنظیمات', fnSettings);

  async function fnSetWarn(ctx, argsText) {
    const group = getGroup(ctx.chat.id);
    const actorLevel = getRole(group, ctx.from.id, botOwnerId);
    if (actorLevel < LEVEL.GOWNER) return ctx.reply('⛔ فقط مالک گروه می‌تواند این تنظیم را تغییر دهد.');
    const parts = argsText.trim().split(/\s+/);
    const count = parseInt(parts[0], 10);
    const action = (parts[1] || '').toLowerCase();
    if (!count || count < 1 || !['ban', 'mute', 'kick'].includes(action)) return ctx.reply('📝 فرمت درست: /setwarn <تعداد> <ban|mute|kick>  مثال: /setwarn 5 mute');
    group.settings.warnLimit = count; group.settings.warnAction = action;
    saveGroup(ctx.chat.id, group);
    await ctx.reply(`✅ تنظیم شد: بعد از ${count} اخطار → ${WARN_LABELS[action]}`);
  }
  bot.command('setwarn', (ctx) => fnSetWarn(ctx, ctx.message.text.split(/\s+/).slice(1).join(' ')));
  addTrigger('تنظیم اخطار', fnSetWarn);

  /* ---------- locks menu / stats / today / logs ---------- */
  bot.command(['locks', 'security'], async (ctx) => { const group = getGroup(ctx.chat.id); await ctx.reply('🔒 <b>قفل‌ها</b>\nیک دسته رو انتخاب کن:', { parse_mode: 'HTML', ...locksMainKeyboard() }); });
  addTrigger('قفل‌ها', async (ctx) => ctx.reply('🔒 <b>قفل‌ها</b>\nیک دسته رو انتخاب کن:', { parse_mode: 'HTML', ...locksMainKeyboard() }));
  addTrigger('امنیت', async (ctx) => ctx.reply('🔒 <b>قفل‌ها</b>\nیک دسته رو انتخاب کن:', { parse_mode: 'HTML', ...locksMainKeyboard() }));

  async function fnStats(ctx) {
    const group = getGroup(ctx.chat.id);
    await ctx.reply(`📊 <b>آمار گروه</b>\n\n💬 کل پیام‌ها: ${group.stats.messages}\n🛡️ ادمین‌ها: ${group.admins.length}\n👑 مالکان: ${group.owners.length}\n⭐ ویژه‌ها: ${Object.keys(group.vips).length}`, { parse_mode: 'HTML' });
  }
  bot.command('stats', fnStats); addTrigger('آمار', fnStats);

  async function fnToday(ctx) { await ctx.reply(await buildTodayText(ctx.chat.id), { parse_mode: 'HTML' }); }
  bot.command('today', fnToday); addTrigger('آمار امروز', fnToday);

  async function fnLogs(ctx) { await ctx.reply(buildLogsText(ctx.chat.id), { parse_mode: 'HTML' }); }
  bot.command('logs', fnLogs); addTrigger('گزارشات', fnLogs);

  /* ---------- member-button lists ---------- */
  const LIST_COMMANDS = [
    ['admins', 'مدیران'], ['owners', 'مالکان'], ['vips', 'ویژه‌ها'], ['exempts', 'معاف‌ها'],
    ['mutes', 'لیست سکوت'], ['bans', 'لیست بن']
  ];
  for (const [field, faLabel] of LIST_COMMANDS) {
    const slashName = { admins: 'admins', owners: 'owners', vips: 'vips', exempts: 'exempts', mutes: 'mutelist', bans: 'banlist' }[field];
    bot.command(slashName, (ctx) => sendMemberList(ctx, field));
    addTrigger(faLabel, (ctx) => sendMemberList(ctx, field));
  }
  async function fnWarnlist(ctx) {
    const group = getGroup(ctx.chat.id);
    const entries = Object.entries(group.warns).filter(([, c]) => c > 0);
    if (!entries.length) return ctx.reply('📭 کاربری با اخطار وجود ندارد.');
    const lines = entries.map(([id, c]) => { const u = getUser(id); return `⚠️ ${u ? u.firstName : id}: ${c}/${group.settings.warnLimit || 3}`; });
    await ctx.reply(lines.join('\n'));
  }
  bot.command('warnlist', fnWarnlist); addTrigger('لیست اخطار', fnWarnlist);

  /* ---------- backup / restore ---------- */
  async function fnBackup(ctx) {
    const group = getGroup(ctx.chat.id);
    const buffer = Buffer.from(JSON.stringify(group, null, 2), 'utf8');
    await ctx.replyWithDocument({ source: buffer, filename: `backup-${ctx.chat.id}.json` });
  }
  bot.command('backup', fnBackup); addTrigger('بکاپ', fnBackup);

  async function fnRestore(ctx) {
    const reply = ctx.message.reply_to_message;
    if (!reply || !reply.document) return ctx.reply('📎 برای بازیابی، روی فایل بکاپ ریپلای کنید.');
    try {
      const link = await ctx.telegram.getFileLink(reply.document.file_id);
      const res = await fetch(link.href);
      const data = await res.json();
      saveGroup(ctx.chat.id, data);
      await ctx.reply('✅ بازیابی با موفقیت انجام شد.');
    } catch (e) { await ctx.reply('❌ خطا در بازیابی: ' + e.message); }
  }
  bot.command('restore', fnRestore); addTrigger('بازیابی', fnRestore);

  /* ---------- message management ---------- */
  async function fnDel(ctx) {
    const reply = ctx.message.reply_to_message;
    if (!reply) return ctx.reply('↩️ روی پیام مورد نظر ریپلای کنید.');
    try { await ctx.deleteMessage(reply.message_id); await ctx.deleteMessage(ctx.message.message_id); } catch (e) {}
  }
  bot.command('del', fnDel); addTrigger('حذف', fnDel);

  async function fnPin(ctx) {
    const reply = ctx.message.reply_to_message;
    if (!reply) return ctx.reply('↩️ روی پیام مورد نظر ریپلای کنید.');
    await ctx.pinChatMessage(reply.message_id);
    await ctx.reply('📌 پیام پین شد.');
  }
  bot.command('pin', fnPin); addTrigger('پین', fnPin);

  async function fnUnpin(ctx) { await ctx.unpinChatMessage(); await ctx.reply('📌❌ پین برداشته شد.'); }
  bot.command('unpin', fnUnpin); addTrigger('حذف پین', fnUnpin);

  async function fnRules(ctx) { const group = getGroup(ctx.chat.id); await ctx.reply(`📋 ${group.rules || 'قوانینی ثبت نشده است.'}`); }
  bot.command('rules', fnRules); addTrigger('قوانین', fnRules);

  async function fnSetRules(ctx, argsText) {
    const group = getGroup(ctx.chat.id);
    group.rules = argsText; saveGroup(ctx.chat.id, group);
    await ctx.reply('✅ قوانین به‌روزرسانی شد.');
  }
  bot.command('setrules', (ctx) => fnSetRules(ctx, ctx.message.text.split(/\s+/).slice(1).join(' ')));
  addTrigger('تنظیم قوانین', fnSetRules);

  async function fnWelcome(ctx) { const group = getGroup(ctx.chat.id); await ctx.reply(`👋 ${group.welcome}`); }
  bot.command('welcome', fnWelcome); addTrigger('خوش‌آمد', fnWelcome);

  async function fnSetWelcome(ctx, argsText) {
    if (!argsText) return ctx.reply('📝 متن خوش‌آمدگویی را بنویسید. از {name} برای نام کاربر استفاده کنید.');
    const group = getGroup(ctx.chat.id);
    group.welcome = argsText; saveGroup(ctx.chat.id, group);
    await ctx.reply('✅ پیام خوش‌آمدگویی به‌روزرسانی شد.');
  }
  bot.command(['setwelcome', 'editwelcome'], (ctx) => fnSetWelcome(ctx, ctx.message.text.split(/\s+/).slice(1).join(' ')));
  addTrigger('تنظیم خوش‌آمد', fnSetWelcome);
  addTrigger('ویرایش خوش‌آمد', fnSetWelcome);

  /* ---------- nickname ---------- */
  async function fnSetNickname(ctx, argsText) {
    const target = extractTarget(ctx, argsText);
    if (!target || !target.id) return ctx.reply('↩️ روی کاربر ریپلای کن و لقب رو بنویس.');
    const group = getGroup(ctx.chat.id);
    group.nicknames[target.id] = target.restText || '';
    saveGroup(ctx.chat.id, group);
    await ctx.replyWithHTML(`🏷️ لقب ${mention(target.name, target.id)} تنظیم شد: ${esc(target.restText)}`);
  }
  bot.command('setnickname', (ctx) => fnSetNickname(ctx, ctx.message.text.split(/\s+/).slice(1).join(' ')));
  addTrigger('تنظیم لقب', fnSetNickname);

  /* ---------- filters (bad words) ---------- */
  async function fnAddFilter(ctx, argsText) {
    const group = getGroup(ctx.chat.id);
    const actorLevel = getRole(group, ctx.from.id, botOwnerId);
    if (actorLevel < LEVEL.ADMIN) return ctx.reply('⛔ دسترسی لازم را ندارید.');
    const word = argsText.trim();
    if (!word) return ctx.reply('📝 کلمه‌ای که می‌خوای فیلتر کنی رو بنویس.');
    if (!group.filters.includes(word)) group.filters.push(word);
    saveGroup(ctx.chat.id, group);
    await ctx.reply(`🚱 کلمه «${esc(word)}» به فیلتر اضافه شد.`);
  }
  bot.command('addfilter', (ctx) => fnAddFilter(ctx, ctx.message.text.split(/\s+/).slice(1).join(' ')));
  addTrigger('افزودن فیلتر', fnAddFilter);

  async function fnRemoveFilter(ctx, argsText) {
    const group = getGroup(ctx.chat.id);
    const actorLevel = getRole(group, ctx.from.id, botOwnerId);
    if (actorLevel < LEVEL.ADMIN) return ctx.reply('⛔ دسترسی لازم را ندارید.');
    const word = argsText.trim();
    group.filters = group.filters.filter((w) => w !== word);
    saveGroup(ctx.chat.id, group);
    await ctx.reply(`✅ کلمه «${esc(word)}» از فیلتر حذف شد.`);
  }
  bot.command('removefilter', (ctx) => fnRemoveFilter(ctx, ctx.message.text.split(/\s+/).slice(1).join(' ')));
  addTrigger('حذف فیلتر', fnRemoveFilter);

  async function fnFilterList(ctx) {
    const group = getGroup(ctx.chat.id);
    await ctx.reply(group.filters.length ? `🚱 <b>لیست فیلتر</b>\n\n${group.filters.map(esc).join('، ')}` : '📭 لیست فیلتر خالیه.', { parse_mode: 'HTML' });
  }
  bot.command('filterlist', fnFilterList); addTrigger('لیست فیلتر', fnFilterList);

  /* ---------- lock toggle (slash + Persian phrase) ---------- */
  async function applyLockToggle(ctx, type, on) {
    const group = getGroup(ctx.chat.id);
    const actorLevel = getRole(group, ctx.from.id, botOwnerId);
    if (actorLevel < LEVEL.ADMIN) return ctx.reply('⛔ دسترسی لازم را ندارید.');
    group.locks[type] = on;
    saveGroup(ctx.chat.id, group);
    const meta = LOCK_META[type];
    await ctx.reply(`${on ? '🔒' : '🔓'} قفل ${meta.emoji} ${meta.fa} ${on ? 'فعال' : 'غیرفعال'} شد.`);
  }
  bot.command(['lock', 'unlock'], async (ctx) => {
    const [cmd, typeArg] = ctx.message.text.split(/\s+/);
    if (!typeArg || !LOCK_META[typeArg]) return ctx.reply('📝 نوع قفل را مشخص کنید. مثال: /lock links');
    await applyLockToggle(ctx, typeArg, cmd.replace('/', '') === 'lock');
  });
  for (const { phrase, type, on } of LOCK_PHRASE_TRIGGERS) addTrigger(phrase, (ctx) => applyLockToggle(ctx, type, on));

  /* ---------- purge / cleanup (unified fa router) ---------- */
  async function unbanAllTracked(ctx, group) {
    const ids = Object.keys(group.bans);
    for (const id of ids) { try { await ctx.telegram.unbanChatMember(ctx.chat.id, id, { only_if_banned: true }); } catch (e) {} }
    group.bans = {};
    return `✅ ${ids.length} کاربر آزاد و لیست بن پاک شد.`;
  }
  async function unmuteAllTracked(ctx, group) {
    const ids = Object.keys(group.mutes);
    for (const id of ids) { try { await ctx.telegram.restrictChatMember(ctx.chat.id, id, { permissions: FULL_PERMS }); } catch (e) {} }
    group.mutes = {};
    return `🔊 ${ids.length} کاربر رفع سکوت و لیست سکوت پاک شد.`;
  }
  async function banFakeOrDeleted(ctx, group) {
    const ids = knownSenderIds(group);
    let count = 0;
    for (const id of ids.slice(0, 150)) {
      try {
        const member = await ctx.telegram.getChatMember(ctx.chat.id, id);
        if (member.user.first_name === 'Deleted Account') {
          await ctx.telegram.banChatMember(ctx.chat.id, id);
          count++;
        }
      } catch (e) {}
    }
    return `🗑️ ${count} حساب حذف‌شده/فیک (از بین کاربران شناخته‌شده توسط ربات) بن شد.\n\nℹ️ توجه: تلگرام اجازه نمی‌ده ربات‌ها کل لیست اعضای گروه رو بگیرن، پس این عملیات فقط روی کاربرانی اثر داره که ربات قبلاً پیامشون رو دیده.`;
  }
  async function purgeBotsFull(ctx, group) {
    const ids = knownSenderIds(group, { botsOnly: true });
    let count = 0;
    for (const id of ids) {
      try { await ctx.telegram.banChatMember(ctx.chat.id, id); await ctx.telegram.unbanChatMember(ctx.chat.id, id, { only_if_banned: true }); count++; } catch (e) {}
    }
    const toDelete = group.recentMessages.filter((m) => m.isBot);
    for (const m of toDelete) { try { await ctx.telegram.deleteMessage(ctx.chat.id, m.id); } catch (e) {} }
    group.recentMessages = group.recentMessages.filter((m) => !m.isBot);
    return `🤖⛔ ${count} ربات شناخته‌شده حذف و ${toDelete.length} پیامشون پاک شد.`;
  }

  const CLEAR_FA_HANDLERS = {
    'بن': unbanAllTracked, 'مسدود': unbanAllTracked,
    'سکوت': unmuteAllTracked,
    'محدود': async (ctx, group) => { const n = group.exempts.length; group.exempts = []; return `✅ ${n} معافیت پاک شد.`; },
    'ویژه': async (ctx, group) => { const n = Object.keys(group.vips).length; group.vips = {}; return `✅ ${n} کاربر ویژه پاک شد.`; },
    'مدیران': async (ctx, group) => { const n = group.admins.length; group.admins = []; return `✅ ${n} ادمین پاک شد.`; },
    'اخطار': async (ctx, group) => { group.warns = {}; return '✅ لیست اخطارها پاک شد.'; },
    'لقب': async (ctx, group) => { group.nicknames = {}; return '✅ لیست لقب‌ها پاک شد.'; },
    'فیلتر': async (ctx, group) => { group.filters = []; return '✅ لیست فیلتر پاک شد.'; },
    'فیک': banFakeOrDeleted,
    'دلیت': banFakeOrDeleted
  };

  async function fnPaksaziRouter(ctx, argsText) {
    const group = getGroup(ctx.chat.id);
    const actorLevel = getRole(group, ctx.from.id, botOwnerId);
    if (actorLevel < LEVEL.ADMIN) return ctx.reply('⛔ دسترسی لازم را ندارید.');
    const arg = (argsText || '').trim();

    if (arg.startsWith('لیست ')) {
      const key = arg.slice(5).trim();
      const handler = CLEAR_FA_HANDLERS[key];
      if (!handler) return ctx.reply('📝 نوع پاکسازی نامعتبر است.');
      const resultText = await handler(ctx, group);
      saveGroup(ctx.chat.id, group);
      return ctx.reply(resultText);
    }
    if (arg === 'ربات‌ها' || arg === 'ربات ها') {
      const resultText = await purgeBotsFull(ctx, group);
      saveGroup(ctx.chat.id, group);
      return ctx.reply(resultText);
    }
    return fnPurgeEnglish(ctx, arg);
  }
  addTrigger('پاکسازی', fnPaksaziRouter);

  async function fnPurgeEnglish(ctx, arg) {
    const group = getGroup(ctx.chat.id);
    const actorLevel = getRole(group, ctx.from.id, botOwnerId);
    if (actorLevel < LEVEL.ADMIN) return ctx.reply('⛔ دسترسی لازم را ندارید.');
    if (!arg) return ctx.reply('📝 نوع پاکسازی را وارد کنید: عدد، bots، links، forwards، media، muted_messages');
    let toDelete = [];
    if (/^\d+$/.test(arg)) toDelete = group.recentMessages.slice(0, parseInt(arg, 10));
    else if (arg === 'bots') toDelete = group.recentMessages.filter((m) => m.isBot);
    else if (arg === 'muted_messages') toDelete = group.recentMessages.filter((m) => group.mutes[m.from]);
    else if (['links', 'forwards', 'media'].includes(arg)) { const key = arg === 'forwards' ? 'forward' : arg; toDelete = group.recentMessages.filter((m) => m.types.includes(key)); }
    else return ctx.reply('📝 نوع پاکسازی نامعتبر است.');
    let deleted = 0;
    for (const m of toDelete) { try { await ctx.telegram.deleteMessage(ctx.chat.id, m.id); deleted++; } catch (e) {} }
    group.recentMessages = group.recentMessages.filter((m) => !toDelete.includes(m));
    saveGroup(ctx.chat.id, group);
    await ctx.reply(`🧹 ${deleted} پیام حذف شد.`);
  }
  bot.command(['purge', 'cleanup'], (ctx) => fnPurgeEnglish(ctx, ctx.message.text.split(/\s+/)[1]));

  async function fnClearSlash(ctx) {
    const what = ctx.message.text.split(/\s+/)[1];
    const FA = { bans: 'بن', mutes: 'سکوت', warns: 'اخطار', vips: 'ویژه', exempts: 'محدود' };
    if (what in FA) return fnPaksaziRouter(ctx, 'لیست ' + FA[what]);
    const group = getGroup(ctx.chat.id);
    const map = {
      logs: () => (group.logs = []),
      today: () => (group.stats.today = {}),
      stats: () => (group.stats = { messages: 0, today: {}, lastReset: new Date().toISOString().slice(0, 10) }),
      managers: () => (group.managers = []),
      reports: () => {}
    };
    if (!map[what]) return ctx.reply('📝 نوع پاکسازی نامعتبر است.');
    map[what]();
    saveGroup(ctx.chat.id, group);
    await ctx.reply(`✅ ${what} پاک شد.`);
  }
  bot.command('clear', fnClearSlash);

  bot.command('reset', async (ctx) => {
    const what = ctx.message.text.split(/\s+/)[1];
    const group = getGroup(ctx.chat.id);
    const map = {
      locks: () => (group.locks = {}),
      welcome: () => (group.welcome = 'سلام {name} خوش اومدی به گروه! 🌸'),
      rules: () => (group.rules = ''),
      filters: () => (group.filters = []),
      buttons: () => {}, colors: () => {},
      settings: () => (group.settings = { language: 'fa', warnLimit: 3, warnAction: 'ban' })
    };
    if (!map[what]) return ctx.reply('📝 نوع بازنشانی نامعتبر است.');
    map[what]();
    saveGroup(ctx.chat.id, group);
    await ctx.reply(`✅ ${what} بازنشانی شد.`);
  });

  sortTriggers();

  /* ---------- unified Persian text dispatcher ---------- */
  bot.hears(/^[\S\s]+/, async (ctx, next) => {
    const text = ctx.message.text || '';
    if (text.startsWith('/')) return next();
    for (const { phrase, run } of MASTER_TRIGGERS) {
      if (text === phrase || text.startsWith(phrase + ' ')) {
        const argsText = text.slice(phrase.length).trim();
        return run(ctx, argsText);
      }
    }
    return next();
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
  bot.launch().catch((e) => console.error('Bot launch error:', e.message));
  botInstance = bot;
  console.log('Bot starting...');
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
  <h1>🤖 راه‌اندازی ربات مدیریت گروه</h1>
  <p>توکن ربات خود (از BotFather) و آیدی عددی تلگرام خودتان (مالک ربات) را وارد کنید.</p>
  ${error ? `<p class="err">⚠️ ${error}</p>` : ''}
  <form method="POST" action="/setup">
    <label>توکن ربات</label>
    <input name="token" placeholder="123456:ABC-DEF..." required />
    <label>آیدی عددی مالک ربات</label>
    <input name="ownerId" placeholder="123456789" required pattern="\\d+" />
    <button type="submit">🚀 ساخت و راه‌اندازی ربات</button>
  </form>
  </div></body></html>`;
}
function renderStatus() {
  return `<!doctype html><html><head><meta charset="utf-8"><title>وضعیت ربات</title>${PAGE_STYLE}</head>
  <body><div class="card">
  <h1>✅ ربات فعال است</h1>
  <p class="ok">🎉 ربات ${status.botUsername ? '@' + status.botUsername : ''} با موفقیت در حال اجراست.</p>
  <p>حالا ربات را به گروه خود اضافه کنید و به آن دسترسی ادمین بدهید.</p>
  <p>برای مشاهده امکانات داخل گروه دستور <b>/panel</b> را بفرستید.</p>
  <form method="GET" action="/reconfigure"><button type="submit" style="background:#777">🔁 تغییر توکن / مالک</button></form>
  </div></body></html>`;
}
async function tryAutoStart() {
  let cfg = getConfig();
  if (!cfg && process.env.BOT_TOKEN && process.env.OWNER_ID) { cfg = { token: process.env.BOT_TOKEN, ownerId: process.env.OWNER_ID }; saveConfig(cfg); }
  if (!cfg) return;
  try {
    const bot = await startBot(cfg.token, cfg.ownerId);
    const me = await bot.telegram.getMe();
    status = { running: true, error: null, botUsername: me.username };
  } catch (e) { status = { running: false, error: e.message, botUsername: null }; }
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
  } catch (e) { res.send(renderSetupForm('توکن نامعتبر است یا خطایی رخ داد: ' + e.message)); }
});
app.get('/health', (req, res) => res.json({ ok: true, running: status.running }));
app.listen(PORT, async () => { console.log('Server listening on port', PORT); await tryAutoStart(); });
