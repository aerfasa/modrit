// PUG62 WireGuard Panel — backend server with Telegram Bot
// Serves the panel (public/index.html), the subscription page (public/sub.html),
// a JSON-file-backed API for auth/admin/configs, and an optional Telegram bot
// (referral coins, forced-join gate, self-service panel issuance, ban system,
// owner-only management menu with unlimited coin transfer)

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;

// ---------- Admin credentials ----------
const ADMIN_USERNAME = 'arian';
const ADMIN_PASSWORD = 'arian@11USER';

const PANEL_URL = process.env.PANEL_URL || 'https://pug62best.dpdns.org/';

// ---------- Server catalogue (UPDATED with your new configs) ----------
const WG_SERVERS = {
  UAE: { ip: '154.49.239.4', port: 62050, country: 'United Arab Emirates', city: 'Dubai' },
  TR: { ip: '154.49.239.4', port: 62050, country: 'Turkey', city: 'Istanbul' },
  IR: { ip: '0.0.0.0', port: 51820, country: 'Iran', city: 'Tehran' }
};

const CONFIG_TEMPLATES = {
  UAE: `[Interface]
PrivateKey = xIxZdTx8VQsdG2KCepbuVYSRmd6iv8s3BOSC+xU4/hE=
Address = 10.66.66.191/24, fd86:ea04:1111::225/64
DNS = 1.1.1.1, 92.38.142.153, 2620:fe::25, 2620:fe::9c
MTU = 1300

[Peer]
PublicKey = OjI0kHigkiP6V5B92GlbOfbTQSzCQkcO/nOVQKvGTd0=
PersistentKeepalive = 25
PreSharedKey = 45ovhOuAU3aU4RDCszF/hI+8sxoHLWlF+y7CQt/y6Tg=
Endpoint = 154.49.239.4:62050
AllowedIPs = 5.112.0.0/16, 2a03:4400::/64`,

  TR: `[Interface]
PrivateKey = qRbs8zzHy+0aP4ejaku2yKI56ZHWCVoMg4uhMLn8g34=
Address = 5.112.222.239/27, 84e0:cd6:2707:1c6e:ca1:b0b:c30:acd/128
MTU = 1422
ListenPort = 2088
DNS = 78.157.42.100, 5.112.193.91, 2a03:4400::7b8:167b:10f6:e40a, 2a03:4400::7b8:167b:12b1:e40a

[Peer]
PublicKey = OjI0kHigkiP6V5B92GlbOfbTQSzCQkcO/nOVQKvGTd0=
PersistentKeepalive = 25
PreSharedKey = 45ovhOuAU3aU4RDCszF/hI+8sxoHLWlF+y7CQt/y6Tg=
Endpoint = 154.49.239.4:62050
AllowedIPs = 5.112.0.0/16, 2a03:4400::/64`,

  IR: `[Interface]
PrivateKey = kNvr1/n8GbdzCdQxqlBeWQUur2XP5wbB0fjmHnwFZUQ=
Address = 10.39.89.26/32
DNS = 1.1.1.1, 1.182.102.115
# Name: B13
# Region: \uD83C\uDDEE\uD83C\uDDF7\u0627\u06cc\u0631\u0627\u0646
# VIP: Active

[Peer]
PublicKey = aFP5M1M2VUEByYqLt29xyUCmNT2vYXsVGiUG+DSl2Uo=
AllowedIPs = ::/0
Endpoint = 0.0.0.0:51820
PersistentKeepalive = 25`
};

// ---------- Tiny JSON-file database ----------
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

function freshDB() {
  return {
    jwtSecret: crypto.randomBytes(32).toString('hex'),
    users: [],
    adminConfigs: [],
    bot: {
      ownerId: '',
      token: '',
      channels: [],
      active: false,
      users: {},
      supportReplyMap: {}
    }
  };
}

function loadDB() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    const fresh = freshDB();
    fs.writeFileSync(DB_FILE, JSON.stringify(fresh, null, 2));
    return fresh;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    if (!parsed.jwtSecret) parsed.jwtSecret = crypto.randomBytes(32).toString('hex');
    if (!Array.isArray(parsed.users)) parsed.users = [];
    if (!Array.isArray(parsed.adminConfigs)) parsed.adminConfigs = [];
    if (!parsed.bot || typeof parsed.bot !== 'object') parsed.bot = freshDB().bot;
    if (!Array.isArray(parsed.bot.channels)) parsed.bot.channels = [];
    if (!parsed.bot.users || typeof parsed.bot.users !== 'object') parsed.bot.users = {};
    if (!parsed.bot.supportReplyMap) parsed.bot.supportReplyMap = {};
    return parsed;
  } catch (e) {
    const fresh = freshDB();
    fs.writeFileSync(DB_FILE, JSON.stringify(fresh, null, 2));
    return fresh;
  }
}

let db = loadDB();
let saveTimer = null;
function saveDB() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  }, 50);
}

function genId(prefix) {
  return prefix + '_' + crypto.randomBytes(8).toString('hex');
}

function daysLeftOf(expireAt) {
  return Math.max(0, Math.ceil((expireAt - Date.now()) / 86400000));
}

// ---------- Shared license-user helpers ----------
function createLicenseUser(username, password, days) {
  const cleanUsername = String(username || '').trim();
  if (!cleanUsername || !password || !days || Number(days) <= 0) {
    return { error: 'missing_fields' };
  }
  if (cleanUsername === ADMIN_USERNAME || db.users.some(u => u.username === cleanUsername)) {
    return { error: 'username_taken' };
  }
  const now = Date.now();
  const user = {
    id: genId('u'),
    username: cleanUsername,
    passwordHash: bcrypt.hashSync(String(password), 10),
    createdAt: now,
    expireAt: now + Number(days) * 86400000,
    isActive: true,
    configs: []
  };
  db.users.push(user);
  saveDB();
  return user;
}

function extendLicenseUser(userId, days) {
  const user = db.users.find(u => u.id === userId);
  if (!user) return { error: 'not_found' };
  const base = Math.max(user.expireAt, Date.now());
  user.expireAt = base + Number(days) * 86400000;
  saveDB();
  return user;
}

// ---------- Express setup ----------
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Auth middleware ----------
function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'no_token' });

  let payload;
  try {
    payload = jwt.verify(token, db.jwtSecret);
  } catch (e) {
    return res.status(401).json({ error: 'invalid_token' });
  }

  if (payload.role === 'admin') {
    req.auth = { role: 'admin' };
    return next();
  }

  const user = db.users.find(u => u.id === payload.id);
  if (!user) return res.status(401).json({ error: 'invalid_token' });
  if (!user.isActive) return res.status(403).json({ error: 'deactivated' });
  if (Date.now() > user.expireAt) return res.status(403).json({ error: 'expired' });

  req.auth = { role: 'user', id: user.id };
  req.userRecord = user;
  next();
}

