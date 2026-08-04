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
    welcome: 'Ø³Ù„Ø§Ù… {name} Ø®ÙˆØ´ Ø§ÙˆÙ…Ø¯ÛŒ Ø¨Ù‡ Ú¯Ø±ÙˆÙ‡! ðŸŒ¸',
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
const PERMANENT_WORDS = ['permanent', 'Ø¯Ø§Ø¦Ù…', 'Ø¯Ø§Ø¦Ù…ÛŒ', 'Ù‡Ù…ÛŒØ´Ù‡'];
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
  if (ms == null) return 'Ø¯Ø§Ø¦Ù…ÛŒ';
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
  return { 100: 'ðŸ‘‘ Ù…Ø§Ù„Ú© Ø±Ø¨Ø§Øª', 90: 'ðŸ‘‘ Ù…Ø§Ù„Ú© Ú¯Ø±ÙˆÙ‡', 80: 'ðŸ›¡ï¸ Ø§Ø¯Ù…ÛŒÙ†', 70: 'ðŸŽ–ï¸ Ù…Ø¯ÛŒØ±', 50: 'â­ ÙˆÛŒÚ˜Ù‡', 40: 'ðŸŽ—ï¸ Ù…Ø¹Ø§Ù', 0: 'ðŸ‘¤ Ø¹Ø§Ø¯ÛŒ' }[level] || 'ðŸ‘¤ Ø¹Ø§Ø¯ÛŒ';
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
   LOCKS â€” types, Persian aliases, detection
   ============================================================ */
const LOCK_META = {
  links: { emoji: 'ðŸ”—', fa: 'Ù„ÛŒÙ†Ú©', cat: 'content' },
  hyperlink: { emoji: 'ðŸ”—', fa: 'Ù‡Ø§ÛŒÙ¾Ø±Ù„ÛŒÙ†Ú©', cat: 'content' },
  username: { emoji: 'ðŸ·ï¸', fa: 'ØªÚ¯/ÛŒÙˆØ²Ø±Ù†ÛŒÙ…', cat: 'content' },
  hashtag: { emoji: '#ï¸âƒ£', fa: 'Ù‡Ø´ØªÚ¯', cat: 'content' },
  forward: { emoji: 'â†ªï¸', fa: 'ÙÙˆØ±ÙˆØ§Ø±Ø¯', cat: 'content' },
  text: { emoji: 'ðŸ“', fa: 'Ù…ØªÙ†', cat: 'content' },
  group: { emoji: 'ðŸ”', fa: 'Ù‚ÙÙ„ Ú©Ø§Ù…Ù„ Ú¯Ø±ÙˆÙ‡', cat: 'content' },
  photo: { emoji: 'ðŸ“·', fa: 'Ø¹Ú©Ø³', cat: 'media' },
  video: { emoji: 'ðŸŽ¥', fa: 'ÙÛŒÙ„Ù…', cat: 'media' },
  gif: { emoji: 'ðŸŽžï¸', fa: 'Ú¯ÛŒÙ', cat: 'media' },
  sticker: { emoji: 'ðŸŽ­', fa: 'Ø§Ø³ØªÛŒÚ©Ø±', cat: 'media' },
  animatedsticker: { emoji: 'ðŸŒ€', fa: 'Ø§Ø³ØªÛŒÚ©Ø± Ù…ØªØ­Ø±Ú©', cat: 'media' },
  videonote: { emoji: 'ðŸ¤³', fa: 'ÙÛŒÙ„Ù… Ø³Ù„ÙÛŒ', cat: 'media' },
  voice: { emoji: 'ðŸŽ™ï¸', fa: 'ÙˆÛŒØ³', cat: 'media' },
  audio: { emoji: 'ðŸŽµ', fa: 'Ø¢Ù‡Ù†Ú¯', cat: 'media' },
  file: { emoji: 'ðŸ“', fa: 'ÙØ§ÛŒÙ„', cat: 'media' },
  media: { emoji: 'ðŸ–¼ï¸', fa: 'Ú©Ù„ Ø±Ø³Ø§Ù†Ù‡â€ŒÙ‡Ø§', cat: 'media' },
  editmedia: { emoji: 'âœï¸', fa: 'ÙˆÛŒØ±Ø§ÛŒØ´ Ø±Ø³Ø§Ù†Ù‡', cat: 'media' },
  spam: { emoji: 'ðŸš«', fa: 'Ø§Ø³Ù¾Ù…/ØªØ¨Ù„ÛŒØº', cat: 'behavior' },
  flood: { emoji: 'ðŸŒŠ', fa: 'Ø±Ú¯Ø¨Ø§Ø±/Ù„ÛŒÙ…ÛŒØª Ù¾ÛŒØ§Ù…', cat: 'behavior' },
  bot: { emoji: 'ðŸ¤–', fa: 'Ù¾ÛŒØ§Ù… Ø±Ø¨Ø§Øªâ€ŒÙ‡Ø§', cat: 'behavior' },
  addbot: { emoji: 'âž•ðŸ¤–', fa: 'Ø§Ø¯ Ú©Ø±Ø¯Ù† Ø±Ø¨Ø§Øª', cat: 'behavior' },
  inline: { emoji: 'ðŸ•¹ï¸', fa: 'Ø§ÛŒÙ†Ù„Ø§ÛŒÙ†', cat: 'behavior' },
  commands: { emoji: 'âŒ¨ï¸', fa: 'Ø¯Ø³ØªÙˆØ±Ø§Øª', cat: 'behavior' },
  edit: { emoji: 'âœï¸', fa: 'ÙˆÛŒØ±Ø§ÛŒØ´ Ù¾ÛŒØ§Ù…', cat: 'behavior' },
  service: { emoji: 'ðŸ› ï¸', fa: 'Ø³Ø±ÙˆÛŒØ³ ØªÙ„Ú¯Ø±Ø§Ù…', cat: 'behavior' },
  auth: { emoji: 'ðŸ”°', fa: 'Ø§Ø­Ø±Ø§Ø² Ù‡ÙˆÛŒØª ÙˆØ±ÙˆØ¯ÛŒâ€ŒÙ‡Ø§', cat: 'behavior' },
  strict: { emoji: 'ðŸ›¡ï¸', fa: 'Ø­Ø§Ù„Øª Ø³Ø®ØªÚ¯ÛŒØ±Ø§Ù†Ù‡', cat: 'behavior' },
  emoji: { emoji: 'ðŸ˜€', fa: 'Ø§ÛŒÙ…ÙˆØ¬ÛŒ Ø²ÛŒØ§Ø¯', cat: 'emoji' },
  onlyemoji: { emoji: 'ðŸ˜¶', fa: 'Ø§ÛŒÙ…ÙˆØ¬ÛŒ ØªÙ†Ù‡Ø§', cat: 'emoji' },
  animatedemoji: { emoji: 'âœ¨', fa: 'Ø§ÛŒÙ…ÙˆØ¬ÛŒ Ù…ØªØ­Ø±Ú©', cat: 'emoji' },
  contact: { emoji: 'ðŸ“‡', fa: 'Ù…Ø®Ø§Ø·Ø¨', cat: 'misc' },
  location: { emoji: 'ðŸ“', fa: 'Ù…ÙˆÙ‚Ø¹ÛŒØª Ù…Ú©Ø§Ù†ÛŒ', cat: 'misc' },
  poll: { emoji: 'ðŸ“Š', fa: 'Ù†Ø¸Ø±Ø³Ù†Ø¬ÛŒ', cat: 'misc' },
  game: { emoji: 'ðŸŽ®', fa: 'Ø¨Ø§Ø²ÛŒ', cat: 'misc' },
  persian: { emoji: 'ðŸ”¡', fa: 'Ø²Ø¨Ø§Ù† ÙØ§Ø±Ø³ÛŒ', cat: 'misc' },
  english: { emoji: 'ðŸ”¤', fa: 'Ø²Ø¨Ø§Ù† Ø§Ù†Ú¯Ù„ÛŒØ³ÛŒ', cat: 'misc' }
};
const LOCK_CATEGORIES = {
  content: 'ðŸ“ Ù…Ø­ØªÙˆØ§ Ùˆ Ù„ÛŒÙ†Ú©', media: 'ðŸ–¼ï¸ Ø±Ø³Ø§Ù†Ù‡', behavior: 'ðŸ¤– Ø±ÙØªØ§Ø± Ùˆ Ø§Ù…Ù†ÛŒØª', emoji: 'ðŸ˜€ Ø§ÛŒÙ…ÙˆØ¬ÛŒ', misc: 'ðŸ“Œ Ù…ØªÙØ±Ù‚Ù‡'
};

