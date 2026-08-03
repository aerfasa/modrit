const express = require('express');
const { Telegraf } = require('telegraf');
const db = require('./lib/db');
const { startBot } = require('./bot');

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
  <p>حالا ربات را به گروه خود اضافه کنید و به عنوان ادمین تنظیم کنید (حداقل با دسترسی حذف پیام، مسدود کردن کاربران و پین کردن).</p>
  <p>برای مشاهده امکانات داخل گروه دستور <b>/panel</b> را بفرستید.</p>
  <form method="GET" action="/reconfigure"><button type="submit" style="background:#777">تغییر توکن / مالک</button></form>
  </div></body></html>`;
}

async function tryAutoStart() {
  let cfg = db.getConfig();
  if (!cfg && process.env.BOT_TOKEN && process.env.OWNER_ID) {
    cfg = { token: process.env.BOT_TOKEN, ownerId: process.env.OWNER_ID };
    db.saveConfig(cfg);
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

app.get('/', (req, res) => {
  if (status.running) return res.send(renderStatus());
  res.send(renderSetupForm(status.error));
});

app.get('/reconfigure', (req, res) => {
  status = { running: false, error: null, botUsername: null };
  res.send(renderSetupForm(null));
});

app.post('/setup', async (req, res) => {
  const { token, ownerId } = req.body;
  if (!token || !ownerId) return res.send(renderSetupForm('لطفاً هر دو مقدار را وارد کنید.'));
  try {
    const testBot = new Telegraf(token);
    const me = await testBot.telegram.getMe();
    db.saveConfig({ token, ownerId });
    const bot = await startBot(token, ownerId);
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
