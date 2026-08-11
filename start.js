// PUG62 WireGuard Panel — backend server
// Serves the panel (public/index.html), the subscription page (public/sub.html),
// and a small JSON-file-backed API for auth, admin user management and configs.

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;

// ---------- Admin credentials ----------
// Set these in Railway → your project → Variables (ADMIN_USERNAME / ADMIN_PASSWORD)
// so the real login isn't sitting in your public GitHub source. If you don't set
// them, these two fall back to the defaults below.
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'arian';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'arian@11USER';

// ---------- Server catalogue (must match the panel's server list) ----------
const WG_SERVERS = {
  UAE: { ip: '0.0.0.0', port: 51820, country: 'United Arab Emirates', city: 'Dubai' },
  TR: { ip: '0.0.0.0', port: 51820, country: 'Turkey', city: 'Istanbul' },
  IR: { ip: '0.0.0.0', port: 51820, country: 'Iran', city: 'Tehran' }
};

const CONFIG_TEMPLATES = {
  UAE: `[Interface]
PrivateKey = aDi30cQATlyFXRlOmLzjK68vQxBe7kDYPisjB8Jg51A=
Address = 10.109.77.164/32
DNS = 1.1.1.1, 1.181.121.10
# Name: B11
# Region: \uD83C\uDDE6\uD83C\uDDEA\u0627\u0645\u0627\u0631\u0627\u062a
# VIP: Active

[Peer]
PublicKey = 3ArEYLg6wR6NYXrg4RTlI4kQmi5iX0z1ERpfKyxSxhk=
AllowedIPs = ::/0
Endpoint = 0.0.0.0:51820
PersistentKeepalive = 25`,
  TR: `[Interface]
PrivateKey = iKhR4GJ5wBstKxjkwUDHkMVUoMUL8lxTmql0iW2JTUE=
Address = 10.49.101.173/32
DNS = 1.1.1.1, 1.180.197.251
# Name: B12
# Region: \uD83C\uDDF9\uD83C\uDDF7\u062a\u0631\u06a9\u06cc\u0647
# VIP: Active

[Peer]
PublicKey = 8H3ovcm3xmFxfhmq5jV7aiza4itoynGgOu1tpL7jJEg=
AllowedIPs = ::/0
Endpoint = 0.0.0.0:51820
PersistentKeepalive = 25`,
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
    users: [],       // regular (customer) accounts created by the admin
    adminConfigs: [] // WireGuard configs created while logged in as the admin
  };
}

function loadDB() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    const db = freshDB();
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
    return db;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    if (!parsed.jwtSecret) parsed.jwtSecret = crypto.randomBytes(32).toString('hex');
    if (!Array.isArray(parsed.users)) parsed.users = [];
    if (!Array.isArray(parsed.adminConfigs)) parsed.adminConfigs = [];
    return parsed;
  } catch (e) {
    const db = freshDB();
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
    return db;
  }
}

let db = loadDB();
let saveTimer = null;
function saveDB() {
  // Debounce disk writes slightly so bursts of requests don't hammer the disk.
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  }, 50);
}

function genId(prefix) {
  return prefix + '_' + crypto.randomBytes(8).toString('hex');
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

function daysLeftOf(expireAt) {
  return Math.max(0, Math.ceil((expireAt - Date.now()) / 86400000));
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
  if (!username || !password || !days || Number(days) <= 0) {
    return res.status(400).json({ error: 'missing_fields' });
  }
  const cleanUsername = String(username).trim();
  if (cleanUsername === ADMIN_USERNAME || db.users.some(u => u.username === cleanUsername)) {
    return res.status(409).json({ error: 'username_taken' });
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
  res.json({
    id: user.id, username: user.username, createdAt: user.createdAt,
    expireAt: user.expireAt, daysLeft: daysLeftOf(user.expireAt), isActive: true, configsCount: 0
  });
});

app.post('/api/admin/users/:id/extend', adminOnly, (req, res) => {
  const user = db.users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'not_found' });
  const days = Number((req.body || {}).days);
  if (!days || days <= 0) return res.status(400).json({ error: 'invalid_days' });
  const base = Math.max(user.expireAt, Date.now());
  user.expireAt = base + days * 86400000;
  saveDB();
  res.json({ ok: true, expireAt: user.expireAt, daysLeft: daysLeftOf(user.expireAt) });
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

// ---------- Configs (scoped to the logged-in admin or user) ----------
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
  const amount = 0.4; // 400MB, matches the panel's "record usage" button
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

// ---------- Public subscription endpoint (no auth — powers sub.html) ----------
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

app.listen(PORT, () => {
  console.log('PUG62 WireGuard panel is running on port ' + PORT);
});