const PERSIAN_LOCK_ALIASES = [
  ['Ø§Ø¯ Ø±Ø¨Ø§Øª', 'addbot'], ['Ø§Ø³ØªÛŒÚ©Ø± Ù…ØªØ­Ø±Ú©', 'animatedsticker'], ['Ø§ÛŒÙ…ÙˆØ¬ÛŒ Ù…ØªØ­Ø±Ú©', 'animatedemoji'],
  ['Ø§ÛŒÙ…ÙˆØ¬ÛŒ ØªÙ†Ù‡Ø§', 'onlyemoji'], ['ÙÛŒÙ„Ù… Ø³Ù„ÙÛŒ', 'videonote'], ['ÙˆÛŒØ±Ø§ÛŒØ´ Ø±Ø³Ø§Ù†Ù‡', 'editmedia'],
  ['Ø³Ø±ÙˆÛŒØ³ ØªÙ„Ú¯Ø±Ø§Ù…', 'service'], ['Ø§Ø­Ø±Ø§Ø² Ù‡ÙˆÛŒØª', 'auth'], ['Ø³Ø®ØªÚ¯ÛŒØ±Ø§Ù†Ù‡', 'strict'],
  ['Ø§Ø³ØªÛŒÚ©Ø±', 'sticker'], ['Ú¯ÛŒÙ', 'gif'], ['Ø¹Ú©Ø³', 'photo'], ['ÙÛŒÙ„Ù…', 'video'], ['Ø±Ø³Ø§Ù†Ù‡', 'media'],
  ['ÙˆÛŒØ±Ø§ÛŒØ´', 'edit'], ['Ø§ÛŒÙ…ÙˆØ¬ÛŒ', 'emoji'], ['Ø¨Ø§Ø²ÛŒ', 'game'], ['ÙØ§ÛŒÙ„', 'file'], ['Ø¯Ø³ØªÙˆØ±Ø§Øª', 'commands'],
  ['Ù…Ø®Ø§Ø·Ø¨', 'contact'], ['Ù…Ú©Ø§Ù†', 'location'], ['Ù‡Ø´ØªÚ¯', 'hashtag'], ['ÙÙˆØ±ÙˆØ§Ø±Ø¯', 'forward'],
  ['Ú¯Ø±ÙˆÙ‡', 'group'], ['Ù…ØªÙ†', 'text'], ['ÙØ§Ø±Ø³ÛŒ', 'persian'], ['Ø§Ù†Ú¯Ù„ÛŒØ³ÛŒ', 'english'], ['Ø¢Ù‡Ù†Ú¯', 'audio'],
  ['ÙˆÛŒØ³', 'voice'], ['ØªØ¨Ú†ÛŒ', 'spam'], ['Ø±Ú¯Ø¨Ø§Ø±', 'flood'], ['Ù„ÛŒÙ…ÛŒØª', 'flood'],
  ['Ù„ÛŒÙ†Ú©', 'links'], ['Ù‡Ø§ÛŒÙ¾Ø±', 'hyperlink'], ['ØªÚ¯', 'username'], ['Ø§ÛŒÙ†Ù„Ø§ÛŒÙ†', 'inline'], ['Ø±Ø¨Ø§Øª', 'bot']
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

// Build "Ù‚ÙÙ„ X" / "Ø¨Ø§Ø²Ú©Ø±Ø¯Ù† X" / "Ø¨Ø§Ø² Ú©Ø±Ø¯Ù† X" / "Ø­Ø°Ù Ù‚ÙÙ„ X" trigger phrases
const LOCK_PHRASE_TRIGGERS = [];
for (const [word, type] of PERSIAN_LOCK_ALIASES) {
  LOCK_PHRASE_TRIGGERS.push({ phrase: `Ù‚ÙÙ„ ${word}`, type, on: true });
  LOCK_PHRASE_TRIGGERS.push({ phrase: `Ø¨Ø§Ø²Ú©Ø±Ø¯Ù† ${word}`, type, on: false });
  LOCK_PHRASE_TRIGGERS.push({ phrase: `Ø¨Ø§Ø² Ú©Ø±Ø¯Ù† ${word}`, type, on: false });
  LOCK_PHRASE_TRIGGERS.push({ phrase: `Ø­Ø°Ù Ù‚ÙÙ„ ${word}`, type, on: false });
}
LOCK_PHRASE_TRIGGERS.sort((a, b) => b.phrase.length - a.phrase.length);

/* ============================================================
   MASTER TRIGGER TABLE (Persian plain-text commands)
   ============================================================ */
const MASTER_TRIGGERS = [];
function addTrigger(phrase, run) { MASTER_TRIGGERS.push({ phrase, run }); }
function sortTriggers() { MASTER_TRIGGERS.sort((a, b) => b.phrase.length - a.phrase.length); }

/* ============================================================
   PANEL (inline UI) â€” kept small per screen, categorized
   ============================================================ */
function backBtn(target = 'panel:main') { return [Markup.button.callback('â¬…ï¸ Ø¨Ø§Ø²Ú¯Ø´Øª', target)]; }

function mainMenuKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('ðŸ‘¥ Ù…Ø¯ÛŒØ±ÛŒØª Ú©Ø§Ø±Ø¨Ø±Ø§Ù†', 'panel:users'), Markup.button.callback('âš™ï¸ Ù…Ø¯ÛŒØ±ÛŒØª Ú¯Ø±ÙˆÙ‡', 'panel:group')],
    [Markup.button.callback('ðŸ”’ Ù‚ÙÙ„â€ŒÙ‡Ø§', 'panel:locks'), Markup.button.callback('ðŸ§¹ Ù¾Ø§Ú©Ø³Ø§Ø²ÛŒ', 'panel:cleanup')],
    [Markup.button.callback('ðŸ“Š Ø¢Ù…Ø§Ø±', 'panel:stats'), Markup.button.callback('ðŸ“– Ø±Ø§Ù‡Ù†Ù…Ø§', 'panel:guide')]
  ]);
}
const PANEL_TEXTS = {
  main: 'ðŸ§­ <b>Ù¾Ù†Ù„ Ù…Ø¯ÛŒØ±ÛŒØª Ú¯Ø±ÙˆÙ‡</b>\n\nÛŒÙ‡ Ø¨Ø®Ø´ Ø±Ùˆ Ø§Ù†ØªØ®Ø§Ø¨ Ú©Ù† ðŸ‘‡',
  users:
    'ðŸ‘¥ <b>Ù…Ø¯ÛŒØ±ÛŒØª Ú©Ø§Ø±Ø¨Ø±Ø§Ù†</b>\n\n' +
    'ðŸ”‡ Ø³Ú©ÙˆØª / ðŸ”Š Ø±ÙØ¹ Ø³Ú©ÙˆØª\nâ›” Ø¨Ù† / âœ… Ø±ÙØ¹ Ø¨Ù†\nðŸ‘¢ Ø§Ø®Ø±Ø§Ø¬\nâš ï¸ Ø§Ø®Ø·Ø§Ø± / Ø­Ø°Ù Ø§Ø®Ø·Ø§Ø± / Ù¾Ø§Ú© Ø§Ø®Ø·Ø§Ø±\n' +
    'â­ ÙˆÛŒÚ˜Ù‡ / Ø­Ø°Ù ÙˆÛŒÚ˜Ù‡\nðŸŽ—ï¸ Ù…Ø¹Ø§Ù / Ø­Ø°Ù Ù…Ø¹Ø§Ù\nðŸŽ–ï¸ ØªØ±ÙÛŒØ¹ / Ø¹Ø²Ù„ Ù…Ø¯ÛŒØ±\nðŸ›¡ï¸ Ø§Ø¯Ù…ÛŒÙ† / Ø­Ø°Ù Ø§Ø¯Ù…ÛŒÙ†\nðŸ‘‘ Ù…Ø§Ù„Ú© / Ø­Ø°Ù Ù…Ø§Ù„Ú©\n' +
    'ðŸ‘¤ Ù¾Ù†Ù„ Ú©Ø§Ø±Ø¨Ø± / Ù†Ù‚Ø´â€ŒÙ‡Ø§ / ØªØ§Ø±ÛŒØ®Ú†Ù‡\n\n' +
    'ðŸ“Œ Ø¨Ø§ Ø±ÛŒÙ¾Ù„Ø§ÛŒ ÛŒØ§ @ÛŒÙˆØ²Ø±Ù†ÛŒÙ…/Ø¢ÛŒØ¯ÛŒ Ú©Ø§Ø± Ù…ÛŒâ€ŒÚ©Ù†Ù‡ØŒ Ù‡Ù… ÙØ§Ø±Ø³ÛŒ Ù‡Ù… Ø§Ù†Ú¯Ù„ÛŒØ³ÛŒ.\nÙ…Ø«Ø§Ù„: Ø±ÙˆÛŒ Ù¾ÛŒØ§Ù… Ú©Ø³ÛŒ Ø±ÛŒÙ¾Ù„Ø§ÛŒ Ú©Ù† Ùˆ Ø¨Ù†ÙˆÛŒØ³ Â«Ø³Ú©ÙˆØª 1hÂ»',
  group:
    'âš™ï¸ <b>Ù…Ø¯ÛŒØ±ÛŒØª Ú¯Ø±ÙˆÙ‡</b>\n\n' +
    'ðŸ†” Ø¢ÛŒØ¯ÛŒ â€” Ù†Ù…Ø§ÛŒØ´ Ø¢ÛŒØ¯ÛŒ Ø¹Ø¯Ø¯ÛŒ\nðŸ‘‘ ØªÙ†Ø¸ÛŒÙ… Ù…Ø§Ù„Ú© â€” ØªØ´Ø®ÛŒØµ Ø®ÙˆØ¯Ú©Ø§Ø± Ù…Ø§Ù„Ú© ÙˆØ§Ù‚Ø¹ÛŒ Ú¯Ø±ÙˆÙ‡\n' +
    'ðŸ“‹ Ù‚ÙˆØ§Ù†ÛŒÙ† / ØªÙ†Ø¸ÛŒÙ… Ù‚ÙˆØ§Ù†ÛŒÙ†\nðŸ‘‹ Ø®ÙˆØ´â€ŒØ¢Ù…Ø¯ / ØªÙ†Ø¸ÛŒÙ… Ø®ÙˆØ´â€ŒØ¢Ù…Ø¯\n' +
    'ðŸ—‘ï¸ Ø­Ø°Ù Ù¾ÛŒØ§Ù… / ðŸ“Œ Ù¾ÛŒÙ† / Ø­Ø°Ù Ù¾ÛŒÙ†\n' +
    'ðŸ’¾ Ø¨Ú©Ø§Ù¾ / Ø¨Ø§Ø²ÛŒØ§Ø¨ÛŒ\nâš ï¸ ØªÙ†Ø¸ÛŒÙ… Ø§Ø®Ø·Ø§Ø± <ØªØ¹Ø¯Ø§Ø¯> <ban|mute|kick>\n' +
    'ðŸš± Ø§ÙØ²ÙˆØ¯Ù† ÙÛŒÙ„ØªØ± <Ú©Ù„Ù…Ù‡> / Ø­Ø°Ù ÙÛŒÙ„ØªØ± / Ù„ÛŒØ³Øª ÙÛŒÙ„ØªØ±',
  guide:
    'ðŸ“– <b>Ø±Ø§Ù‡Ù†Ù…Ø§ÛŒ Ø³Ø±ÛŒØ¹</b>\n\n' +
    'ðŸ”’ Ø¨Ø±Ø§ÛŒ Ù‚ÙÙ„ Ú©Ø±Ø¯Ù† ÛŒÚ© Ù…ÙˆØ±Ø¯ Ø¨Ù†ÙˆÛŒØ³: Â«Ù‚ÙÙ„ + Ù†Ø§Ù… Ù…ÙˆØ±Ø¯Â»\nÙ…Ø«Ø§Ù„: Â«Ù‚ÙÙ„ Ù„ÛŒÙ†Ú©Â» ÛŒØ§ Â«Ù‚ÙÙ„ Ø¹Ú©Ø³Â»\n' +
    'ðŸ”“ Ø¨Ø±Ø§ÛŒ Ø¨Ø§Ø² Ú©Ø±Ø¯Ù†: Â«Ø¨Ø§Ø²Ú©Ø±Ø¯Ù† + Ù†Ø§Ù… Ù…ÙˆØ±Ø¯Â»\nÙ…Ø«Ø§Ù„: Â«Ø¨Ø§Ø²Ú©Ø±Ø¯Ù† Ù„ÛŒÙ†Ú©Â»\n\n' +
    'ðŸ‘¤ Ù…Ø¯ÛŒØ±ÛŒØª Ú©Ø§Ø±Ø¨Ø±: Ø±ÛŒÙ¾Ù„Ø§ÛŒ Ø±ÙˆÛŒ Ù¾ÛŒØ§Ù… + Ù†ÙˆØ´ØªÙ† Ø¯Ø³ØªÙˆØ±\nÙ…Ø«Ø§Ù„: Ø±ÛŒÙ¾Ù„Ø§ÛŒ + Â«Ø³Ú©ÙˆØª 1hÂ» ÛŒØ§ Â«Ø¨Ù†Â»\n\n' +
    'ðŸ§¹ Ù¾Ø§Ú©Ø³Ø§Ø²ÛŒ: Ø¨Ù†ÙˆÛŒØ³ Â«Ù¾Ø§Ú©Ø³Ø§Ø²ÛŒ Ù„ÛŒØ³Øª Ø¨Ù†Â» ÛŒØ§ Â«Ù¾Ø§Ú©Ø³Ø§Ø²ÛŒ Ø±Ø¨Ø§Øªâ€ŒÙ‡Ø§Â»\n\n' +
    'Ø¨Ø±Ø§ÛŒ Ø¯ÛŒØ¯Ù† Ù„ÛŒØ³Øª Ú©Ø§Ù…Ù„ Ù‚ÙÙ„â€ŒÙ‡Ø§ØŒ Ø§Ø² Ø¯Ú©Ù…Ù‡â€ŒÛŒ ðŸ”’ Ù‚ÙÙ„â€ŒÙ‡Ø§ Ø§Ø³ØªÙØ§Ø¯Ù‡ Ú©Ù†.'
};

