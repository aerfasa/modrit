const db = require('./db');

const UNIT_MS = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
  w: 7 * 24 * 60 * 60 * 1000
};

const PERMANENT_WORDS = ['permanent', 'دائم', 'دائمی', 'همیشه'];

// Returns: { ms: number } | { permanent: true } | null
function parseDuration(input) {
  if (!input) return null;
  const raw = input.trim().toLowerCase();
  if (PERMANENT_WORDS.some((w) => raw === w || raw === w.toLowerCase())) {
    return { permanent: true };
  }
  const match = raw.match(/^(\d+)\s*(s|sec|m|min|h|hr|d|day|w|week)?$/);
  if (!match) return null;
  const num = parseInt(match[1], 10);
  let unit = (match[2] || 'm')[0]; // default minutes if bare number
  if (!UNIT_MS[unit]) return null;
  return { ms: num * UNIT_MS[unit] };
}

function formatDuration(ms) {
  if (ms == null) return 'دائمی';
  const units = [
    ['w', 7 * 24 * 60 * 60 * 1000],
    ['d', 24 * 60 * 60 * 1000],
    ['h', 60 * 60 * 1000],
    ['m', 60 * 1000],
    ['s', 1000]
  ];
  for (const [u, v] of units) {
    if (ms >= v) return `${Math.round(ms / v)}${u}`;
  }
  return `${ms}ms`;
}

// Extract target user from a reply or from command args (@username, numeric id, tg://user?id=)
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

  // tg://user?id=123456
  const tgMatch = first.match(/tg:\/\/user\?id=(\d+)/);
  if (tgMatch) {
    const u = db.getUser(tgMatch[1]);
    return { id: Number(tgMatch[1]), name: u ? u.firstName : tgMatch[1], username: u ? u.username : null, restText: rest };
  }

  // numeric id
  if (/^\d+$/.test(first)) {
    const u = db.getUser(first);
    return { id: Number(first), name: u ? u.firstName : first, username: u ? u.username : null, restText: rest };
  }

  // @username
  if (first.startsWith('@')) {
    const u = db.findUserByUsername(first);
    if (!u) return { id: null, name: first, username: first.replace('@', ''), restText: rest, notFound: true };
    return { id: u.id, name: u.firstName || u.username, username: u.username, restText: rest };
  }

  return null;
}

function mention(name, id) {
  const safe = String(name).replace(/[<>&]/g, '');
  return `<a href="tg://user?id=${id}">${safe}</a>`;
}

module.exports = { parseDuration, formatDuration, extractTarget, mention };
