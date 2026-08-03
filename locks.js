const LOCK_TYPES = [
  'links', 'username', 'forward', 'media', 'photo', 'video', 'gif', 'sticker',
  'voice', 'audio', 'file', 'contact', 'location', 'poll', 'game', 'inline',
  'spam', 'flood', 'emoji', 'english', 'persian'
];

const floodTracker = {}; // chatId:userId -> [timestamps]
const spamTracker = {}; // chatId:userId -> lastText+time

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

module.exports = { LOCK_TYPES, detectTypes, checkFlood, checkSpam };