function locksMainKeyboard() {
  const rows = Object.entries(LOCK_CATEGORIES).map(([key, label]) => [Markup.button.callback(label, `lockcat:${key}`)]);
  rows.push([Markup.button.callback('ðŸ“– Ø±Ø§Ù‡Ù†Ù…Ø§ÛŒ Ù‚ÙÙ„â€ŒÙ‡Ø§', 'lockguide')]);
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
      return Markup.button.callback(`${on ? 'ðŸ”’' : 'ðŸ”“'} ${meta.emoji} ${meta.fa}`, `lock:${t}`);
    }));
  }
  rows.push(backBtn('panel:locks'));
  return Markup.inlineKeyboard(rows);
}
function lockGuideText() {
  let text = 'ðŸ“– <b>Ø±Ø§Ù‡Ù†Ù…Ø§ÛŒ Ø¯Ø³ØªÙˆØ±ÛŒ Ù‚ÙÙ„â€ŒÙ‡Ø§</b>\n\nØ¨Ø±Ø§ÛŒ Ù‚ÙÙ„: Â«Ù‚ÙÙ„ + Ú©Ù„Ù…Ù‡Â» â€” Ø¨Ø±Ø§ÛŒ Ø¨Ø§Ø² Ú©Ø±Ø¯Ù†: Â«Ø¨Ø§Ø²Ú©Ø±Ø¯Ù† + Ú©Ù„Ù…Ù‡Â»\n\n';
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
    const text = 'ðŸ§¹ <b>Ù¾Ø§Ú©Ø³Ø§Ø²ÛŒ</b>\n\nðŸ“Œ Ø¹Ø¯Ø¯: Â«Ù¾Ø§Ú©Ø³Ø§Ø²ÛŒ 100Â» (Ø­Ø°Ù Û±Û°Û° Ù¾ÛŒØ§Ù… Ø§Ø®ÛŒØ±)\nðŸ¤– Â«Ù¾Ø§Ú©Ø³Ø§Ø²ÛŒ Ø±Ø¨Ø§Øªâ€ŒÙ‡Ø§Â»\n' +
      'ðŸ”— Â«Ù¾Ø§Ú©Ø³Ø§Ø²ÛŒ Ù„ÛŒØ³Øª Ø¨Ù† / Ø³Ú©ÙˆØª / ÙˆÛŒÚ˜Ù‡ / Ù…Ø¹Ø§Ù / Ù…Ø¯ÛŒØ±Ø§Ù† / Ø§Ø®Ø·Ø§Ø± / ÙÛŒÙ„ØªØ± / ÙÛŒÚ© / Ø¯Ù„ÛŒØªÂ»';
    return edit(text, Markup.inlineKeyboard([backBtn()]));
  }
  if (data === 'panel:stats') {
    const group = getGroup(chatId);
    const text = `ðŸ“Š <b>Ø¢Ù…Ø§Ø± Ú¯Ø±ÙˆÙ‡</b>\n\nðŸ’¬ Ú©Ù„ Ù¾ÛŒØ§Ù…â€ŒÙ‡Ø§: ${group.stats.messages}\nðŸ›¡ï¸ Ø§Ø¯Ù…ÛŒÙ†â€ŒÙ‡Ø§: ${group.admins.length}\nðŸ‘‘ Ù…Ø§Ù„Ú©Ø§Ù†: ${group.owners.length}\nâ­ ÙˆÛŒÚ˜Ù‡â€ŒÙ‡Ø§: ${Object.keys(group.vips).length}`;
    return edit(text, Markup.inlineKeyboard([[Markup.button.callback('ðŸ“… Ø¢Ù…Ø§Ø± Ø§Ù…Ø±ÙˆØ²', 'today'), Markup.button.callback('ðŸ“œ Ú¯Ø²Ø§Ø±Ø´Ø§Øª', 'logs')], backBtn()]));
  }
  if (data === 'today') { const t = await buildTodayText(chatId); return edit(t, Markup.inlineKeyboard([backBtn('panel:stats')])); }
  if (data === 'logs') { const t = buildLogsText(chatId); return edit(t, Markup.inlineKeyboard([backBtn('panel:stats')])); }

  if (data === 'panel:locks') return edit('ðŸ”’ <b>Ù‚ÙÙ„â€ŒÙ‡Ø§</b>\nÛŒÚ© Ø¯Ø³ØªÙ‡ Ø±Ùˆ Ø§Ù†ØªØ®Ø§Ø¨ Ú©Ù†:', locksMainKeyboard());
  if (data === 'lockguide') return edit(lockGuideText(), Markup.inlineKeyboard([backBtn('panel:locks')]));
  if (data.startsWith('lockcat:')) {
    const cat = data.split(':')[1];
    const group = getGroup(chatId);
    return edit(`${LOCK_CATEGORIES[cat]}\nØ¨Ø±Ø§ÛŒ ØªØºÛŒÛŒØ± Ù„Ù…Ø³ Ú©Ù†:`, locksCategoryKeyboard(group, cat));
  }
  if (data.startsWith('lock:')) {
    const type = data.split(':')[1];
    const group = getGroup(chatId);
    group.locks[type] = !group.locks[type];
    saveGroup(chatId, group);
    const cat = LOCK_META[type].cat;
    return edit(`${LOCK_CATEGORIES[cat]}\nØ¨Ø±Ø§ÛŒ ØªØºÛŒÛŒØ± Ù„Ù…Ø³ Ú©Ù†:`, locksCategoryKeyboard(group, cat));
  }

  if (data.startsWith('mlist:')) return renderMemberListCallback(ctx, data);
  if (data.startsWith('member:')) return renderMemberCardCallback(ctx, data);
  if (data.startsWith('act:')) return performMemberActionCallback(ctx, data);
  if (data.startsWith('verify:')) return handleVerifyCallback(ctx, data);

  await ctx.answerCbQuery();
}

/* ---- member list UI (buttons instead of raw text dumps) ---- */
const LIST_META = {
  admins: { emoji: 'ðŸ›¡ï¸', title: 'Ø§Ø¯Ù…ÛŒÙ†â€ŒÙ‡Ø§ÛŒ Ø±Ø¨Ø§Øª', removeLabel: 'ðŸ—‘ï¸ Ø­Ø°Ù Ø§Ø¯Ù…ÛŒÙ†', minLevel: LEVEL.GOWNER },
  owners: { emoji: 'ðŸ‘‘', title: 'Ù…Ø§Ù„Ú©Ø§Ù† Ú¯Ø±ÙˆÙ‡', removeLabel: 'ðŸ—‘ï¸ Ø­Ø°Ù Ù…Ø§Ù„Ú©', minLevel: LEVEL.OWNER },
  vips: { emoji: 'â­', title: 'Ú©Ø§Ø±Ø¨Ø±Ø§Ù† ÙˆÛŒÚ˜Ù‡', removeLabel: 'ðŸ—‘ï¸ Ø­Ø°Ù ÙˆÛŒÚ˜Ù‡', minLevel: LEVEL.GOWNER },
  exempts: { emoji: 'ðŸŽ—ï¸', title: 'Ù…Ø¹Ø§Ùâ€ŒØ´Ø¯Ù‡â€ŒÙ‡Ø§', removeLabel: 'ðŸ—‘ï¸ Ø­Ø°Ù Ù…Ø¹Ø§ÙÛŒØª', minLevel: LEVEL.ADMIN },
  mutes: { emoji: 'ðŸ”‡', title: 'Ø³Ú©ÙˆØªâ€ŒØ´Ø¯Ù‡â€ŒÙ‡Ø§', removeLabel: 'ðŸ”Š Ø±ÙØ¹ Ø³Ú©ÙˆØª', minLevel: LEVEL.ADMIN },
  bans: { emoji: 'â›”', title: 'Ø¨Ù†â€ŒØ´Ø¯Ù‡â€ŒÙ‡Ø§', removeLabel: 'âœ… Ø±ÙØ¹ Ø¨Ù†', minLevel: LEVEL.ADMIN }
};
function memberListText(field) { return `${LIST_META[field].emoji} <b>${LIST_META[field].title}</b>`; }
function memberListKeyboard(group, field) {
  const data = group[field];
  const ids = (Array.isArray(data) ? data : Object.keys(data)).slice(0, 20);
  const rows = ids.map((id) => {
    const u = getUser(id);
    return [Markup.button.callback(`${LIST_META[field].emoji} ${u ? u.firstName : id}`, `member:${field}:${id}`)];
  });
  if (!rows.length) rows.push([Markup.button.callback('ðŸ“­ Ù„ÛŒØ³Øª Ø®Ø§Ù„ÛŒÙ‡', 'noop')]);
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
  const text = `${LIST_META[field].emoji} ${mention(name, id)}\nðŸ†” <code>${id}</code>`;
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
  if (actorLevel < LIST_META[field].minLevel) return ctx.answerCbQuery('â›” Ø¯Ø³ØªØ±Ø³ÛŒ Ù†Ø¯Ø§Ø±ÛŒ', { show_alert: true });

  try {
    if (field === 'admins') group.admins = group.admins.filter((x) => x !== id);
    else if (field === 'owners') group.owners = group.owners.filter((x) => x !== id);
    else if (field === 'vips') delete group.vips[id];
    else if (field === 'exempts') group.exempts = group.exempts.filter((x) => x !== id);
    else if (field === 'mutes') { try { await ctx.telegram.restrictChatMember(chatId, id, { permissions: FULL_PERMS }); } catch (e) {} delete group.mutes[id]; }
    else if (field === 'bans') { try { await ctx.telegram.unbanChatMember(chatId, id, { only_if_banned: true }); } catch (e) {} delete group.bans[id]; }
    saveGroup(chatId, group);
    await ctx.answerCbQuery('âœ… Ø§Ù†Ø¬Ø§Ù… Ø´Ø¯');
    await ctx.editMessageText(memberListText(field), { parse_mode: 'HTML', ...memberListKeyboard(group, field) });
  } catch (e) {
    await ctx.answerCbQuery('Ø®Ø·Ø§: ' + e.message, { show_alert: true });
  }
}
async function handleVerifyCallback(ctx, data) {
  const uid = Number(data.split(':')[1]);
  if (ctx.from.id !== uid) return ctx.answerCbQuery('âŒ Ø§ÛŒÙ† Ø¯Ú©Ù…Ù‡ Ø¨Ø±Ø§ÛŒ Ø´Ù…Ø§ Ù†ÛŒØ³Øª', { show_alert: true });
  try { await ctx.telegram.restrictChatMember(ctx.chat.id, uid, { permissions: FULL_PERMS }); } catch (e) {}
  await ctx.editMessageText('âœ… Ù‡ÙˆÛŒØª ØªØ§ÛŒÛŒØ¯ Ø´Ø¯ØŒ Ø®ÙˆØ´ Ø§ÙˆÙ…Ø¯ÛŒ! ðŸŽ‰');
  await ctx.answerCbQuery('ØªØ§ÛŒÛŒØ¯ Ø´Ø¯ âœ…');
}

async function buildTodayText(chatId) {
  const group = getGroup(chatId);
  const entries = Object.entries(group.stats.today || {}).sort((a, b) => b[1] - a[1]).slice(0, 15);
  if (!entries.length) return 'ðŸ“… Ø§Ù…Ø±ÙˆØ² Ù¾ÛŒØ§Ù…ÛŒ Ø«Ø¨Øª Ù†Ø´Ø¯Ù‡.';
  const lines = entries.map(([id, c], i) => { const u = getUser(id); return `${i + 1}. ${u ? u.firstName : id} â€” ${c} ðŸ’¬`; });
  return `ðŸ“… <b>Ø¢Ù…Ø§Ø± Ø§Ù…Ø±ÙˆØ²</b>\n\n${lines.join('\n')}`;
}
function buildLogsText(chatId) {
  const group = getGroup(chatId);
  if (!group.logs.length) return 'ðŸ“œ Ú¯Ø²Ø§Ø±Ø´ÛŒ Ø«Ø¨Øª Ù†Ø´Ø¯Ù‡.';
  const lines = group.logs.slice(0, 10).map((l) => `â€¢ ${l.type} â€” ${new Date(l.date).toLocaleString('fa-IR')}`);
  return `ðŸ“œ <b>Ø¢Ø®Ø±ÛŒÙ† Ú¯Ø²Ø§Ø±Ø´Ø§Øª</b>\n\n${lines.join('\n')}`;
}

/* ============================================================
   COMMANDS
   ============================================================ */
const ACTION_PERSIAN_TRIGGERS = [
  ['Ø±ÙØ¹ Ø³Ú©ÙˆØª', 'unmute'], ['Ø³Ú©ÙˆØª Ø¯Ø§Ø¦Ù…ÛŒ', 'mute'], ['Ø³Ú©ÙˆØª', 'mute'],
  ['Ø±ÙØ¹ Ø¨Ù†', 'unban'], ['Ø¨Ù† Ø¯Ø§Ø¦Ù…ÛŒ', 'ban'], ['Ø¨Ù†', 'ban'],
  ['Ø§Ø®Ø±Ø§Ø¬', 'kick'], ['Ø­Ø°Ù Ø§Ø®Ø·Ø§Ø±', 'unwarn'], ['Ù¾Ø§Ú© Ø§Ø®Ø·Ø§Ø±', 'clearwarn'], ['Ø§Ø®Ø·Ø§Ø±', 'warn'],
  ['Ø­Ø°Ù ÙˆÛŒÚ˜Ù‡', 'unvip'], ['ÙˆÛŒÚ˜Ù‡', 'vip'], ['Ø­Ø°Ù Ù…Ø¹Ø§Ù', 'unexempt'], ['Ù…Ø¹Ø§Ù', 'exempt'],
  ['ØªØ±ÙÛŒØ¹', 'promote'], ['Ø¹Ø²Ù„', 'demote'], ['Ø­Ø°Ù Ø§Ø¯Ù…ÛŒÙ†', 'unadmin'], ['Ø§Ø¯Ù…ÛŒÙ†', 'admin'],
  ['Ø­Ø°Ù Ù…Ø§Ù„Ú©', 'unowner'], ['Ù…Ø§Ù„Ú©', 'owner']
];