function adminOnly(req, res, next) {
  authRequired(req, res, function () {
    if (req.auth.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
    next();
  });
}

// ---------- Auth routes ----------
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'missing_fields' });

  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    const token = jwt.sign({ role: 'admin' }, db.jwtSecret, { expiresIn: '30d' });
    return res.json({ token, role: 'admin', username: ADMIN_USERNAME });
  }

  const user = db.users.find(u => u.username === username);
  if (!user || !bcrypt.compareSync(String(password), user.passwordHash)) {
    return res.status(401).json({ error: 'invalid_credentials' });
  }
  if (!user.isActive) return res.status(403).json({ error: 'deactivated' });
  if (Date.now() > user.expireAt) return res.status(403).json({ error: 'expired' });

  const token = jwt.sign({ role: 'user', id: user.id }, db.jwtSecret, { expiresIn: '30d' });
  res.json({ token, role: 'user', username: user.username, daysLeft: daysLeftOf(user.expireAt) });
});

app.get('/api/me', authRequired, (req, res) => {
  if (req.auth.role === 'admin') return res.json({ role: 'admin', username: ADMIN_USERNAME });
  const user = req.userRecord;
  res.json({ role: 'user', username: user.username, daysLeft: daysLeftOf(user.expireAt), isActive: user.isActive });
});

// ---------- Admin: user management ----------
app.get('/api/admin/users', adminOnly, (req, res) => {
  const list = db.users.map(u => ({
    id: u.id,
    username: u.username,
    createdAt: u.createdAt,
    expireAt: u.expireAt,
    daysLeft: daysLeftOf(u.expireAt),
    isActive: u.isActive,
    configsCount: (u.configs || []).length
  }));
  res.json({ users: list });
});

app.post('/api/admin/users', adminOnly, (req, res) => {
  const { username, password, days } = req.body || {};
  const result = createLicenseUser(username, password, days);
  if (result.error) {
    const code = result.error === 'username_taken' ? 409 : 400;
    return res.status(code).json({ error: result.error });
  }
  res.json({
    id: result.id, username: result.username, createdAt: result.createdAt,
    expireAt: result.expireAt, daysLeft: daysLeftOf(result.expireAt), isActive: true, configsCount: 0
  });
});

app.post('/api/admin/users/:id/extend', adminOnly, (req, res) => {
  const days = Number((req.body || {}).days);
  if (!days || days <= 0) return res.status(400).json({ error: 'invalid_days' });
  const result = extendLicenseUser(req.params.id, days);
  if (result.error) return res.status(404).json({ error: result.error });
  res.json({ ok: true, expireAt: result.expireAt, daysLeft: daysLeftOf(result.expireAt) });
});

app.post('/api/admin/users/:id/toggle', adminOnly, (req, res) => {
  const user = db.users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'not_found' });
  user.isActive = !user.isActive;
  saveDB();
  res.json({ ok: true, isActive: user.isActive });
});

app.delete('/api/admin/users/:id', adminOnly, (req, res) => {
  const idx = db.users.findIndex(u => u.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'not_found' });
  db.users.splice(idx, 1);
  saveDB();
  res.json({ ok: true });
});

// ---------- Configs ----------
function configsArrayFor(req) {
  return req.auth.role === 'admin' ? db.adminConfigs : req.userRecord.configs;
}

app.get('/api/configs', authRequired, (req, res) => {
  res.json({ configs: configsArrayFor(req) });
});

app.post('/api/configs', authRequired, (req, res) => {
  const { name, country, volume, days, dailyLimit } = req.body || {};
  if (!name || !CONFIG_TEMPLATES[country] || !days || Number(days) <= 0) {
    return res.status(400).json({ error: 'invalid_fields' });
  }

  const configText = CONFIG_TEMPLATES[country];
  const privateKey = (configText.match(/PrivateKey\s*=\s*(\S+)/) || [])[1] || '';
  const publicKey = (configText.match(/PublicKey\s*=\s*(\S+)/) || [])[1] || '';
  const address = (configText.match(/Address\s*=\s*(\S+)/) || [])[1] || '';

  const now = new Date();
  const expire = new Date(now.getTime() + Number(days) * 86400000);

  const config = {
    id: genId('c'),
    subId: genId('sub'),
    name: String(name).trim(),
    country,
    server: WG_SERVERS[country],
    volume: volume === 'unlimited' ? -1 : Number(volume),
    volumeUsed: 0,
    dailyLimit: dailyLimit === 'unlimited' ? -1 : Number(dailyLimit),
    dailyUsed: 0,
    days: Number(days),
    createdDate: now.toISOString(),
    expireDate: expire.toISOString(),
    isActive: true,
    configText,
    address,
    privateKey,
    publicKey,
    usageHistory: []
  };

  configsArrayFor(req).push(config);
  saveDB();
  res.json({ config });
});

function findConfig(req) {
  return configsArrayFor(req).find(c => c.id === req.params.id);
}

app.post('/api/configs/:id/toggle', authRequired, (req, res) => {
  const c = findConfig(req);
  if (!c) return res.status(404).json({ error: 'not_found' });
  c.isActive = !c.isActive;
  saveDB();
  res.json({ ok: true, isActive: c.isActive });
});

app.post('/api/configs/:id/add-data', authRequired, (req, res) => {
  const c = findConfig(req);
  if (!c) return res.status(404).json({ error: 'not_found' });
  const amount = Number((req.body || {}).amount);
  if (!amount || amount <= 0) return res.status(400).json({ error: 'invalid_amount' });
  if (c.volume !== -1) c.volume += amount;
  saveDB();
  res.json({ ok: true, volume: c.volume });
});

app.post('/api/configs/:id/add-days', authRequired, (req, res) => {
  const c = findConfig(req);
  if (!c) return res.status(404).json({ error: 'not_found' });
  const days = Number((req.body || {}).days);
  if (!days || days <= 0) return res.status(400).json({ error: 'invalid_days' });
  const expire = new Date(c.expireDate);
  expire.setDate(expire.getDate() + days);
  c.expireDate = expire.toISOString();
  c.days += days;
  saveDB();
  res.json({ ok: true, expireDate: c.expireDate });
});

