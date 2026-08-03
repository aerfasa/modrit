const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const CONFIG_FILE = path.join(__dirname, '..', 'config.json');

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

let db = loadJSON(DB_FILE, { groups: {}, users: {} });

function persist() {
  saveJSON(DB_FILE, db);
}

function getConfig() {
  return loadJSON(CONFIG_FILE, null);
}

function saveConfig(cfg) {
  saveJSON(CONFIG_FILE, cfg);
}

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
  if (!db.groups[chatId]) {
    db.groups[chatId] = defaultGroup();
    persist();
  }
  // backfill any missing keys for groups created by older versions
  const g = db.groups[chatId];
  const d = defaultGroup();
  for (const k of Object.keys(d)) {
    if (!(k in g)) g[k] = d[k];
  }
  return g;
}

function saveGroup(chatId, data) {
  db.groups[String(chatId)] = data;
  persist();
}

function upsertUser(userId, info) {
  userId = String(userId);
  db.users[userId] = { ...(db.users[userId] || {}), ...info, id: Number(userId) };
  persist();
}

function findUserByUsername(username) {
  username = username.replace(/^@/, '').toLowerCase();
  for (const id in db.users) {
    if ((db.users[id].username || '').toLowerCase() === username) return db.users[id];
  }
  return null;
}

function getUser(userId) {
  return db.users[String(userId)] || null;
}

function addLog(chatId, entry) {
  const g = getGroup(chatId);
  g.logs.unshift({ ...entry, date: new Date().toISOString() });
  g.logs = g.logs.slice(0, 200);
  saveGroup(chatId, g);
}

module.exports = {
  getConfig,
  saveConfig,
  getGroup,
  saveGroup,
  upsertUser,
  findUserByUsername,
  getUser,
  addLog
};