const WARN_LABELS = { ban: 'â›” Ø¨Ù† Ø¯Ø§Ø¦Ù…', mute: 'ðŸ”‡ Ø³Ú©ÙˆØª Ø¯Ø§Ø¦Ù…', kick: 'ðŸ‘¢ Ø§Ø®Ø±Ø§Ø¬' };
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
        await ctx.reply('ðŸŽ‰ Ø±Ø¨Ø§Øª Ø¨Ø§ Ù…ÙˆÙÙ‚ÛŒØª Ø¯Ø± Ú¯Ø±ÙˆÙ‡ Ù†ØµØ¨ Ø´Ø¯!\n\nØ¨Ø±Ø§ÛŒ Ø¯ÛŒØ¯Ù† Ø§Ù…Ú©Ø§Ù†Ø§Øª Ø¯Ú©Ù…Ù‡â€ŒÛŒ Ø²ÛŒØ± Ø±Ùˆ Ø¨Ø²Ù† ðŸ‘‡', { parse_mode: 'HTML', ...mainMenuKeyboard() });
        continue;
      }
      if (member.is_bot) {
        if (group.locks.addbot && actorLevel < LEVEL.ADMIN) {
          try {
            await ctx.telegram.banChatMember(ctx.chat.id, member.id);
            await ctx.telegram.unbanChatMember(ctx.chat.id, member.id, { only_if_banned: true });
            await ctx.reply(`ðŸ¤–â›” Ø±Ø¨Ø§Øª ${esc(member.first_name)} Ø¨Ù‡ Ø¯Ù„ÛŒÙ„ Ù‚ÙÙ„ Â«Ø§Ø¯ Ø±Ø¨Ø§ØªÂ» Ø§Ø®Ø±Ø§Ø¬ Ø´Ø¯.`);
          } catch (e) {}
        } else {
          await ctx.reply(`ðŸ¤– Ø±Ø¨Ø§Øª ${esc(member.first_name)} Ø§Ø¶Ø§ÙÙ‡ Ø´Ø¯.`);
        }
        continue;
      }
      if (group.locks.auth) {
        try {
          await ctx.telegram.restrictChatMember(ctx.chat.id, member.id, { permissions: MUTE_PERMS });
          await ctx.reply(`ðŸ”° ${mention(member.first_name || 'Ú©Ø§Ø±Ø¨Ø±', member.id)} Ø®ÙˆØ´ Ø§ÙˆÙ…Ø¯ÛŒ! Ø¨Ø±Ø§ÛŒ Ø´Ø±ÙˆØ¹ØŒ ØªØ§ÛŒÛŒØ¯ Ú©Ù† Ú©Ù‡ Ø±Ø¨Ø§Øª Ù†ÛŒØ³ØªÛŒ ðŸ‘‡`, {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([[Markup.button.callback('âœ… ØªØ§ÛŒÛŒØ¯ Ù…ÛŒâ€ŒÚ©Ù†Ù… Ø±Ø¨Ø§Øª Ù†ÛŒØ³ØªÙ…', `verify:${member.id}`)]])
          });
        } catch (e) {}
      } else {
        const text = (group.welcome || 'Ø®ÙˆØ´ Ø§ÙˆÙ…Ø¯ÛŒ {name}! ðŸŒ¸').replace('{name}', member.first_name || member.username || '');
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
      await ctx.reply('ðŸ¤– Ø³Ù„Ø§Ù…! Ù…Ù† Ø±Ø¨Ø§Øª Ù…Ø¯ÛŒØ±ÛŒØª Ú¯Ø±ÙˆÙ‡ Ù‡Ø³ØªÙ….\nÙ…Ù†Ùˆ Ø±Ùˆ Ø¨Ù‡ ÛŒÚ© Ú¯Ø±ÙˆÙ‡ Ø§Ø¶Ø§ÙÙ‡ Ú©Ù† Ùˆ Ø§Ø¯Ù…ÛŒÙ†Ù… Ú©Ù† ØªØ§ Ø´Ø±ÙˆØ¹ Ú©Ù†ÛŒÙ… ðŸš€');
    }
  });

  /* ---------- moderation ACTIONS ---------- */
  const ACTIONS = {
    mute: { minLevel: LEVEL.ADMIN, duration: true, apply: applyMute, label: 'ðŸ”‡ Ø³Ú©ÙˆØª' },
    unmute: { minLevel: LEVEL.ADMIN, apply: applyUnmute, label: 'ðŸ”Š Ø±ÙØ¹ Ø³Ú©ÙˆØª' },
    ban: { minLevel: LEVEL.ADMIN, duration: true, apply: applyBan, label: 'â›” Ø¨Ù†' },
    unban: { minLevel: LEVEL.ADMIN, apply: applyUnban, label: 'âœ… Ø±ÙØ¹ Ø¨Ù†' },
    kick: { minLevel: LEVEL.ADMIN, apply: applyKick, label: 'ðŸ‘¢ Ø§Ø®Ø±Ø§Ø¬' },
    warn: { minLevel: LEVEL.ADMIN, apply: applyWarn, label: 'âš ï¸ Ø§Ø®Ø·Ø§Ø±' },
    unwarn: { minLevel: LEVEL.ADMIN, apply: applyUnwarn, label: 'âž– Ø­Ø°Ù Ø§Ø®Ø·Ø§Ø±' },
    clearwarn: { minLevel: LEVEL.ADMIN, apply: applyClearWarn, label: 'ðŸ§¹ Ù¾Ø§Ú© Ú©Ø±Ø¯Ù† Ø§Ø®Ø·Ø§Ø±Ù‡Ø§' },
    vip: { minLevel: LEVEL.GOWNER, duration: true, apply: applyVip, label: 'â­ ÙˆÛŒÚ˜Ù‡' },
    unvip: { minLevel: LEVEL.GOWNER, apply: applyUnvip, label: 'âž– Ø­Ø°Ù ÙˆÛŒÚ˜Ù‡' },
    exempt: { minLevel: LEVEL.ADMIN, apply: applyExempt, label: 'ðŸŽ—ï¸ Ù…Ø¹Ø§Ù' },
    unexempt: { minLevel: LEVEL.ADMIN, apply: applyUnexempt, label: 'âž– Ø­Ø°Ù Ù…Ø¹Ø§ÙÛŒØª' },
    admin: { minLevel: LEVEL.GOWNER, apply: applyAdmin, label: 'ðŸ›¡ï¸ Ø§Ø¯Ù…ÛŒÙ† Ø±Ø¨Ø§Øª' },
    unadmin: { minLevel: LEVEL.GOWNER, apply: applyUnadmin, label: 'âž– Ø­Ø°Ù Ø§Ø¯Ù…ÛŒÙ†' },
    owner: { minLevel: LEVEL.OWNER, apply: applyOwner, label: 'ðŸ‘‘ Ù…Ø§Ù„Ú©' },
    unowner: { minLevel: LEVEL.OWNER, apply: applyUnowner, label: 'âž– Ø­Ø°Ù Ù…Ø§Ù„Ú©' },
    promote: { minLevel: LEVEL.GOWNER, apply: applyPromote, label: 'ðŸŽ–ï¸ ØªØ±ÙÛŒØ¹ Ù…Ø¯ÛŒØ±' },
    demote: { minLevel: LEVEL.GOWNER, apply: applyDemote, label: 'âž– Ø¹Ø²Ù„ Ù…Ø¯ÛŒØ±' }
  };

  async function dispatch(ctx, canonical, argsText) {
    if (!ctx.chat || (ctx.chat.type !== 'group' && ctx.chat.type !== 'supergroup')) return ctx.reply('âš ï¸ Ø§ÛŒÙ† Ø¯Ø³ØªÙˆØ± ÙÙ‚Ø· Ø¯Ø§Ø®Ù„ Ú¯Ø±ÙˆÙ‡ Ú©Ø§Ø± Ù…ÛŒâ€ŒÚ©Ù†Ø¯.');
    const action = ACTIONS[canonical];
    const group = getGroup(ctx.chat.id);
    const actorLevel = getRole(group, ctx.from.id, botOwnerId);
    if (actorLevel < action.minLevel) return ctx.reply('â›” Ø´Ù…Ø§ Ø¯Ø³ØªØ±Ø³ÛŒ Ù„Ø§Ø²Ù… Ø¨Ø±Ø§ÛŒ Ø§ÛŒÙ† Ø¯Ø³ØªÙˆØ± Ø±Ø§ Ù†Ø¯Ø§Ø±ÛŒØ¯.');

    const target = extractTarget(ctx, argsText);
    if (!target) return ctx.reply('â“ Ú©Ø§Ø±Ø¨Ø± Ù…ÙˆØ±Ø¯ Ù†Ø¸Ø± Ø±Ø§ Ø±ÛŒÙ¾Ù„Ø§ÛŒ Ú©Ù†ÛŒØ¯ ÛŒØ§ @ÛŒÙˆØ²Ø±Ù†ÛŒÙ… / Ø¢ÛŒØ¯ÛŒ Ø¹Ø¯Ø¯ÛŒ ÙˆØ§Ø±Ø¯ Ú©Ù†ÛŒØ¯.');
    if (target.notFound || !target.id) return ctx.reply('âŒ Ø§ÛŒÙ† Ú©Ø§Ø±Ø¨Ø± Ø¯Ø± Ø¯ÛŒØªØ§Ø¨ÛŒØ³ Ø±Ø¨Ø§Øª Ù¾ÛŒØ¯Ø§ Ù†Ø´Ø¯ (Ø¨Ø§ÛŒØ¯ Ù‚Ø¨Ù„Ø§Ù‹ Ø¯Ø± Ú¯Ø±ÙˆÙ‡ Ù¾ÛŒØ§Ù… Ø¯Ø§Ø¯Ù‡ Ø¨Ø§Ø´Ø¯).');
    if (target.id === ctx.from.id) return ctx.reply('ðŸ™… Ù†Ù…ÛŒâ€ŒØªÙˆØ§Ù†ÛŒØ¯ Ø§ÛŒÙ† Ø¹Ù…Ù„ÛŒØ§Øª Ø±Ø§ Ø±ÙˆÛŒ Ø®ÙˆØ¯ØªØ§Ù† Ø§Ù†Ø¬Ø§Ù… Ø¯Ù‡ÛŒØ¯.');

    const targetLevel = getRole(group, target.id, botOwnerId);
    if (!canAct(actorLevel, targetLevel)) return ctx.reply('â›” Ø§ÛŒÙ† Ú©Ø§Ø±Ø¨Ø± Ù†Ù‚Ø´ Ø¨Ø§Ù„Ø§ØªØ± ÛŒØ§ Ù…Ø³Ø§ÙˆÛŒ Ø´Ù…Ø§ Ø¯Ø§Ø±Ø¯.');

    let duration = null;
    if (action.duration) {
      duration = parseDuration(target.restText);
      if (target.restText && !duration) return ctx.reply('â±ï¸ ÙØ±Ù…Øª Ø²Ù…Ø§Ù† Ù†Ø§Ù…Ø¹ØªØ¨Ø± Ø§Ø³Øª. Ù…Ø«Ø§Ù„: 30s, 10m, 1h, 2d, 1w, permanent');
      if (!duration) duration = { permanent: true };
    }
    try {
      const resultText = await action.apply(ctx, group, target, duration);
      saveGroup(ctx.chat.id, group);
      addLog(ctx.chat.id, { type: canonical, by: ctx.from.id, target: target.id });
      await ctx.reply(resultText || `${action.label} Ø¨Ø±Ø§ÛŒ ${target.name} Ø§Ù†Ø¬Ø§Ù… Ø´Ø¯.`, { parse_mode: 'HTML' });
    } catch (e) {
      await ctx.reply('âŒ Ø®Ø·Ø§ Ø¯Ø± Ø§Ø¬Ø±Ø§ÛŒ Ø¹Ù…Ù„ÛŒØ§Øª: ' + e.message);
    }
  }
  for (const c of Object.keys(ACTIONS)) bot.command(c, (ctx) => dispatch(ctx, c, ctx.message.text.split(/\s+/).slice(1).join(' ')));
  for (const [phrase, canonical] of ACTION_PERSIAN_TRIGGERS) addTrigger(phrase, (ctx, args) => dispatch(ctx, canonical, args));

  async function applyMute(ctx, group, target, duration) {
    const until = duration.permanent ? 0 : timeNow() + Math.floor(duration.ms / 1000);
    await ctx.telegram.restrictChatMember(ctx.chat.id, target.id, { permissions: MUTE_PERMS, until_date: until });
    group.mutes[target.id] = { until, permanent: duration.permanent };
    return `ðŸ”‡ ${mention(target.name, target.id)} Ø¨Ù‡ Ù…Ø¯Øª ${duration.permanent ? 'Ø¯Ø§Ø¦Ù…ÛŒ â™¾ï¸' : formatDuration(duration.ms) + ' â±ï¸'} Ø³Ú©ÙˆØª Ø´Ø¯.`;
  }
  async function applyUnmute(ctx, group, target) {
    await ctx.telegram.restrictChatMember(ctx.chat.id, target.id, { permissions: FULL_PERMS });
    delete group.mutes[target.id];
    return `ðŸ”Š Ø³Ú©ÙˆØª ${mention(target.name, target.id)} Ø¨Ø±Ø¯Ø§Ø´ØªÙ‡ Ø´Ø¯.`;
  }
  async function applyBan(ctx, group, target, duration) {
    const until = duration.permanent ? 0 : timeNow() + Math.floor(duration.ms / 1000);
    await ctx.telegram.banChatMember(ctx.chat.id, target.id, until || undefined);
    group.bans[target.id] = { until, permanent: duration.permanent };
    return `â›” ${mention(target.name, target.id)} Ø¨Ù‡ Ù…Ø¯Øª ${duration.permanent ? 'Ø¯Ø§Ø¦Ù…ÛŒ â™¾ï¸' : formatDuration(duration.ms) + ' â±ï¸'} Ø¨Ù† Ø´Ø¯.`;
  }
  async function applyUnban(ctx, group, target) {
    await ctx.telegram.unbanChatMember(ctx.chat.id, target.id, { only_if_banned: true });
    delete group.bans[target.id];
    return `âœ… Ø¨Ù† ${mention(target.name, target.id)} Ø¨Ø±Ø¯Ø§Ø´ØªÙ‡ Ø´Ø¯.`;
  }
  async function applyKick(ctx, group, target) {
    await ctx.telegram.banChatMember(ctx.chat.id, target.id);
    await ctx.telegram.unbanChatMember(ctx.chat.id, target.id, { only_if_banned: true });
    return `ðŸ‘¢ ${mention(target.name, target.id)} Ø§Ø² Ú¯Ø±ÙˆÙ‡ Ø§Ø®Ø±Ø§Ø¬ Ø´Ø¯.`;
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
      return `âš ï¸âž¡ï¸ ${mention(target.name, target.id)} Ø¨Ù‡ Ø¯Ù„ÛŒÙ„ Ø±Ø³ÛŒØ¯Ù† Ø¨Ù‡ ${limit} Ø§Ø®Ø·Ø§Ø±ØŒ ${WARN_LABELS[action]} Ø´Ø¯.`;
    }
    return `âš ï¸ ${mention(target.name, target.id)} Ø§Ø®Ø·Ø§Ø± Ú¯Ø±ÙØª (${count}/${limit}).`;
  }
  async function applyUnwarn(ctx, group, target) {
    const limit = group.settings.warnLimit || 3;
    group.warns[target.id] = Math.max(0, (group.warns[target.id] || 0) - 1);
    return `âž–âš ï¸ ÛŒÚ© Ø§Ø®Ø·Ø§Ø± Ø§Ø² ${mention(target.name, target.id)} Ø­Ø°Ù Ø´Ø¯ (${group.warns[target.id]}/${limit}).`;
  }
  async function applyClearWarn(ctx, group, target) { group.warns[target.id] = 0; return `ðŸ§¹ ØªÙ…Ø§Ù… Ø§Ø®Ø·Ø§Ø±Ù‡Ø§ÛŒ ${mention(target.name, target.id)} Ù¾Ø§Ú© Ø´Ø¯.`; }
  async function applyVip(ctx, group, target, duration) {
    const until = duration.permanent ? null : Date.now() + duration.ms;
    group.vips[target.id] = { until };
    return `â­ ${mention(target.name, target.id)} ÙˆÛŒÚ˜Ù‡ Ø´Ø¯${until ? ' Ø¨Ø±Ø§ÛŒ ' + formatDuration(duration.ms) + ' â±ï¸' : ' (Ø¯Ø§Ø¦Ù…ÛŒ â™¾ï¸)'}.`;
  }
  async function applyUnvip(ctx, group, target) { delete group.vips[target.id]; return `âž–â­ Ø¹Ø¶ÙˆÛŒØª ÙˆÛŒÚ˜Ù‡ ${mention(target.name, target.id)} Ø­Ø°Ù Ø´Ø¯.`; }
  async function applyExempt(ctx, group, target) { if (!group.exempts.includes(target.id)) group.exempts.push(target.id); return `ðŸŽ—ï¸ ${mention(target.name, target.id)} Ø§Ø² Ù‚ÙÙ„â€ŒÙ‡Ø§ Ù…Ø¹Ø§Ù Ø´Ø¯.`; }
  async function applyUnexempt(ctx, group, target) { group.exempts = group.exempts.filter((id) => id !== target.id); return `âž–ðŸŽ—ï¸ Ù…Ø¹Ø§ÙÛŒØª ${mention(target.name, target.id)} Ø­Ø°Ù Ø´Ø¯.`; }
  async function applyAdmin(ctx, group, target) { if (!group.admins.includes(target.id)) group.admins.push(target.id); return `ðŸ›¡ï¸ ${mention(target.name, target.id)} Ø§Ø¯Ù…ÛŒÙ† Ø±Ø¨Ø§Øª Ø´Ø¯.`; }
  async function applyUnadmin(ctx, group, target) { group.admins = group.admins.filter((id) => id !== target.id); return `âž–ðŸ›¡ï¸ Ø¯Ø³ØªØ±Ø³ÛŒ Ø§Ø¯Ù…ÛŒÙ† ${mention(target.name, target.id)} Ø­Ø°Ù Ø´Ø¯.`; }
  async function applyOwner(ctx, group, target) { if (!group.owners.includes(target.id)) group.owners.push(target.id); return `ðŸ‘‘ ${mention(target.name, target.id)} Ù…Ø§Ù„Ú© Ú¯Ø±ÙˆÙ‡ Ø´Ø¯.`; }
  async function applyUnowner(ctx, group, target) { group.owners = group.owners.filter((id) => id !== target.id); return `âž–ðŸ‘‘ Ù…Ø§Ù„Ú©ÛŒØª ${mention(target.name, target.id)} Ø­Ø°Ù Ø´Ø¯.`; }
  async function applyPromote(ctx, group, target) {
    await ctx.telegram.promoteChatMember(ctx.chat.id, target.id, { can_delete_messages: true, can_restrict_members: true, can_invite_users: true, can_pin_messages: true, can_manage_chat: true, can_change_info: false, can_promote_members: false });
    if (!group.managers.includes(target.id)) group.managers.push(target.id);
    return `ðŸŽ–ï¸ ${mention(target.name, target.id)} Ø¨Ù‡ Ù…Ø¯ÛŒØ±ÛŒØª (Ø§Ø¯Ù…ÛŒÙ† ØªÙ„Ú¯Ø±Ø§Ù…) ØªØ±ÙÛŒØ¹ ÛŒØ§ÙØª.`;
  }
  async function applyDemote(ctx, group, target) {
    await ctx.telegram.promoteChatMember(ctx.chat.id, target.id, { can_delete_messages: false, can_restrict_members: false, can_invite_users: false, can_pin_messages: false, can_manage_chat: false, can_change_info: false, can_promote_members: false });
    group.managers = group.managers.filter((id) => id !== target.id);
    return `âž–ðŸŽ–ï¸ ${mention(target.name, target.id)} Ø§Ø² Ù…Ø¯ÛŒØ±ÛŒØª Ø¹Ø²Ù„ Ø´Ø¯.`;
  }

  /* ---------- info: user / ustats / roles / history ---------- */
  async function fnUserInfo(ctx, argsText, forceCmd) {
    const group = getGroup(ctx.chat.id);
    const target = extractTarget(ctx, argsText) || { id: ctx.from.id, name: ctx.from.first_name || ctx.from.username, restText: '' };
    if (!target.id) return ctx.reply('â“ Ú©Ø§Ø±Ø¨Ø± Ù¾ÛŒØ¯Ø§ Ù†Ø´Ø¯.');
    const level = getRole(group, target.id, botOwnerId);
    const cmd = forceCmd || (ctx.message.text.split(/\s+/)[0] || '').replace('/', '');
    if (cmd === 'history' || cmd === 'ØªØ§Ø±ÛŒØ®Ú†Ù‡') {
      const logs = group.logs.filter((l) => l.target === target.id).slice(0, 10);
      const text = logs.length ? logs.map((l) => `â€¢ ${l.type} â€” ${new Date(l.date).toLocaleString('fa-IR')}`).join('\n') : 'ðŸ“­ ØªØ§Ø±ÛŒØ®Ú†Ù‡â€ŒØ§ÛŒ ÛŒØ§ÙØª Ù†Ø´Ø¯.';
      return ctx.reply(`ðŸ•˜ <b>ØªØ§Ø±ÛŒØ®Ú†Ù‡ ${esc(target.name)}</b>\n\n${text}`, { parse_mode: 'HTML' });
    }
    const msgCount = (group.stats.today && group.stats.today[target.id]) || 0;
    const warns = group.warns[target.id] || 0;
    const muted = !!group.mutes[target.id];
    const banned = !!group.bans[target.id];
    const nick = group.nicknames[target.id];
    await ctx.replyWithHTML(
      `ðŸ‘¤ <b>Ù¾Ù†Ù„ Ú©Ø§Ø±Ø¨Ø±</b> ${mention(target.name, target.id)}\n\n` +
      `ðŸŽ­ Ù†Ù‚Ø´: ${roleLabel(level)}\nðŸ’¬ Ù¾ÛŒØ§Ù… Ø§Ù…Ø±ÙˆØ²: ${msgCount}\nâš ï¸ Ø§Ø®Ø·Ø§Ø±: ${warns}/${group.settings.warnLimit || 3}\n` +
      `ðŸ“Œ ÙˆØ¶Ø¹ÛŒØª: ${banned ? 'â›” Ø¨Ù†' : muted ? 'ðŸ”‡ Ø³Ú©ÙˆØª' : 'âœ… Ø¹Ø§Ø¯ÛŒ'}` + (nick ? `\nðŸ·ï¸ Ù„Ù‚Ø¨: ${esc(nick)}` : '')
    );
  }
  bot.command(['user', 'ustats', 'roles', 'history'], (ctx) => fnUserInfo(ctx, ctx.message.text.split(/\s+/).slice(1).join(' ')));
  addTrigger('Ù¾Ù†Ù„ Ú©Ø§Ø±Ø¨Ø±', (ctx, a) => fnUserInfo(ctx, a, 'user'));
  addTrigger('Ø¢Ù…Ø§Ø± Ú©Ø§Ø±Ø¨Ø±', (ctx, a) => fnUserInfo(ctx, a, 'ustats'));
  addTrigger('Ù†Ù‚Ø´â€ŒÙ‡Ø§', (ctx, a) => fnUserInfo(ctx, a, 'roles'));
  addTrigger('ØªØ§Ø±ÛŒØ®Ú†Ù‡', (ctx, a) => fnUserInfo(ctx, a, 'history'));

  /* ---------- id ---------- */
  async function fnId(ctx) {
    const reply = ctx.message.reply_to_message;
    let text = `ðŸ†” Ø¢ÛŒØ¯ÛŒ Ø´Ù…Ø§: <code>${ctx.from.id}</code>\nðŸ†” Ø¢ÛŒØ¯ÛŒ Ú¯Ø±ÙˆÙ‡: <code>${ctx.chat.id}</code>`;
    if (reply && reply.from) text += `\nðŸ†” Ø¢ÛŒØ¯ÛŒ Ú©Ø§Ø±Ø¨Ø± Ø±ÛŒÙ¾Ù„Ø§ÛŒâ€ŒØ´Ø¯Ù‡: <code>${reply.from.id}</code>`;
    await ctx.reply(text, { parse_mode: 'HTML' });
  }
  bot.command('id', fnId);
  addTrigger('Ø¢ÛŒØ¯ÛŒ', fnId);

  /* ---------- set real owner (auto-detect telegram creator) ---------- */
  async function fnSetRealOwner(ctx) {
    const group = getGroup(ctx.chat.id);
    const actorLevel = getRole(group, ctx.from.id, botOwnerId);
    if (actorLevel < LEVEL.ADMIN) return ctx.reply('â›” Ø¯Ø³ØªØ±Ø³ÛŒ Ù„Ø§Ø²Ù… Ø±Ø§ Ù†Ø¯Ø§Ø±ÛŒØ¯.');
    try {
      const admins = await ctx.telegram.getChatAdministrators(ctx.chat.id);
      const creator = admins.find((a) => a.status === 'creator');
      if (!creator) return ctx.reply('âŒ Ù…Ø§Ù„Ú© ÙˆØ§Ù‚Ø¹ÛŒ Ú¯Ø±ÙˆÙ‡ Ù¾ÛŒØ¯Ø§ Ù†Ø´Ø¯.');
      upsertUser(creator.user.id, { username: creator.user.username || null, firstName: creator.user.first_name });
      if (!group.owners.includes(creator.user.id)) group.owners.push(creator.user.id);
      saveGroup(ctx.chat.id, group);
      await ctx.replyWithHTML(`ðŸ‘‘ ${mention(creator.user.first_name, creator.user.id)} Ø¨Ù‡â€ŒØ¹Ù†ÙˆØ§Ù† Ù…Ø§Ù„Ú© ÙˆØ§Ù‚Ø¹ÛŒ Ú¯Ø±ÙˆÙ‡ Ø«Ø¨Øª Ø´Ø¯.`);
    } catch (e) { await ctx.reply('âŒ Ø®Ø·Ø§: ' + e.message); }
  }
  bot.command('setrealowner', fnSetRealOwner);
  addTrigger('ØªÙ†Ø¸ÛŒÙ… Ù…Ø§Ù„Ú©', fnSetRealOwner);

  /* ---------- settings / setwarn ---------- */
  async function fnSettings(ctx) {
    const group = getGroup(ctx.chat.id);
    const text =
      `âš™ï¸ <b>ØªÙ†Ø¸ÛŒÙ…Ø§Øª Ú¯Ø±ÙˆÙ‡</b>\n\n` +
      `ðŸŒ Ø²Ø¨Ø§Ù†: ${group.settings.language === 'en' ? 'English' : 'ÙØ§Ø±Ø³ÛŒ'}\n` +
      `ðŸ›¡ï¸ Ø§Ø¯Ù…ÛŒÙ†â€ŒÙ‡Ø§: ${group.admins.length}\nðŸ‘‘ Ù…Ø§Ù„Ú©Ø§Ù†: ${group.owners.length}\nâ­ ÙˆÛŒÚ˜Ù‡â€ŒÙ‡Ø§: ${Object.keys(group.vips).length}\n` +
      `âš ï¸ Ø¢Ø³ØªØ§Ù†Ù‡ Ø§Ø®Ø·Ø§Ø±: ${group.settings.warnLimit || 3}\nðŸš¨ Ù…Ø¬Ø§Ø²Ø§Øª Ø§Ø®Ø·Ø§Ø±: ${WARN_LABELS[group.settings.warnAction || 'ban']}\n\n` +
      `ðŸ“ Ø¨Ø±Ø§ÛŒ ØªØºÛŒÛŒØ± Ø¢Ø³ØªØ§Ù†Ù‡: <code>/setwarn 5 mute</code> ÛŒØ§ Â«ØªÙ†Ø¸ÛŒÙ… Ø§Ø®Ø·Ø§Ø± 5 muteÂ»`;
    await ctx.reply(text, { parse_mode: 'HTML' });
  }
  bot.command('settings', fnSettings);
  addTrigger('ØªÙ†Ø¸ÛŒÙ…Ø§Øª', fnSettings);

  async function fnSetWarn(ctx, argsText) {
    const group = getGroup(ctx.chat.id);
    const actorLevel = getRole(group, ctx.from.id, botOwnerId);
    if (actorLevel < LEVEL.GOWNER) return ctx.reply('â›” ÙÙ‚Ø· Ù…Ø§Ù„Ú© Ú¯Ø±ÙˆÙ‡ Ù…ÛŒâ€ŒØªÙˆØ§Ù†Ø¯ Ø§ÛŒÙ† ØªÙ†Ø¸ÛŒÙ… Ø±Ø§ ØªØºÛŒÛŒØ± Ø¯Ù‡Ø¯.');
    const parts = argsText.trim().split(/\s+/);
    const count = parseInt(parts[0], 10);
    const action = (parts[1] || '').toLowerCase();
    if (!count || count < 1 || !['ban', 'mute', 'kick'].includes(action)) return ctx.reply('ðŸ“ ÙØ±Ù…Øª Ø¯Ø±Ø³Øª: /setwarn <ØªØ¹Ø¯Ø§Ø¯> <ban|mute|kick>  Ù…Ø«Ø§Ù„: /setwarn 5 mute');
    group.settings.warnLimit = count; group.settings.warnAction = action;
    saveGroup(ctx.chat.id, group);
    await ctx.reply(`âœ… ØªÙ†Ø¸ÛŒÙ… Ø´Ø¯: Ø¨Ø¹Ø¯ Ø§Ø² ${count} Ø§Ø®Ø·Ø§Ø± â†’ ${WARN_LABELS[action]}`);
  }
  bot.command('setwarn', (ctx) => fnSetWarn(ctx, ctx.message.text.split(/\s+/).slice(1).join(' ')));
  addTrigger('ØªÙ†Ø¸ÛŒÙ… Ø§Ø®Ø·Ø§Ø±', fnSetWarn);

  /* ---------- locks menu / stats / today / logs ---------- */
  bot.command(['locks', 'security'], async (ctx) => { const group = getGroup(ctx.chat.id); await ctx.reply('ðŸ”’ <b>Ù‚ÙÙ„â€ŒÙ‡Ø§</b>\nÛŒÚ© Ø¯Ø³ØªÙ‡ Ø±Ùˆ Ø§Ù†ØªØ®Ø§Ø¨ Ú©Ù†:', { parse_mode: 'HTML', ...locksMainKeyboard() }); });
  addTrigger('Ù‚ÙÙ„â€ŒÙ‡Ø§', async (ctx) => ctx.reply('ðŸ”’ <b>Ù‚ÙÙ„â€ŒÙ‡Ø§</b>\nÛŒÚ© Ø¯Ø³ØªÙ‡ Ø±Ùˆ Ø§Ù†ØªØ®Ø§Ø¨ Ú©Ù†:', { parse_mode: 'HTML', ...locksMainKeyboard() }));
  addTrigger('Ø§Ù…Ù†ÛŒØª', async (ctx) => ctx.reply('ðŸ”’ <b>Ù‚ÙÙ„â€ŒÙ‡Ø§</b>\nÛŒÚ© Ø¯Ø³ØªÙ‡ Ø±Ùˆ Ø§Ù†ØªØ®Ø§Ø¨ Ú©Ù†:', { parse_mode: 'HTML', ...locksMainKeyboard() }));

  async function fnStats(ctx) {
    const group = getGroup(ctx.chat.id);
    await ctx.reply(`ðŸ“Š <b>Ø¢Ù…Ø§Ø± Ú¯Ø±ÙˆÙ‡</b>\n\nðŸ’¬ Ú©Ù„ Ù¾ÛŒØ§Ù…â€ŒÙ‡Ø§: ${group.stats.messages}\nðŸ›¡ï¸ Ø§Ø¯Ù…ÛŒÙ†â€ŒÙ‡Ø§: ${group.admins.length}\nðŸ‘‘ Ù…Ø§Ù„Ú©Ø§Ù†: ${group.owners.length}\nâ­ ÙˆÛŒÚ˜Ù‡â€ŒÙ‡Ø§: ${Object.keys(group.vips).length}`, { parse_mode: 'HTML' });
  }
  bot.command('stats', fnStats); addTrigger('Ø¢Ù…Ø§Ø±', fnStats);

  async function fnToday(ctx) { await ctx.reply(await buildTodayText(ctx.chat.id), { parse_mode: 'HTML' }); }
  bot.command('today', fnToday); addTrigger('Ø¢Ù…Ø§Ø± Ø§Ù…Ø±ÙˆØ²', fnToday);

  async function fnLogs(ctx) { await ctx.reply(buildLogsText(ctx.chat.id), { parse_mode: 'HTML' }); }
  bot.command('logs', fnLogs); addTrigger('Ú¯Ø²Ø§Ø±Ø´Ø§Øª', fnLogs);

  /* ---------- member-button lists ---------- */
  const LIST_COMMANDS = [
    ['admins', 'Ù…Ø¯ÛŒØ±Ø§Ù†'], ['owners', 'Ù…Ø§Ù„Ú©Ø§Ù†'], ['vips', 'ÙˆÛŒÚ˜Ù‡â€ŒÙ‡Ø§'], ['exempts', 'Ù…Ø¹Ø§Ùâ€ŒÙ‡Ø§'],
    ['mutes', 'Ù„ÛŒØ³Øª Ø³Ú©ÙˆØª'], ['bans', 'Ù„ÛŒØ³Øª Ø¨Ù†']
  ];
  for (const [field, faLabel] of LIST_COMMANDS) {
    const slashName = { admins: 'admins', owners: 'owners', vips: 'vips', exempts: 'exempts', mutes: 'mutelist', bans: 'banlist' }[field];
    bot.command(slashName, (ctx) => sendMemberList(ctx, field));
    addTrigger(faLabel, (ctx) => sendMemberList(ctx, field));
  }
  async function fnWarnlist(ctx) {
    const group = getGroup(ctx.chat.id);
    const entries = Object.entries(group.warns).filter(([, c]) => c > 0);
    if (!entries.length) return ctx.reply('ðŸ“­ Ú©Ø§Ø±Ø¨Ø±ÛŒ Ø¨Ø§ Ø§Ø®Ø·Ø§Ø± ÙˆØ¬ÙˆØ¯ Ù†Ø¯Ø§Ø±Ø¯.');
    const lines = entries.map(([id, c]) => { const u = getUser(id); return `âš ï¸ ${u ? u.firstName : id}: ${c}/${group.settings.warnLimit || 3}`; });
    await ctx.reply(lines.join('\n'));
  }
  bot.command('warnlist', fnWarnlist); addTrigger('Ù„ÛŒØ³Øª Ø§Ø®Ø·Ø§Ø±', fnWarnlist);

  /* ---------- backup / restore ---------- */
  async function fnBackup(ctx) {
    const group = getGroup(ctx.chat.id);
    const buffer = Buffer.from(JSON.stringify(group, null, 2), 'utf8');
    await ctx.replyWithDocument({ source: buffer, filename: `backup-${ctx.chat.id}.json` });
  }
  bot.command('backup', fnBackup); addTrigger('Ø¨Ú©Ø§Ù¾', fnBackup);

  async function fnRestore(ctx) {
    const reply = ctx.message.reply_to_message;
    if (!reply || !reply.document) return ctx.reply('ðŸ“Ž Ø¨Ø±Ø§ÛŒ Ø¨Ø§Ø²ÛŒØ§Ø¨ÛŒØŒ Ø±ÙˆÛŒ ÙØ§ÛŒÙ„ Ø¨Ú©Ø§Ù¾ Ø±ÛŒÙ¾Ù„Ø§ÛŒ Ú©Ù†ÛŒØ¯.');
    try {
      const link = await ctx.telegram.getFileLink(reply.document.file_id);
      const res = await fetch(link.href);
      const data = await res.json();
      saveGroup(ctx.chat.id, data);
      await ctx.reply('âœ… Ø¨Ø§Ø²ÛŒØ§Ø¨ÛŒ Ø¨Ø§ Ù…ÙˆÙÙ‚ÛŒØª Ø§Ù†Ø¬Ø§Ù… Ø´Ø¯.');
    } catch (e) { await ctx.reply('âŒ Ø®Ø·Ø§ Ø¯Ø± Ø¨Ø§Ø²ÛŒØ§Ø¨ÛŒ: ' + e.message); }
  }
  bot.command('restore', fnRestore); addTrigger('Ø¨Ø§Ø²ÛŒØ§Ø¨ÛŒ', fnRestore);

  /* ---------- message management ---------- */
  async function fnDel(ctx) {
    const reply = ctx.message.reply_to_message;
    if (!reply) return ctx.reply('â†©ï¸ Ø±ÙˆÛŒ Ù¾ÛŒØ§Ù… Ù…ÙˆØ±Ø¯ Ù†Ø¸Ø± Ø±ÛŒÙ¾Ù„Ø§ÛŒ Ú©Ù†ÛŒØ¯.');
    try { await ctx.deleteMessage(reply.message_id); await ctx.deleteMessage(ctx.message.message_id); } catch (e) {}
  }
  bot.command('del', fnDel); addTrigger('Ø­Ø°Ù', fnDel);

  async function fnPin(ctx) {
    const reply = ctx.message.reply_to_message;
    if (!reply) return ctx.reply('â†©ï¸ Ø±ÙˆÛŒ Ù¾ÛŒØ§Ù… Ù…ÙˆØ±Ø¯ Ù†Ø¸Ø± Ø±ÛŒÙ¾Ù„Ø§ÛŒ Ú©Ù†ÛŒØ¯.');
    await ctx.pinChatMessage(reply.message_id);
    await ctx.reply('ðŸ“Œ Ù¾ÛŒØ§Ù… Ù¾ÛŒÙ† Ø´Ø¯.');
  }
  bot.command('pin', fnPin); addTrigger('Ù¾ÛŒÙ†', fnPin);

  async function fnUnpin(ctx) { await ctx.unpinChatMessage(); await ctx.reply('ðŸ“ŒâŒ Ù¾ÛŒÙ† Ø¨Ø±Ø¯Ø§Ø´ØªÙ‡ Ø´Ø¯.'); }
  bot.command('unpin', fnUnpin); addTrigger('Ø­Ø°Ù Ù¾ÛŒÙ†', fnUnpin);

  async function fnRules(ctx) { const group = getGroup(ctx.chat.id); await ctx.reply(`ðŸ“‹ ${group.rules || 'Ù‚ÙˆØ§Ù†ÛŒÙ†ÛŒ Ø«Ø¨Øª Ù†Ø´Ø¯Ù‡ Ø§Ø³Øª.'}`); }
  bot.command('rules', fnRules); addTrigger('Ù‚ÙˆØ§Ù†ÛŒÙ†', fnRules);

  async function fnSetRules(ctx, argsText) {
    const group = getGroup(ctx.chat.id);
    group.rules = argsText; saveGroup(ctx.chat.id, group);
    await ctx.reply('âœ… Ù‚ÙˆØ§Ù†ÛŒÙ† Ø¨Ù‡â€ŒØ±ÙˆØ²Ø±Ø³Ø§Ù†ÛŒ Ø´Ø¯.');
  }
  bot.command('setrules', (ctx) => fnSetRules(ctx, ctx.message.text.split(/\s+/).slice(1).join(' ')));
  addTrigger('ØªÙ†Ø¸ÛŒÙ… Ù‚ÙˆØ§Ù†ÛŒÙ†', fnSetRules);

  async function fnWelcome(ctx) { const group = getGroup(ctx.chat.id); await ctx.reply(`ðŸ‘‹ ${group.welcome}`); }
  bot.command('welcome', fnWelcome); addTrigger('Ø®ÙˆØ´â€ŒØ¢Ù…Ø¯', fnWelcome);

  async function fnSetWelcome(ctx, argsText) {
    if (!argsText) return ctx.reply('ðŸ“ Ù…ØªÙ† Ø®ÙˆØ´â€ŒØ¢Ù…Ø¯Ú¯ÙˆÛŒÛŒ Ø±Ø§ Ø¨Ù†ÙˆÛŒØ³ÛŒØ¯. Ø§Ø² {name} Ø¨Ø±Ø§ÛŒ Ù†Ø§Ù… Ú©Ø§Ø±Ø¨Ø± Ø§Ø³ØªÙØ§Ø¯Ù‡ Ú©Ù†ÛŒØ¯.');
    const group = getGroup(ctx.chat.id);
    group.welcome = argsText; saveGroup(ctx.chat.id, group);
    await ctx.reply('âœ… Ù¾ÛŒØ§Ù… Ø®ÙˆØ´â€ŒØ¢Ù…Ø¯Ú¯ÙˆÛŒÛŒ Ø¨Ù‡â€ŒØ±ÙˆØ²Ø±Ø³Ø§Ù†ÛŒ Ø´Ø¯.');
  }
  bot.command(['setwelcome', 'editwelcome'], (ctx) => fnSetWelcome(ctx, ctx.message.text.split(/\s+/).slice(1).join(' ')));
  addTrigger('ØªÙ†Ø¸ÛŒÙ… Ø®ÙˆØ´â€ŒØ¢Ù…Ø¯', fnSetWelcome);
  addTrigger('ÙˆÛŒØ±Ø§ÛŒØ´ Ø®ÙˆØ´â€ŒØ¢Ù…Ø¯', fnSetWelcome);

  /* ---------- nickname ---------- */
  async function fnSetNickname(ctx, argsText) {
    const target = extractTarget(ctx, argsText);
    if (!target || !target.id) return ctx.reply('â†©ï¸ Ø±ÙˆÛŒ Ú©Ø§Ø±Ø¨Ø± Ø±ÛŒÙ¾Ù„Ø§ÛŒ Ú©Ù† Ùˆ Ù„Ù‚Ø¨ Ø±Ùˆ Ø¨Ù†ÙˆÛŒØ³.');
    const group = getGroup(ctx.chat.id);
    group.nicknames[target.id] = target.restText || '';
    saveGroup(ctx.chat.id, group);
    await ctx.replyWithHTML(`ðŸ·ï¸ Ù„Ù‚Ø¨ ${mention(target.name, target.id)} ØªÙ†Ø¸ÛŒÙ… Ø´Ø¯: ${esc(target.restText)}`);
  }
  bot.command('setnickname', (ctx) => fnSetNickname(ctx, ctx.message.text.split(/\s+/).slice(1).join(' ')));
  addTrigger('ØªÙ†Ø¸ÛŒÙ… Ù„Ù‚Ø¨', fnSetNickname);

  /* ---------- filters (bad words) ---------- */
  async function fnAddFilter(ctx, argsText) {
    const group = getGroup(ctx.chat.id);
    const actorLevel = getRole(group, ctx.from.id, botOwnerId);
    if (actorLevel < LEVEL.ADMIN) return ctx.reply('â›” Ø¯Ø³ØªØ±Ø³ÛŒ Ù„Ø§Ø²Ù… Ø±Ø§ Ù†Ø¯Ø§Ø±ÛŒØ¯.');
    const word = argsText.trim();
    if (!word) return ctx.reply('ðŸ“ Ú©Ù„Ù…Ù‡â€ŒØ§ÛŒ Ú©Ù‡ Ù…ÛŒâ€ŒØ®ÙˆØ§ÛŒ ÙÛŒÙ„ØªØ± Ú©Ù†ÛŒ Ø±Ùˆ Ø¨Ù†ÙˆÛŒØ³.');
    if (!group.filters.includes(word)) group.filters.push(word);
    saveGroup(ctx.chat.id, group);
    await ctx.reply(`ðŸš± Ú©Ù„Ù…Ù‡ Â«${esc(word)}Â» Ø¨Ù‡ ÙÛŒÙ„ØªØ± Ø§Ø¶Ø§ÙÙ‡ Ø´Ø¯.`);
  }
  bot.command('addfilter', (ctx) => fnAddFilter(ctx, ctx.message.text.split(/\s+/).slice(1).join(' ')));
  addTrigger('Ø§ÙØ²ÙˆØ¯Ù† ÙÛŒÙ„ØªØ±', fnAddFilter);

  async function fnRemoveFilter(ctx, argsText) {
    const group = getGroup(ctx.chat.id);
    const actorLevel = getRole(group, ctx.from.id, botOwnerId);
    if (actorLevel < LEVEL.ADMIN) return ctx.reply('â›” Ø¯Ø³ØªØ±Ø³ÛŒ Ù„Ø§Ø²Ù… Ø±Ø§ Ù†Ø¯Ø§Ø±ÛŒØ¯.');
    const word = argsText.trim();
    group.filters = group.filters.filter((w) => w !== word);
    saveGroup(ctx.chat.id, group);
    await ctx.reply(`âœ… Ú©Ù„Ù…Ù‡ Â«${esc(word)}Â» Ø§Ø² ÙÛŒÙ„ØªØ± Ø­Ø°Ù Ø´Ø¯.`);
  }
  bot.command('removefilter', (ctx) => fnRemoveFilter(ctx, ctx.message.text.split(/\s+/).slice(1).join(' ')));
  addTrigger('Ø­Ø°Ù ÙÛŒÙ„ØªØ±', fnRemoveFilter);

  async function fnFilterList(ctx) {
    const group = getGroup(ctx.chat.id);
    await ctx.reply(group.filters.length ? `ðŸš± <b>Ù„ÛŒØ³Øª ÙÛŒÙ„ØªØ±</b>\n\n${group.filters.map(esc).join('ØŒ ')}` : 'ðŸ“­ Ù„ÛŒØ³Øª ÙÛŒÙ„ØªØ± Ø®Ø§Ù„ÛŒÙ‡.', { parse_mode: 'HTML' });
  }
  bot.command('filterlist', fnFilterList); addTrigger('Ù„ÛŒØ³Øª ÙÛŒÙ„ØªØ±', fnFilterList);

  /* ---------- lock toggle (slash + Persian phrase) ---------- */
  async function applyLockToggle(ctx, type, on) {
    const group = getGroup(ctx.chat.id);
    const actorLevel = getRole(group, ctx.from.id, botOwnerId);
    if (actorLevel < LEVEL.ADMIN) return ctx.reply('â›” Ø¯Ø³ØªØ±Ø³ÛŒ Ù„Ø§Ø²Ù… Ø±Ø§ Ù†Ø¯Ø§Ø±ÛŒØ¯.');
    group.locks[type] = on;
    saveGroup(ctx.chat.id, group);
    const meta = LOCK_META[type];
    await ctx.reply(`${on ? 'ðŸ”’' : 'ðŸ”“'} Ù‚ÙÙ„ ${meta.emoji} ${meta.fa} ${on ? 'ÙØ¹Ø§Ù„' : 'ØºÛŒØ±ÙØ¹Ø§Ù„'} Ø´Ø¯.`);
  }
  bot.command(['lock', 'unlock'], async (ctx) => {
    const [cmd, typeArg] = ctx.message.text.split(/\s+/);
    if (!typeArg || !LOCK_META[typeArg]) return ctx.reply('ðŸ“ Ù†ÙˆØ¹ Ù‚ÙÙ„ Ø±Ø§ Ù…Ø´Ø®Øµ Ú©Ù†ÛŒØ¯. Ù…Ø«Ø§Ù„: /lock links');
    await applyLockToggle(ctx, typeArg, cmd.replace('/', '') === 'lock');
  });
  for (const { phrase, type, on } of LOCK_PHRASE_TRIGGERS) addTrigger(phrase, (ctx) => applyLockToggle(ctx, type, on));

  /* ---------- purge / cleanup (unified fa router) ---------- */
  async function unbanAllTracked(ctx, group) {
    const ids = Object.keys(group.bans);
    for (const id of ids) { try { await ctx.telegram.unbanChatMember(ctx.chat.id, id, { only_if_banned: true }); } catch (e) {} }
    group.bans = {};
    return `âœ… ${ids.length} Ú©Ø§Ø±Ø¨Ø± Ø¢Ø²Ø§Ø¯ Ùˆ Ù„ÛŒØ³Øª Ø¨Ù† Ù¾Ø§Ú© Ø´Ø¯.`;
  }
  async function unmuteAllTracked(ctx, group) {
    const ids = Object.keys(group.mutes);
    for (const id of ids) { try { await ctx.telegram.restrictChatMember(ctx.chat.id, id, { permissions: FULL_PERMS }); } catch (e) {} }
    group.mutes = {};
    return `ðŸ”Š ${ids.length} Ú©Ø§Ø±Ø¨Ø± Ø±ÙØ¹ Ø³Ú©ÙˆØª Ùˆ Ù„ÛŒØ³Øª Ø³Ú©ÙˆØª Ù¾Ø§Ú© Ø´Ø¯.`;
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
    return `ðŸ—‘ï¸ ${count} Ø­Ø³Ø§Ø¨ Ø­Ø°Ùâ€ŒØ´Ø¯Ù‡/ÙÛŒÚ© (Ø§Ø² Ø¨ÛŒÙ† Ú©Ø§Ø±Ø¨Ø±Ø§Ù† Ø´Ù†Ø§Ø®ØªÙ‡â€ŒØ´Ø¯Ù‡ ØªÙˆØ³Ø· Ø±Ø¨Ø§Øª) Ø¨Ù† Ø´Ø¯.\n\nâ„¹ï¸ ØªÙˆØ¬Ù‡: ØªÙ„Ú¯Ø±Ø§Ù… Ø§Ø¬Ø§Ø²Ù‡ Ù†Ù…ÛŒâ€ŒØ¯Ù‡ Ø±Ø¨Ø§Øªâ€ŒÙ‡Ø§ Ú©Ù„ Ù„ÛŒØ³Øª Ø§Ø¹Ø¶Ø§ÛŒ Ú¯Ø±ÙˆÙ‡ Ø±Ùˆ Ø¨Ú¯ÛŒØ±Ù†ØŒ Ù¾Ø³ Ø§ÛŒÙ† Ø¹Ù…Ù„ÛŒØ§Øª ÙÙ‚Ø· Ø±ÙˆÛŒ Ú©Ø§Ø±Ø¨Ø±Ø§Ù†ÛŒ Ø§Ø«Ø± Ø¯Ø§Ø±Ù‡ Ú©Ù‡ Ø±Ø¨Ø§Øª Ù‚Ø¨Ù„Ø§Ù‹ Ù¾ÛŒØ§Ù…Ø´ÙˆÙ† Ø±Ùˆ Ø¯ÛŒØ¯Ù‡.`;
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
    return `ðŸ¤–â›” ${count} Ø±Ø¨Ø§Øª Ø´Ù†Ø§Ø®ØªÙ‡â€ŒØ´Ø¯Ù‡ Ø­Ø°Ù Ùˆ ${toDelete.length} Ù¾ÛŒØ§Ù…Ø´ÙˆÙ† Ù¾Ø§Ú© Ø´Ø¯.`;
  }

  const CLEAR_FA_HANDLERS = {
    'Ø¨Ù†': unbanAllTracked, 'Ù…Ø³Ø¯ÙˆØ¯': unbanAllTracked,
    'Ø³Ú©ÙˆØª': unmuteAllTracked,
    'Ù…Ø­Ø¯ÙˆØ¯': async (ctx, group) => { const n = group.exempts.length; group.exempts = []; return `âœ… ${n} Ù…Ø¹Ø§ÙÛŒØª Ù¾Ø§Ú© Ø´Ø¯.`; },
    'ÙˆÛŒÚ˜Ù‡': async (ctx, group) => { const n = Object.keys(group.vips).length; group.vips = {}; return `âœ… ${n} Ú©Ø§Ø±Ø¨Ø± ÙˆÛŒÚ˜Ù‡ Ù¾Ø§Ú© Ø´Ø¯.`; },
    'Ù…Ø¯ÛŒØ±Ø§Ù†': async (ctx, group) => { const n = group.admins.length; group.admins = []; return `âœ… ${n} Ø§Ø¯Ù…ÛŒÙ† Ù¾Ø§Ú© Ø´Ø¯.`; },
    'Ø§Ø®Ø·Ø§Ø±': async (ctx, group) => { group.warns = {}; return 'âœ… Ù„ÛŒØ³Øª Ø§Ø®Ø·Ø§Ø±Ù‡Ø§ Ù¾Ø§Ú© Ø´Ø¯.'; },
    'Ù„Ù‚Ø¨': async (ctx, group) => { group.nicknames = {}; return 'âœ… Ù„ÛŒØ³Øª Ù„Ù‚Ø¨â€ŒÙ‡Ø§ Ù¾Ø§Ú© Ø´Ø¯.'; },
    'ÙÛŒÙ„ØªØ±': async (ctx, group) => { group.filters = []; return 'âœ… Ù„ÛŒØ³Øª ÙÛŒÙ„ØªØ± Ù¾Ø§Ú© Ø´Ø¯.'; },
    'ÙÛŒÚ©': banFakeOrDeleted,
    'Ø¯Ù„ÛŒØª': banFakeOrDeleted
  };

  async function fnPaksaziRouter(ctx, argsText) {
    const group = getGroup(ctx.chat.id);
    const actorLevel = getRole(group, ctx.from.id, botOwnerId);
    if (actorLevel < LEVEL.ADMIN) return ctx.reply('â›” Ø¯Ø³ØªØ±Ø³ÛŒ Ù„Ø§Ø²Ù… Ø±Ø§ Ù†Ø¯Ø§Ø±ÛŒØ¯.');
    const arg = (argsText || '').trim();

    if (arg.startsWith('Ù„ÛŒØ³Øª ')) {
      const key = arg.slice(5).trim();
      const handler = CLEAR_FA_HANDLERS[key];
      if (!handler) return ctx.reply('ðŸ“ Ù†ÙˆØ¹ Ù¾Ø§Ú©Ø³Ø§Ø²ÛŒ Ù†Ø§Ù…Ø¹ØªØ¨Ø± Ø§Ø³Øª.');
      const resultText = await handler(ctx, group);
      saveGroup(ctx.chat.id, group);
      return ctx.reply(resultText);
    }
    if (arg === 'Ø±Ø¨Ø§Øªâ€ŒÙ‡Ø§' || arg === 'Ø±Ø¨Ø§Øª Ù‡Ø§') {
      const resultText = await purgeBotsFull(ctx, group);
      saveGroup(ctx.chat.id, group);
      return ctx.reply(resultText);
    }
    return fnPurgeEnglish(ctx, arg);
  }
  addTrigger('Ù¾Ø§Ú©Ø³Ø§Ø²ÛŒ', fnPaksaziRouter);

  async function fnPurgeEnglish(ctx, arg) {
    const group = getGroup(ctx.chat.id);
    const actorLevel = getRole(group, ctx.from.id, botOwnerId);
    if (actorLevel < LEVEL.ADMIN) return ctx.reply('â›” Ø¯Ø³ØªØ±Ø³ÛŒ Ù„Ø§Ø²Ù… Ø±Ø§ Ù†Ø¯Ø§Ø±ÛŒØ¯.');
    if (!arg) return ctx.reply('ðŸ“ Ù†ÙˆØ¹ Ù¾Ø§Ú©Ø³Ø§Ø²ÛŒ Ø±Ø§ ÙˆØ§Ø±Ø¯ Ú©Ù†ÛŒØ¯: Ø¹Ø¯Ø¯ØŒ botsØŒ linksØŒ forwardsØŒ mediaØŒ muted_messages');
    let toDelete = [];
    if (/^\d+$/.test(arg)) toDelete = group.recentMessages.slice(0, parseInt(arg, 10));
    else if (arg === 'bots') toDelete = group.recentMessages.filter((m) => m.isBot);
    else if (arg === 'muted_messages') toDelete = group.recentMessages.filter((m) => group.mutes[m.from]);
    else if (['links', 'forwards', 'media'].includes(arg)) { const key = arg === 'forwards' ? 'forward' : arg; toDelete = group.recentMessages.filter((m) => m.types.includes(key)); }
    else return ctx.reply('ðŸ“ Ù†ÙˆØ¹ Ù¾Ø§Ú©Ø³Ø§Ø²ÛŒ Ù†Ø§Ù…Ø¹ØªØ¨Ø± Ø§Ø³Øª.');
    let deleted = 0;
    for (const m of toDelete) { try { await ctx.telegram.deleteMessage(ctx.chat.id, m.id); deleted++; } catch (e) {} }
    group.recentMessages = group.recentMessages.filter((m) => !toDelete.includes(m));
    saveGroup(ctx.chat.id, group);
    await ctx.reply(`ðŸ§¹ ${deleted} Ù¾ÛŒØ§Ù… Ø­Ø°Ù Ø´Ø¯.`);
  }
  bot.command(['purge', 'cleanup'], (ctx) => fnPurgeEnglish(ctx, ctx.message.text.split(/\s+/)[1]));

  async function fnClearSlash(ctx) {
    const what = ctx.message.text.split(/\s+/)[1];
    const FA = { bans: 'Ø¨Ù†', mutes: 'Ø³Ú©ÙˆØª', warns: 'Ø§Ø®Ø·Ø§Ø±', vips: 'ÙˆÛŒÚ˜Ù‡', exempts: 'Ù…Ø­Ø¯ÙˆØ¯' };
    if (what in FA) return fnPaksaziRouter(ctx, 'Ù„ÛŒØ³Øª ' + FA[what]);
    const group = getGroup(ctx.chat.id);
    const map = {
      logs: () => (group.logs = []),
      today: () => (group.stats.today = {}),
      stats: () => (group.stats = { messages: 0, today: {}, lastReset: new Date().toISOString().slice(0, 10) }),
      managers: () => (group.managers = []),
      reports: () => {}
    };
    if (!map[what]) return ctx.reply('ðŸ“ Ù†ÙˆØ¹ Ù¾Ø§Ú©Ø³Ø§Ø²ÛŒ Ù†Ø§Ù…Ø¹ØªØ¨Ø± Ø§Ø³Øª.');
    map[what]();
    saveGroup(ctx.chat.id, group);
    await ctx.reply(`âœ… ${what} Ù¾Ø§Ú© Ø´Ø¯.`);
  }
  bot.command('clear', fnClearSlash);

  bot.command('reset', async (ctx) => {
    const what = ctx.message.text.split(/\s+/)[1];
    const group = getGroup(ctx.chat.id);
    const map = {
      locks: () => (group.locks = {}),
      welcome: () => (group.welcome = 'Ø³Ù„Ø§Ù… {name} Ø®ÙˆØ´ Ø§ÙˆÙ…Ø¯ÛŒ Ø¨Ù‡ Ú¯Ø±ÙˆÙ‡! ðŸŒ¸'),
      rules: () => (group.rules = ''),
      filters: () => (group.filters = []),
      buttons: () => {}, colors: () => {},
      settings: () => (group.settings = { language: 'fa', warnLimit: 3, warnAction: 'ban' })
    };
    if (!map[what]) return ctx.reply('ðŸ“ Ù†ÙˆØ¹ Ø¨Ø§Ø²Ù†Ø´Ø§Ù†ÛŒ Ù†Ø§Ù…Ø¹ØªØ¨Ø± Ø§Ø³Øª.');
    map[what]();
    saveGroup(ctx.chat.id, group);
    await ctx.reply(`âœ… ${what} Ø¨Ø§Ø²Ù†Ø´Ø§Ù†ÛŒ Ø´Ø¯.`);
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
  return `<!doctype html><html><head><meta charset="utf-8"><title>Ø±Ø§Ù‡â€ŒØ§Ù†Ø¯Ø§Ø²ÛŒ Ø±Ø¨Ø§Øª</title>${PAGE_STYLE}</head>
  <body><div class="card">
  <h1>ðŸ¤– Ø±Ø§Ù‡â€ŒØ§Ù†Ø¯Ø§Ø²ÛŒ Ø±Ø¨Ø§Øª Ù…Ø¯ÛŒØ±ÛŒØª Ú¯Ø±ÙˆÙ‡</h1>
  <p>ØªÙˆÚ©Ù† Ø±Ø¨Ø§Øª Ø®ÙˆØ¯ (Ø§Ø² BotFather) Ùˆ Ø¢ÛŒØ¯ÛŒ Ø¹Ø¯Ø¯ÛŒ ØªÙ„Ú¯Ø±Ø§Ù… Ø®ÙˆØ¯ØªØ§Ù† (Ù…Ø§Ù„Ú© Ø±Ø¨Ø§Øª) Ø±Ø§ ÙˆØ§Ø±Ø¯ Ú©Ù†ÛŒØ¯.</p>
  ${error ? `<p class="err">âš ï¸ ${error}</p>` : ''}
  <form method="POST" action="/setup">
    <label>ØªÙˆÚ©Ù† Ø±Ø¨Ø§Øª</label>
    <input name="token" placeholder="123456:ABC-DEF..." required />
    <label>Ø¢ÛŒØ¯ÛŒ Ø¹Ø¯Ø¯ÛŒ Ù…Ø§Ù„Ú© Ø±Ø¨Ø§Øª</label>
    <input name="ownerId" placeholder="123456789" required pattern="\\d+" />
    <button type="submit">ðŸš€ Ø³Ø§Ø®Øª Ùˆ Ø±Ø§Ù‡â€ŒØ§Ù†Ø¯Ø§Ø²ÛŒ Ø±Ø¨Ø§Øª</button>
  </form>
  </div></body></html>`;
}
function renderStatus() {
  return `<!doctype html><html><head><meta charset="utf-8"><title>ÙˆØ¶Ø¹ÛŒØª Ø±Ø¨Ø§Øª</title>${PAGE_STYLE}</head>
  <body><div class="card">
  <h1>âœ… Ø±Ø¨Ø§Øª ÙØ¹Ø§Ù„ Ø§Ø³Øª</h1>
  <p class="ok">ðŸŽ‰ Ø±Ø¨Ø§Øª ${status.botUsername ? '@' + status.botUsername : ''} Ø¨Ø§ Ù…ÙˆÙÙ‚ÛŒØª Ø¯Ø± Ø­Ø§Ù„ Ø§Ø¬Ø±Ø§Ø³Øª.</p>
  <p>Ø­Ø§Ù„Ø§ Ø±Ø¨Ø§Øª Ø±Ø§ Ø¨Ù‡ Ú¯Ø±ÙˆÙ‡ Ø®ÙˆØ¯ Ø§Ø¶Ø§ÙÙ‡ Ú©Ù†ÛŒØ¯ Ùˆ Ø¨Ù‡ Ø¢Ù† Ø¯Ø³ØªØ±Ø³ÛŒ Ø§Ø¯Ù…ÛŒÙ† Ø¨Ø¯Ù‡ÛŒØ¯.</p>
  <p>Ø¨Ø±Ø§ÛŒ Ù…Ø´Ø§Ù‡Ø¯Ù‡ Ø§Ù…Ú©Ø§Ù†Ø§Øª Ø¯Ø§Ø®Ù„ Ú¯Ø±ÙˆÙ‡ Ø¯Ø³ØªÙˆØ± <b>/panel</b> Ø±Ø§ Ø¨ÙØ±Ø³ØªÛŒØ¯.</p>
  <form method="GET" action="/reconfigure"><button type="submit" style="background:#777">ðŸ” ØªØºÛŒÛŒØ± ØªÙˆÚ©Ù† / Ù…Ø§Ù„Ú©</button></form>
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
  if (!token || !ownerId) return res.send(renderSetupForm('Ù„Ø·ÙØ§Ù‹ Ù‡Ø± Ø¯Ùˆ Ù…Ù‚Ø¯Ø§Ø± Ø±Ø§ ÙˆØ§Ø±Ø¯ Ú©Ù†ÛŒØ¯.'));
  try {
    const testBot = new Telegraf(token);
    const me = await testBot.telegram.getMe();
    saveConfig({ token, ownerId });
    await startBot(token, ownerId);
    status = { running: true, error: null, botUsername: me.username };
    res.redirect('/');
  } catch (e) { res.send(renderSetupForm('ØªÙˆÚ©Ù† Ù†Ø§Ù…Ø¹ØªØ¨Ø± Ø§Ø³Øª ÛŒØ§ Ø®Ø·Ø§ÛŒÛŒ Ø±Ø® Ø¯Ø§Ø¯: ' + e.message)); }
});
app.get('/health', (req, res) => res.json({ ok: true, running: status.running }));
app.listen(PORT, async () => { console.log('Server listening on port', PORT); await tryAutoStart(); });