app.post('/api/configs/:id/usage', authRequired, (req, res) => {
  const c = findConfig(req);
  if (!c) return res.status(404).json({ error: 'not_found' });
  const amount = 0.4;
  c.volumeUsed += amount;
  c.dailyUsed += amount;
  c.usageHistory.push({ date: new Date().toISOString(), amount });
  if (c.usageHistory.length > 50) c.usageHistory = c.usageHistory.slice(-50);
  saveDB();
  res.json({ ok: true, config: c });
});

app.delete('/api/configs/:id', authRequired, (req, res) => {
  const list = configsArrayFor(req);
  const idx = list.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'not_found' });
  list.splice(idx, 1);
  saveDB();
  res.json({ ok: true });
});

// ---------- Public subscription endpoint ----------
function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = Math.floor(Math.log(bytes) / Math.log(1024));
  i = Math.min(Math.max(i, 0), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return (i === 0 ? value : value.toFixed(2)) + ' ' + units[i];
}

function findConfigBySubId(subId) {
  const inAdmin = db.adminConfigs.find(c => c.subId === subId);
  if (inAdmin) return inAdmin;
  for (const u of db.users) {
    const match = (u.configs || []).find(c => c.subId === subId);
    if (match) return match;
  }
  return null;
}

app.get('/api/sub/:subId', (req, res) => {
  const found = findConfigBySubId(req.params.subId);
  if (!found) return res.json({ found: false, rendered: false });

  const GIB = 1024 * 1024 * 1024;
  const totalByte = found.volume === -1 ? 0 : Math.round(found.volume * GIB);
  const downloadByte = Math.round((found.volumeUsed || 0) * GIB);
  const uploadByte = 0;
  const remainedByte = totalByte > 0 ? Math.max(totalByte - downloadByte - uploadByte, 0) : 0;
  const expireSeconds = found.expireDate ? Math.floor(new Date(found.expireDate).getTime() / 1000) : 0;

  let lastOnlineMs = 0;
  if (found.usageHistory && found.usageHistory.length) {
    const last = found.usageHistory[found.usageHistory.length - 1];
    const t = last && last.date ? new Date(last.date).getTime() : NaN;
    lastOnlineMs = isNaN(t) ? 0 : t;
  }

  const subUrl = req.protocol + '://' + req.get('host') + '/sub.html?sub=' + req.params.subId;

  res.json({
    found: true,
    rendered: true,
    sId: req.params.subId,
    enabled: !!found.isActive,
    download: formatBytes(downloadByte),
    upload: formatBytes(uploadByte),
    total: formatBytes(totalByte),
    used: formatBytes(downloadByte + uploadByte),
    remained: formatBytes(remainedByte),
    expire: expireSeconds,
    lastOnline: lastOnlineMs,
    downloadByte,
    uploadByte,
    totalByte,
    subUrl,
    subJsonUrl: '',
    subClashUrl: '',
    subTitle: 'PUG62',
    subSupportUrl: '',
    datepicker: 'gregorian',
    links: found.configText ? [found.configText] : [],
    configName: found.name || ''
  });
});

// ---------- Admin: Telegram bot configuration ----------
app.get('/api/admin/bot', adminOnly, (req, res) => {
  res.json({
    ownerId: db.bot.ownerId || '',
    token: db.bot.token || '',
    channels: db.bot.channels || [],
    active: !!db.bot.active
  });
});

app.post('/api/admin/bot', adminOnly, (req, res) => {
  const { ownerId, token, channels } = req.body || {};
  if (!ownerId || !token) return res.status(400).json({ error: 'missing_fields' });
  db.bot.ownerId = String(ownerId).trim();
  db.bot.token = String(token).trim();
  db.bot.channels = Array.isArray(channels)
    ? channels.map(c => String(c).trim()).filter(Boolean)
    : String(channels || '').split(/\r?\n|,/).map(c => c.trim()).filter(Boolean);
  saveDB();
  res.json({ ok: true });
});

app.post('/api/admin/bot/start', adminOnly, async (req, res) => {
  if (!db.bot.token || !db.bot.ownerId) {
    return res.status(400).json({ error: 'not_configured' });
  }
  try {
    await startTelegramBot();
    db.bot.active = true;
    saveDB();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'start_failed', message: String((err && err.message) || err) });
  }
});

app.post('/api/admin/bot/stop', adminOnly, (req, res) => {
  stopTelegramBot();
  db.bot.active = false;
  saveDB();
  res.json({ ok: true });
});

// =====================================================================
// ================        TELEGRAM BOT MODULE        ================
// =====================================================================

let botInstance = null;
let botUsername = '';
let renewalCheckTimer = null;
const ownerSession = {};

function stopTelegramBot() {
  if (botInstance) {
    try { botInstance.stopPolling(); } catch (e) { /* ignore */ }
    botInstance = null;
  }
  if (renewalCheckTimer) {
    clearInterval(renewalCheckTimer);
    renewalCheckTimer = null;
  }
}

async function startTelegramBot() {
  stopTelegramBot();

  let TelegramBot;
  try {
    TelegramBot = require('node-telegram-bot-api');
  } catch (e) {
    throw new Error('پکیج node-telegram-bot-api نصب نیست.');
  }

  const bot = new TelegramBot(db.bot.token, { polling: true });
  botInstance = bot;

  bot.on('polling_error', (err) => {
    console.error('Telegram polling error:', err && err.message ? err.message : err);
  });

  try {
    const me = await bot.getMe();
    botUsername = me.username || '';
  } catch (e) {
    botUsername = '';
  }

  const ownerIdStr = () => String(db.bot.ownerId || '');
  const isOwner = (tgId) => String(tgId) === ownerIdStr();

  function nameOf(u) {
    return (u.firstName || 'کاربر') + (u.username ? ' (@' + u.username + ')' : '');
  }

  function getBotUser(tgId, from) {
    const key = String(tgId);
    if (!db.bot.users[key]) {
      db.bot.users[key] = {
        id: key,
        username: (from && from.username) || null,
        firstName: (from && from.first_name) || '',
        coins: 0,
        referredBy: null,
        pendingReferral: null,
        referrals: [],
        joinedChannels: false,
        panels: [],
        banned: false,
        banUntil: null,
        banPermanent: false,
        banReason: null,
        banHistory: [],
        state: null,
        createdAt: Date.now()
      };
      saveDB();
    } else if (from) {
      let changed = false;
      if (from.username !== undefined && db.bot.users[key].username !== from.username) {
        db.bot.users[key].username = from.username || null;
        changed = true;
      }
      if (from.first_name && db.bot.users[key].firstName !== from.first_name) {
        db.bot.users[key].firstName = from.first_name;
        changed = true;
      }
      if (changed) saveDB();
    }
    return db.bot.users[key];
  }

  function isBanned(u) {
    if (!u.banned) return false;
    if (u.banPermanent) return true;
    if (u.banUntil && Date.now() < u.banUntil) return true;
    u.banned = false;
    u.banUntil = null;
    u.banPermanent = false;
    saveDB();
    return false;
  }

  function banMessageText(u) {
    const duration = u.banPermanent
      ? 'نامحدود ♾'
      : Math.max(0, Math.ceil((u.banUntil - Date.now()) / 86400000)) + ' روز';
    return '🚫 شما از ربات مسدود شدید.\n\n📝 دلیل: ' + (u.banReason || 'نامشخص') +
      '\n⏳ مدت: ' + duration +
      '\n\n💬 برای پیگیری با پشتیبانی در ارتباط باشید.';
  }

  async function checkChannels(tgId) {
    if (!db.bot.channels || !db.bot.channels.length) return true;
    for (const ch of db.bot.channels) {
      try {
        const member = await bot.getChatMember(ch, tgId);
        if (!['member', 'administrator', 'creator'].includes(member.status)) return false;
      } catch (e) {
        return false;
      }
    }
    return true;
  }

  function channelsKeyboard() {
    const rows = (db.bot.channels || []).map((ch) => {
      const handle = String(ch).replace('@', '');
      return [{ text: '📢 ' + ch, url: 'https://t.me/' + handle }];
    });
    rows.push([{ text: '✅ عضو شدم', callback_data: 'check_join' }]);
    return { inline_keyboard: rows };
  }

  function mainMenuKeyboard(tgId) {
    const rows = [
      [{ text: '🎁 زیرمجموعه‌گیری', callback_data: 'referral' }, { text: '🛡 دریافت پنل وایرگارد', callback_data: 'get_panel' }],
      [{ text: '📂 پنل‌های من', callback_data: 'my_panels' }, { text: '👤 اطلاعات کاربری', callback_data: 'user_info' }],
      [{ text: '🆘 پشتیبانی', callback_data: 'support' }]
    ];
    if (isOwner(tgId)) rows.push([{ text: '👑 پنل مدیریت', callback_data: 'owner_menu' }]);
    return { inline_keyboard: rows };
  }

  async function sendWelcome(chatId, tgId) {
    await bot.sendMessage(
      chatId,
      '🎉 خوش اومدی به ربات PUG62!\n\nاز دکمه‌های زیر استفاده کن 👇',
      { reply_markup: mainMenuKeyboard(tgId) }
    );
  }

  async function grantReferralCoin(u, tgId) {
    if (u.pendingReferral && db.bot.users[u.pendingReferral]) {
      const inviter = db.bot.users[u.pendingReferral];
      if (!inviter.referrals.includes(tgId)) {
        inviter.referrals.push(tgId);
        inviter.coins = (inviter.coins || 0) + 1;
        bot.sendMessage(inviter.id, '🎉 یک نفر با لینک شما وارد ربات شد و عضو کانال‌ها هم شد!\n🪙 ۱ سکه به حسابت اضافه شد.').catch(() => {});
      }
      u.pendingReferral = null;
      saveDB();
    }
  }

  // ================= NEW: Transfer coins function (unlimited for owner) =================
  async function transferCoins(chatId, targetId, amount) {
    const target = db.bot.users[targetId];
    if (!target) {
      return bot.sendMessage(chatId, '❌ کاربر مورد نظر پیدا نشد.');
    }
    
    if (!amount || amount <= 0) {
      return bot.sendMessage(chatId, '❌ مقدار باید بیشتر از 0 باشد.');
    }
    
    // Owner has unlimited coins, just add to user
    target.coins = (target.coins || 0) + amount;
    saveDB();
    
    // Send message to user
    await bot.sendMessage(
      target.id, 
      `🎁 شما ${amount} سکه از طرف مدیریت دریافت کردید!\n🪙 سکه جدید شما: ${target.coins}`
    ).catch(() => {});
    
    // Send confirmation to owner
    await bot.sendMessage(
      chatId, 
      `✅ ${amount} سکه با موفقیت به کاربر ${target.firstName || targetId} منتقل شد.\n🪙 سکه جدید کاربر: ${target.coins}`
    );
  }

  // ---------------- /start ----------------
  bot.onText(/\/start(?:\s+(.+))?/, async (msg, match) => {
    const tgId = String(msg.from.id);
    const chatId = msg.chat.id;
    const u = getBotUser(tgId, msg.from);

    if (isBanned(u)) return bot.sendMessage(chatId, banMessageText(u));

    const payload = match && match[1];
    if (payload && payload.indexOf('ref_') === 0 && !u.referredBy && !u.joinedChannels) {
      const inviterId = payload.slice(4);
      if (inviterId !== tgId && db.bot.users[inviterId]) {
        u.referredBy = inviterId;
        u.pendingReferral = inviterId;
        saveDB();
      }
    }

    const joined = await checkChannels(tgId);
    if (!joined) {
      return bot.sendMessage(chatId, '📢 برای استفاده از ربات اول باید عضو کانال‌(های) زیر بشی، بعد دکمه «عضو شدم» رو بزن:', { reply_markup: channelsKeyboard() });
    }

    if (!u.joinedChannels) {
      u.joinedChannels = true;
      saveDB();
      await grantReferralCoin(u, tgId);
    }

    await sendWelcome(chatId, tgId);
  });

  // ---------------- callback buttons ----------------
  bot.on('callback_query', async (query) => {
    const tgId = String(query.from.id);
    const chatId = query.message.chat.id;
    const data = query.data || '';
    const u = getBotUser(tgId, query.from);

    try {
      if (isBanned(u)) {
        await bot.answerCallbackQuery(query.id);
        return bot.sendMessage(chatId, banMessageText(u));
      }

      // ---- forced-join re-check ----
      if (data === 'check_join') {
        const joined = await checkChannels(tgId);
        await bot.answerCallbackQuery(query.id, { text: joined ? '✅ عضویت تایید شد' : '❌ هنوز عضو همه کانال‌ها نیستی' });
        if (!joined) return;
        if (!u.joinedChannels) {
          u.joinedChannels = true;
          saveDB();
          await grantReferralCoin(u, tgId);
        }
        return sendWelcome(chatId, tgId);
      }

      await bot.answerCallbackQuery(query.id);

      // ---- referral ----
      if (data === 'referral') {
        const link = 'https://t.me/' + botUsername + '?start=ref_' + tgId;
        return bot.sendMessage(chatId,
          '🎁 لینک اختصاصی زیرمجموعه‌گیری شما:\n' + link +
          '\n\n🪙 سکه فعلی: ' + (u.coins || 0) +
          '\n👥 تعداد زیرمجموعه: ' + u.referrals.length + ' نفر' +
          '\n\nهر کسی با این لینک وارد ربات بشه و عضو کانال‌ها هم بشه، ۱ سکه بهت اضافه می‌شه. 🪙\n\n' +
          '💡 هزینه دریافت پنل: هر ۱ روز = ۰.۵ سکه (مثلاً پنل ۱۰ روزه = ۵ سکه)'
        );
      }

      // ---- user info ----
      if (data === 'user_info') {
        return bot.sendMessage(chatId,
          '👤 اطلاعات شما\n\n' +
          '🏷 نام: ' + (u.firstName || '-') +
          '\n🔗 یوزرنیم تلگرام: ' + (u.username ? '@' + u.username : 'ندارد') +
          '\n🪙 سکه: ' + (u.coins || 0) +
          '\n👥 زیرمجموعه: ' + u.referrals.length + ' نفر' +
          '\n📂 پنل‌های دریافتی: ' + u.panels.length + ' عدد'
        );
      }

      // ---- my panels ----
      if (data === 'my_panels') {
        if (!u.panels.length) {
          return bot.sendMessage(chatId, '📭 هنوز هیچ پنلی دریافت نکردی.\nاز دکمه «دریافت پنل وایرگارد» استفاده کن.');
        }
        const lines = u.panels.map((p) => {
          const acct = db.users.find((x) => x.id === p.userId);
          if (!acct) return '📦 ' + p.username + ' — ❌ حذف شده';
          const left = daysLeftOf(acct.expireAt);
          return '📦 ' + p.username + ' — ' + (left > 0 ? left + ' روز مونده' : '⛔ منقضی شده') + (acct.isActive ? '' : ' (غیرفعال)');
        });
        return bot.sendMessage(chatId, '📂 پنل‌های شما:\n\n' + lines.join('\n'));
      }

      // ---- support ----
      if (data === 'support') {
        u.state = { action: 'awaiting_support_message' };
        saveDB();
        return bot.sendMessage(chatId, '✍️ پیامت رو بنویس، مستقیم برای پشتیبانی ارسال می‌شه:');
      }

      // ---- get panel: choose duration ----
      if (data === 'get_panel') {
        return bot.sendMessage(chatId, '🛡 برای چند روز پنل می‌خوای؟\n(هر ۱ روز = ۰.۵ سکه)', {
          reply_markup: {
            inline_keyboard: [
              [{ text: '📅 10 روز — 🪙 5 سکه', callback_data: 'panel_days_10' }],
              [{ text: '📅 20 روز — 🪙 10 سکه', callback_data: 'panel_days_20' }],
              [{ text: '📅 30 روز — 🪙 15 سکه', callback_data: 'panel_days_30' }],
              [{ text: '✏️ روز دلخواه (بیشتر از 30 روز)', callback_data: 'panel_custom' }]
            ]
          }
        });
      }

      const presetMatch = data.match(/^panel_days_(\d+)$/);
      if (presetMatch) {
        const days = Number(presetMatch[1]);
        return beginPanelPurchase(chatId, u, days);
      }

      if (data === 'panel_custom') {
        u.state = { action: 'awaiting_custom_days' };
        saveDB();
        return bot.sendMessage(chatId, '🔢 چند روز می‌خوای؟ (باید بیشتر از 30 روز باشه)');
      }

      // ---- renew reminder button ----
      const renewMatch = data.match(/^renew_(.+)$/);
      if (renewMatch) {
        const userId = renewMatch[1];
        const result = extendLicenseUser(userId, 10);
        if (result.error) return bot.sendMessage(chatId, '❌ این پنل دیگه پیدا نشد (شاید حذف شده).');
        const left = daysLeftOf(result.expireAt);
        return bot.sendMessage(chatId, '✅ پنل شما ۱۰ روز تمدید شد! الان ' + left + ' روز اعتبار داره. 🎉');
      }

      // ================= OWNER-ONLY MENUS =================
      if (!isOwner(tgId)) return;

      if (data === 'owner_menu') return sendOwnerMenu(chatId);
      if (data === 'owner_stats') return sendOwnerStats(chatId);
      if (data === 'owner_users_list') return sendUsersListPage(chatId, buildAllBotUserIds(), 0);
      if (data === 'owner_banned_list') return sendUsersListPage(chatId, buildBannedBotUserIds(), 0, true);
      if (data === 'owner_ban_history') return sendBanHistory(chatId, 0);

      let m;
      if ((m = data.match(/^ulpage_(\d+)$/))) return sendUsersListPage(chatId, buildAllBotUserIds(), Number(m[1]));
      if ((m = data.match(/^blpage_(\d+)$/))) return sendUsersListPage(chatId, buildBannedBotUserIds(), Number(m[1]), true);
      if ((m = data.match(/^bhpage_(\d+)$/))) return sendBanHistory(chatId, Number(m[1]));

      if ((m = data.match(/^ownuser_(.+)$/))) return sendUserProfile(chatId, m[1]);

      // ================= NEW: Transfer coins handlers =================
      if ((m = data.match(/^transfer_coins_(.+)$/))) {
        const targetId = m[1];
        ownerSession.pendingTransfer = { targetId };
        return bot.sendMessage(
          chatId, 
          '💰 چند سکه می‌خواید به این کاربر بدید؟\n(عدد را وارد کنید - شما به عنوان مالک سکه نامحدود دارید)'
        );
      }

      // Quick transfer buttons
      if ((m = data.match(/^transfer_quick_(.+)_(\d+)$/))) {
        const targetId = m[1];
        const amount = parseInt(m[2], 10);
        await transferCoins(chatId, targetId, amount);
        return;
      }

      if ((m = data.match(/^ban_start_(.+)$/))) {
        const targetId = m[1];
        return bot.sendMessage(chatId, 'مدت بن؟', {
          reply_markup: {
            inline_keyboard: [
              [{ text: '♾ نامحدود', callback_data: 'ban_perm_' + targetId }],
              [{ text: '📅 چند روزه', callback_data: 'ban_days_' + targetId }]
            ]
          }
        });
      }

      if ((m = data.match(/^ban_perm_(.+)$/))) {
        ownerSession.pendingBan = { targetId: m[1], permanent: true };
        return bot.sendMessage(chatId, '📝 دلیل بن رو بنویس:');
      }

      if ((m = data.match(/^ban_days_(.+)$/))) {
        ownerSession.pendingBan = { targetId: m[1], permanent: false, awaitingDays: true };
        return bot.sendMessage(chatId, '🔢 چند روز بن بشه؟');
      }

      if (data === 'ban_confirm_yes') {
        const pending = ownerSession.pendingBanConfirm;
        if (!pending) return;
        const target = db.bot.users[pending.targetId];
        if (target) {
          target.banned = true;
          target.banPermanent = pending.permanent;
          target.banUntil = pending.permanent ? null : Date.now() + pending.days * 86400000;
          target.banReason = pending.reason;
          target.banHistory.push({
            reason: pending.reason,
            days: pending.permanent ? 'permanent' : pending.days,
            bannedAt: Date.now(),
            unbannedAt: null
          });
          saveDB();
          bot.sendMessage(target.id, banMessageText(target)).catch(() => {});
          bot.sendMessage(chatId, '✅ کاربر بن شد.');
        }
        ownerSession.pendingBanConfirm = null;
        return;
      }

      if (data === 'ban_confirm_no') {
        ownerSession.pendingBanConfirm = null;
        ownerSession.pendingBan = null;
        return bot.sendMessage(chatId, '❌ بن‌کردن لغو شد.');
      }

      if ((m = data.match(/^unban_(.+)$/))) {
        const target = db.bot.users[m[1]];
        if (target) {
          target.banned = false;
          target.banPermanent = false;
          target.banUntil = null;
          const last = target.banHistory[target.banHistory.length - 1];
          if (last && !last.unbannedAt) last.unbannedAt = Date.now();
          saveDB();
          bot.sendMessage(target.id, '✅ بن شما برداشته شد، خوش اومدی دوباره! 🎉').catch(() => {});
          bot.sendMessage(chatId, '✅ کاربر آزاد شد.');
        }
        return;
      }

      if ((m = data.match(/^msguser_(.+)$/))) {
        ownerSession.pendingMessageTarget = m[1];
        return bot.sendMessage(chatId, '✍️ متن پیام رو بنویس تا برای کاربر ارسال بشه:');
      }

      if (data === 'owner_search') {
        ownerSession.searching = true;
        return bot.sendMessage(chatId, '🔎 اسم یا یوزرنیم مورد نظر رو بفرست:');
      }
    } catch (err) {
      console.error('bot callback_query error:', err);
    }
  });

  async function beginPanelPurchase(chatId, u, days) {
    const cost = Math.ceil(days * 0.5);
    if ((u.coins || 0) < cost) {
      return bot.sendMessage(chatId,
        '❌ سکه کافی نداری!\n🪙 سکه فعلی: ' + (u.coins || 0) + '\n💰 سکه لازم: ' + cost +
        '\n\nاز دکمه «زیرمجموعه‌گیری» برای گرفتن سکه بیشتر استفاده کن.'
      );
    }
    u.state = { action: 'awaiting_username', days, cost };
    saveDB();
    return bot.sendMessage(chatId, '👤 یک نام کاربری برای پنلت بفرست (فقط حروف/عدد انگلیسی، بدون فاصله):');
  }

  // ---------------- plain text messages ----------------
  bot.on('message', async (msg) => {
    if (!msg.text || msg.text.indexOf('/start') === 0) return;
    const tgId = String(msg.from.id);
    const chatId = msg.chat.id;
    const text = msg.text.trim();

    // Owner replying to a forwarded support message
    if (isOwner(tgId) && msg.reply_to_message) {
      const targetId = db.bot.supportReplyMap[msg.reply_to_message.message_id];
      if (targetId) {
        bot.sendMessage(targetId, '💬 پاسخ پشتیبانی:\n' + text).catch(() => {});
        return bot.sendMessage(chatId, '✅ پیام برای کاربر ارسال شد.');
      }
    }

    // Owner in the middle of messaging a specific user
    if (isOwner(tgId) && ownerSession.pendingMessageTarget) {
      const targetId = ownerSession.pendingMessageTarget;
      ownerSession.pendingMessageTarget = null;
      bot.sendMessage(targetId, '📩 پیام از پشتیبانی:\n' + text).catch(() => {});
      return bot.sendMessage(chatId, '✅ پیام ارسال شد.');
    }

    // ================= NEW: Owner transferring coins =================
    if (isOwner(tgId) && ownerSession.pendingTransfer) {
      const amount = parseInt(text, 10);
      if (!amount || amount <= 0) {
        return bot.sendMessage(chatId, '❌ لطفاً یک عدد معتبر (بزرگتر از 0) وارد کنید.');
      }
      
      const targetId = ownerSession.pendingTransfer.targetId;
      ownerSession.pendingTransfer = null;
      await transferCoins(chatId, targetId, amount);
      return;
    }

    // Owner ban flow: entering number of days
    if (isOwner(tgId) && ownerSession.pendingBan && ownerSession.pendingBan.awaitingDays) {
      const days = parseInt(text, 10);
      if (!days || days <= 0) return bot.sendMessage(chatId, '❌ یه عدد معتبر بفرست (مثلاً 3):');
      ownerSession.pendingBan.days = days;
      ownerSession.pendingBan.awaitingDays = false;
      return bot.sendMessage(chatId, '📝 حالا دلیل بن رو بنویس:');
    }

    // Owner ban flow: entering the reason
    if (isOwner(tgId) && ownerSession.pendingBan && !ownerSession.pendingBan.awaitingDays) {
      const pending = ownerSession.pendingBan;
      pending.reason = text;
      ownerSession.pendingBanConfirm = pending;
      ownerSession.pendingBan = null;
      const target = db.bot.users[pending.targetId];
      return bot.sendMessage(chatId,
        '⚠️ مطمئنی می‌خوای ' + (target ? nameOf(target) : pending.targetId) + ' رو بن کنی؟\n' +
        '⏳ مدت: ' + (pending.permanent ? 'نامحدود' : pending.days + ' روز') +
        '\n📝 دلیل: ' + pending.reason,
        { reply_markup: { inline_keyboard: [[{ text: '✅ بله', callback_data: 'ban_confirm_yes' }, { text: '❌ خیر', callback_data: 'ban_confirm_no' }]] } }
      );
    }

    // Owner searching the user list
    if (isOwner(tgId) && ownerSession.searching) {
      ownerSession.searching = false;
      const query = text.toLowerCase().replace('@', '');
      const matches = Object.values(db.bot.users).filter((bu) =>
        (bu.username && bu.username.toLowerCase().includes(query)) ||
        (bu.firstName && bu.firstName.toLowerCase().includes(query))
      );
      if (!matches.length) return bot.sendMessage(chatId, '❌ کسی با این مشخصات پیدا نشد.');
      return sendUsersListPage(chatId, matches.map((x) => x.id), 0);
    }

    const u = getBotUser(tgId, msg.from);
    if (isBanned(u)) return bot.sendMessage(chatId, banMessageText(u));
    if (!u.state) return;

    // ---- support message from a regular user ----
    if (u.state.action === 'awaiting_support_message') {
      u.state = null;
      saveDB();
      try {
        const sent = await bot.sendMessage(ownerIdStr(),
          '🆘 پیام پشتیبانی از ' + nameOf(u) + ' (آیدی: ' + tgId + '):\n\n' + text
        );
        db.bot.supportReplyMap[sent.message_id] = tgId;
        saveDB();
        return bot.sendMessage(chatId, '✅ پیامت برای پشتیبانی ارسال شد، منتظر پاسخ باش.');
      } catch (e) {
        return bot.sendMessage(chatId, '❌ ارسال پیام با خطا مواجه شد، بعداً دوباره امتحان کن.');
      }
    }

    // ---- custom day count ----
    if (u.state.action === 'awaiting_custom_days') {
      const days = parseInt(text, 10);
      if (!days || days <= 30) {
        return bot.sendMessage(chatId, '❌ باید بیشتر از 30 روز باشه. یه عدد دیگه بفرست:');
      }
      return beginPanelPurchase(chatId, u, days);
    }

    // ---- choosing a panel username ----
    if (u.state.action === 'awaiting_username') {
      if (!/^[a-zA-Z0-9_]{3,20}$/.test(text)) {
        return bot.sendMessage(chatId, '❌ نام کاربری باید فقط حروف/عدد انگلیسی و بین 3 تا 20 کاراکتر باشه. دوباره بفرست:');
      }
      if (text === ADMIN_USERNAME || db.users.some((x) => x.username === text)) {
        return bot.sendMessage(chatId, '❌ این نام کاربری قبلاً استفاده شده. یه اسم دیگه بفرست:');
      }
      u.state.username = text;
      u.state.action = 'awaiting_password';
      saveDB();
      return bot.sendMessage(chatId, '🔑 حالا یک رمز عبور بفرست (حداقل 4 کاراکتر):');
    }

    // ---- choosing a panel password -> issue the panel ----
    if (u.state.action === 'awaiting_password') {
      if (text.length < 4) {
        return bot.sendMessage(chatId, '❌ رمز باید حداقل 4 کاراکتر باشه. دوباره بفرست:');
      }
      const state = u.state;
      const created = createLicenseUser(state.username, text, state.days);
      if (created.error) {
        u.state = null;
        saveDB();
        return bot.sendMessage(chatId, '❌ مشکلی پیش اومد (' + created.error + ')، دوباره از اول از دکمه «دریافت پنل وایرگارد» شروع کن.');
      }
      u.coins = (u.coins || 0) - state.cost;
      u.panels.push({ userId: created.id, username: state.username, days: state.days, createdAt: Date.now(), expireAt: created.expireAt });
      u.state = null;
      saveDB();

      await bot.sendMessage(chatId,
        '✅ پنلت با موفقیت ساخته شد! 🎉\n\n' +
        '🔗 لینک پنل: ' + PANEL_URL +
        '\n👤 یوزرنیم: ' + state.username +
        '\n🔑 رمز عبور: ' + text +
        '\n📅 اعتبار: ' + state.days + ' روز' +
        '\n\n⚠️ این پنل رو نفروش، در غیر این صورت از ربات بن می‌شی.'
      );

      bot.sendMessage(ownerIdStr(),
        '📥 کاربر ' + nameOf(u) + ' (آیدی: ' + tgId + ') یک پنل ' + state.days + ' روزه دریافت کرد.\n👤 یوزرنیم پنل: ' + state.username
      ).catch(() => {});
      return;
    }
  });

  // ================= Owner menu senders =================
  function sendOwnerMenu(chatId) {
    return bot.sendMessage(
      chatId, 
      '👑 پنل مدیریت ربات\n\n' +
      '🪙 وضعیت سکه شما: **نامحدود** ♾️\n' +
      'شما می‌توانید به هر کاربری هر مقدار سکه که می‌خواید بدید.',
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '📊 وضعیت ربات', callback_data: 'owner_stats' }],
            [{ text: '👥 لیست کاربران', callback_data: 'owner_users_list' }, { text: '🔎 جستجو', callback_data: 'owner_search' }],
            [{ text: '🔒 بن‌شده‌ها', callback_data: 'owner_banned_list' }],
            [{ text: '🗂 بن‌های قبلی', callback_data: 'owner_ban_history' }]
          ]
        }
      }
    );
  }

  function sendOwnerStats(chatId) {
    const all = Object.values(db.bot.users);
    const total = all.length;
    const joined = all.filter((x) => x.joinedChannels).length;
    const gotPanel = all.filter((x) => x.panels && x.panels.length).length;
    const bannedNow = all.filter((x) => isBanned(x)).length;
    
    return bot.sendMessage(chatId,
      '📊 وضعیت ربات\n\n' +
      '👥 کل کاربران: ' + total + ' نفر' +
      '\n✅ عضو کانال‌ها: ' + joined + ' نفر' +
      '\n📦 دریافت‌کننده‌ی پنل: ' + gotPanel + ' نفر' +
      '\n🚫 بن‌شده الان: ' + bannedNow + ' نفر' +
      '\n🪙 شما به عنوان مالک سکه نامحدود دارید ♾️'
    );
  }

  function buildAllBotUserIds() {
    return Object.keys(db.bot.users).sort((a, b) => db.bot.users[b].createdAt - db.bot.users[a].createdAt);
  }

  function buildBannedBotUserIds() {
    return buildAllBotUserIds().filter((id) => isBanned(db.bot.users[id]));
  }

  const PAGE_SIZE = 8;

  function sendUsersListPage(chatId, ids, page, isBannedList) {
    const totalPages = Math.max(1, Math.ceil(ids.length / PAGE_SIZE));
    page = Math.max(0, Math.min(page, totalPages - 1));
    const pageIds = ids.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

    if (!ids.length) {
      return bot.sendMessage(chatId, isBannedList ? '✅ هیچ کاربر بن‌شده‌ای وجود نداره.' : '📭 هنوز کسی ربات رو استارت نکرده.');
    }

    const rows = pageIds.map((id) => {
      const bu = db.bot.users[id];
      const label = (bu.firstName || 'کاربر') + (bu.username ? ' (@' + bu.username + ')' : ' (' + id + ')');
      return [{ text: (isBanned(bu) ? '🚫 ' : '') + label, callback_data: 'ownuser_' + id }];
    });

    const navRow = [];
    const pagePrefix = isBannedList ? 'blpage_' : 'ulpage_';
    if (page > 0) navRow.push({ text: '◀️ قبلی', callback_data: pagePrefix + (page - 1) });
    navRow.push({ text: '📄 ' + (page + 1) + '/' + totalPages, callback_data: 'noop' });
    if (page < totalPages - 1) navRow.push({ text: 'بعدی ▶️', callback_data: pagePrefix + (page + 1) });
    rows.push(navRow);

    return bot.sendMessage(chatId, isBannedList ? '🔒 کاربران بن‌شده:' : '👥 لیست کاربران ربات:', { reply_markup: { inline_keyboard: rows } });
  }

  function sendUserProfile(chatId, targetId) {
    const bu = db.bot.users[targetId];
    if (!bu) return bot.sendMessage(chatId, '❌ کاربر پیدا نشد.');
    const banned = isBanned(bu);
    const text =
      '👤 ' + (bu.firstName || 'کاربر') +
      '\n🆔 آیدی: ' + bu.id +
      '\n🔗 یوزرنیم: ' + (bu.username ? '@' + bu.username : 'ندارد') +
      '\n🪙 سکه: ' + (bu.coins || 0) +
      '\n👥 زیرمجموعه: ' + bu.referrals.length + ' نفر' +
      '\n📂 پنل‌های دریافتی: ' + bu.panels.length + ' عدد' +
      '\n🚦 وضعیت: ' + (banned ? '🚫 بن (' + (bu.banPermanent ? 'نامحدود' : Math.max(0, Math.ceil((bu.banUntil - Date.now()) / 86400000)) + ' روز مونده') + ')' : '✅ آزاد');

    const rows = [];
    if (banned) rows.push([{ text: '✅ رفع بن', callback_data: 'unban_' + bu.id }]);
    else rows.push([{ text: '🚫 بن کردن', callback_data: 'ban_start_' + bu.id }]);
    rows.push([{ text: '✉️ ارسال پیام', callback_data: 'msguser_' + bu.id }]);
    
    // NEW: Transfer coins buttons
    rows.push([
      { text: '💰 10 سکه', callback_data: 'transfer_quick_' + bu.id + '_10' },
      { text: '💰 50 سکه', callback_data: 'transfer_quick_' + bu.id + '_50' },
      { text: '💰 100 سکه', callback_data: 'transfer_quick_' + bu.id + '_100' }
    ]);
    rows.push([{ text: '💰 انتقال دلخواه', callback_data: 'transfer_coins_' + bu.id }]);

    return bot.sendMessage(chatId, text, { reply_markup: { inline_keyboard: rows } });
  }

  function sendBanHistory(chatId, page) {
    const entries = [];
    Object.values(db.bot.users).forEach((bu) => {
      (bu.banHistory || []).forEach((h) => {
        entries.push({ user: bu, entry: h });
      });
    });
    entries.sort((a, b) => b.entry.bannedAt - a.entry.bannedAt);

    if (!entries.length) return bot.sendMessage(chatId, '📭 تا الان هیچ بنی ثبت نشده.');

    const PAGE = 5;
    const totalPages = Math.max(1, Math.ceil(entries.length / PAGE));
    page = Math.max(0, Math.min(page, totalPages - 1));
    const slice = entries.slice(page * PAGE, page * PAGE + PAGE);

    const lines = slice.map(({ user, entry }) => {
      const date = new Date(entry.bannedAt).toLocaleDateString('fa-IR');
      const status = entry.unbannedAt ? '✅ رفع‌شده' : '🚫 فعال';
      return '👤 ' + nameOf(user) + '\n📝 دلیل: ' + entry.reason + '\n⏳ مدت: ' + (entry.days === 'permanent' ? 'نامحدود' : entry.days + ' روز') + '\n📅 تاریخ: ' + date + '\n📌 وضعیت: ' + status;
    });

    const navRow = [];
    if (page > 0) navRow.push({ text: '◀️ قبلی', callback_data: 'bhpage_' + (page - 1) });
    navRow.push({ text: '📄 ' + (page + 1) + '/' + totalPages, callback_data: 'noop' });
    if (page < totalPages - 1) navRow.push({ text: 'بعدی ▶️', callback_data: 'bhpage_' + (page + 1) });

    return bot.sendMessage(chatId, '🗂 تاریخچه بن‌ها:\n\n' + lines.join('\n\n'), { reply_markup: { inline_keyboard: [navRow] } });
  }

  // ---------------- renewal reminders ----------------
  renewalCheckTimer = setInterval(() => {
    try {
      Object.values(db.bot.users).forEach((bu) => {
        (bu.panels || []).forEach((p) => {
          const acct = db.users.find((x) => x.id === p.userId);
          if (!acct || !acct.isActive) return;
          const left = daysLeftOf(acct.expireAt);
          if (left <= 3 && left >= 0 && p.lastNotifiedDay !== left) {
            p.lastNotifiedDay = left;
            saveDB();
            bot.sendMessage(bu.id,
              '⏳ پنل «' + p.username + '» فقط ' + left + ' روز دیگه اعتبار داره!\nبرای تمدید از دکمه زیر استفاده کن 👇',
              { reply_markup: { inline_keyboard: [[{ text: '🔄 تمدید (+۱۰ روز)', callback_data: 'renew_' + p.userId }]] } }
            ).catch(() => {});
          }
        });
      });
    } catch (e) {
      console.error('renewal check error:', e);
    }
  }, 30 * 60 * 1000);

  console.log('Telegram bot started. Username: @' + botUsername);
}

// Auto-start the bot on boot if it was previously active
if (db.bot && db.bot.active && db.bot.token && db.bot.ownerId) {
  startTelegramBot().catch((err) => {
    console.error('Failed to auto-start Telegram bot:', err.message || err);
  });
}

app.listen(PORT, () => {
  console.log('PUG62 WireGuard panel is running on port ' + PORT);
});
