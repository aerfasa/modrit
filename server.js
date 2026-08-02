const express = require('express');
const { exec } = require('child_process');
const util = require('util');
const fs = require('fs');
const path = require('path');

const execPromise = util.promisify(exec);
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 3000;
const LOG_FILE = path.join(__dirname, 'bot.log');
if (fs.existsSync(LOG_FILE)) fs.writeFileSync(LOG_FILE, '');

// ================= کد ربات V2Ray =================
const v2rayCode = String.raw`
import telebot
from telebot.types import InlineKeyboardMarkup, InlineKeyboardButton
import requests, sqlite3, time, threading, os, logging, qrcode
from io import BytesIO
from datetime import datetime

TOKEN = "__TOKEN__"
ADMIN_ID = __OWNER__
CHANNEL_ID = "pug62" 
CHANNEL_URL = "https://t.me/pug62"

V2RAY_URLS = ["https://raw.githubusercontent.com/salehhamze/Sub/main/all", "https://raw.githubusercontent.com/yebekhe/TVC/main/subscriptions/xray/normal/mix", "https://raw.githubusercontent.com/mahdibland/V2RayAggregator/master/Eternity"]
PROXY_URLS = ["https://raw.githubusercontent.com/hookzof/socks5_list/master/tg/mtproto.json", "https://raw.githubusercontent.com/MhdiTaheri/ProxyCollector/main/proxy.txt"]
ITEMS_PER_PAGE, CACHE_TIME, SPAM_THRESHOLD = 5, 300, 2

logging.basicConfig(format='%(asctime)s - %(levelname)s - %(message)s', level=logging.INFO)
bot = telebot.TeleBot(TOKEN, parse_mode="Markdown")

class Database:
    def __init__(self):
        self.conn = sqlite3.connect("bot_data.db", check_same_thread=False)
        self.cur = self.conn.cursor()
        self.cur.execute("CREATE TABLE IF NOT EXISTS users (user_id INTEGER PRIMARY KEY, username TEXT)")
        self.conn.commit()
    def add_user(self, uid, uname):
        self.cur.execute("INSERT OR IGNORE INTO users VALUES (?,?)", (uid, uname))
        self.conn.commit()
    def get_all_users(self): return [r[0] for r in self.cur.execute("SELECT user_id FROM users").fetchall()]
    def get_stats(self): return {"users": self.cur.execute("SELECT COUNT(*) FROM users").fetchone()[0]}
db = Database()

class ContentManager:
    def __init__(self): self.v2ray, self.proxy, self.last, self.lock = [], [], 0, threading.Lock()
    def fetch(self):
        with self.lock:
            if time.time() - self.last < CACHE_TIME and self.v2ray: return
            v, p = [], []
            for u in V2RAY_URLS:
                try:
                    r = requests.get(u, timeout=10).text.splitlines()
                    v.extend([l for l in r if l.startswith(('vmess://','vless://','trojan://','ss://'))])
                except: pass
            for u in PROXY_URLS:
                try:
                    r = requests.get(u, timeout=10)
                    if u.endswith('.json'): p.extend([f"tg://proxy?server={x['server']}&port={x['port']}&secret={x['secret']}" for x in r.json() if 'server' in x])
                    else: p.extend([l for l in r.text.splitlines() if l.startswith('tg://proxy')])
                except: pass
            self.v2ray, self.proxy, self.last = list(set(v)), list(set(p)), time.time()
    def get_v2ray(self, p=1): self.fetch(); s=(p-1)*ITEMS_PER_PAGE; return self.v2ray[s:s+ITEMS_PER_PAGE], len(self.v2ray)
    def get_proxy(self, p=1): self.fetch(); s=(p-1)*ITEMS_PER_PAGE; return self.proxy[s:s+ITEMS_PER_PAGE], len(self.proxy)
    def get_all(self): self.fetch(); return "\n".join(self.v2ray)
cm = ContentManager()
spam = {}

def check_join(uid):
    if str(uid) == str(ADMIN_ID): return True
    try: return bot.get_chat_member(f"@{CHANNEL_ID}", uid).status in ['creator','administrator','member']
    except: return True

@bot.message_handler(commands=['start'])
def start(msg):
    db.add_user(msg.from_user.id, msg.from_user.username)
    if not check_join(msg.from_user.id):
        kb = InlineKeyboardMarkup().add(InlineKeyboardButton("عضویت 📢", url=CHANNEL_URL)).add(InlineKeyboardButton("عضو شدم ✅", callback_data="check"))
        return bot.send_message(msg.chat.id, "⚠️ لطفا عضو شوید:", reply_markup=kb)
    kb = InlineKeyboardMarkup(row_width=2).add(InlineKeyboardButton("🚀 V2Ray", callback_data="v_1"), InlineKeyboardButton("📡 پروکسی", callback_data="p_1")).add(InlineKeyboardButton("📥 دانلود فایل", callback_data="dl"), InlineKeyboardButton("📊 آمار", callback_data="st"))
    bot.send_message(msg.chat.id, f"👋 سلام {msg.from_user.first_name}!\nبه ربات V2Ray خوش آمدید.", reply_markup=kb)

@bot.callback_query_handler(func=lambda c: True)
def cb(c):
    if time.time() - spam.get(c.from_user.id, 0) < SPAM_THRESHOLD: return bot.answer_callback_query(c.id, "⛔️ اسپم نکنید!", show_alert=True)
    spam[c.from_user.id] = time.time()
    if c.data == "check":
        if check_join(c.from_user.id): bot.answer_callback_query(c.id, "✅ تایید شد"); start(c.message)
        else: bot.answer_callback_query(c.id, "❌ هنوز عضو نیستید!", show_alert=True)
    elif c.data == "st": bot.answer_callback_query(c.id, f"👥 کاربران: {db.get_stats()['users']}\n☁️ کانفیگ: {len(cm.v2ray)}\n🔐 پروکسی: {len(cm.proxy)}", show_alert=True)
    elif c.data == "dl":
        bio = BytesIO(cm.get_all().encode('utf-8')); bio.name = "v2ray.txt"
        bot.send_document(c.message.chat.id, bio, caption="📦 پک کامل کانفیگ‌ها")
    elif c.data.startswith("v_"):
        pg = int(c.data.split("_")[1]); cfgs, tot = cm.get_v2ray(pg)
        if not cfgs: return bot.answer_callback_query(c.id, "❌ خالی است", show_alert=True)
        txt = f"☁️ **صفحه {pg}**\n\n" + "\n".join([f"{i+1}. \`{x}\`" for i,x in enumerate(cfgs)])
        kb = InlineKeyboardMarkup(row_width=3)
        if pg>1: kb.add(InlineKeyboardButton("⬅️", callback_data=f"v_{pg-1}"))
        kb.add(InlineKeyboardButton(f"{pg}/{(tot+4)//5}", callback_data="x"))
        if pg<(tot+4)//5: kb.add(InlineKeyboardButton("➡️", callback_data=f"v_{pg+1}"))
        kb.add(InlineKeyboardButton("🏠 بازگشت", callback_data="home"))
        try: bot.edit_message_text(txt, c.message.chat.id, c.message.message_id, parse_mode="Markdown", reply_markup=kb)
        except: pass
    elif c.data.startswith("p_"):
        pg = int(c.data.split("_")[1]); prxs, tot = cm.get_proxy(pg)
        if not prxs: return bot.answer_callback_query(c.id, "❌ خالی است", show_alert=True)
        kb = InlineKeyboardMarkup(row_width=2)
        kb.add(*[InlineKeyboardButton(f"پروکسی {i+1}", url=x) for i,x in enumerate(prxs)])
        nav = InlineKeyboardMarkup(row_width=3)
        if pg>1: nav.add(InlineKeyboardButton("⬅️", callback_data=f"p_{pg-1}"))
        nav.add(InlineKeyboardButton(f"{pg}/{(tot+4)//5}", callback_data="x"))
        if pg<(tot+4)//5: nav.add(InlineKeyboardButton("➡️", callback_data=f"p_{pg+1}"))
        nav.add(InlineKeyboardButton("🏠 بازگشت", callback_data="home"))
        kb.keyboard.extend(nav.keyboard)
        try: bot.edit_message_text(f"📡 **پروکسی‌ها (صفحه {pg})**", c.message.chat.id, c.message.message_id, reply_markup=kb)
        except: pass
    elif c.data == "home": start(c.message)

@bot.message_handler(commands=['admin'])
def admin(msg):
    if str(msg.from_user.id) == str(ADMIN_ID): bot.reply_to(msg, "🕴 پنل مدیریت فعال است.")

@bot.message_handler(func=lambda m: m.text and m.text.startswith(('vmess://','vless://','trojan://')))
def qr(msg):
    img = qrcode.make(msg.text)
    bio = BytesIO(); img.save(bio, 'PNG'); bio.seek(0)
    bot.send_photo(msg.chat.id, bio, caption="📱 QR Code شما", reply_to_message_id=msg.message_id)

threading.Thread(target=cm.fetch).start()
bot.infinity_polling()
`;

// ================= کد ربات مدیریت سرور =================
const managerCode = String.raw`
import os, sys, sqlite3, subprocess, signal, logging, time
from datetime import datetime
from typing import Dict
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.constants import ParseMode, ChatAction
from telegram.ext import Application, CommandHandler, MessageHandler, CallbackQueryHandler, ContextTypes, filters

BOT_TOKEN = "__TOKEN__"
OWNER_ID = __OWNER__
DB_FILE = "real_manager.db"
BASE_DIR = os.getcwd()
MAX_OUTPUT = 3800
logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")

class Database:
    def __init__(self):
        self.conn = sqlite3.connect(DB_FILE, check_same_thread=False)
        self.cur = self.conn.cursor()
        self.cur.execute("CREATE TABLE IF NOT EXISTS admins (user_id INTEGER PRIMARY KEY)")
        self.cur.execute("CREATE TABLE IF NOT EXISTS processes (name TEXT PRIMARY KEY, pid INTEGER, path TEXT)")
        self.cur.execute("INSERT OR IGNORE INTO admins VALUES (?)", (OWNER_ID,))
        self.conn.commit()
    def is_admin(self, uid): return self.cur.execute("SELECT 1 FROM admins WHERE user_id=?", (uid,)).fetchone() is not None
    def admins(self): return [i[0] for i in self.cur.execute("SELECT user_id FROM admins").fetchall()]
    def save_process(self, name, pid, path): self.cur.execute("REPLACE INTO processes VALUES (?,?,?)", (name, pid, path)); self.conn.commit()
    def remove_process(self, name): self.cur.execute("DELETE FROM processes WHERE name=?", (name,)); self.conn.commit()
    def processes(self): return self.cur.execute("SELECT name,pid,path FROM processes").fetchall()
db = Database()

def admin_only(func):
    async def wrapper(update: Update, context: ContextTypes.DEFAULT_TYPE):
        if not db.is_admin(update.effective_user.id): return
        return await func(update, context)
    return wrapper

def run_shell(cmd: str) -> str:
    try:
        r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=12, cwd=BASE_DIR)
        out = (r.stdout + r.stderr).strip()
        return out[:MAX_OUTPUT] if out else "OK"
    except Exception as e: return str(e)

class ProcessManager:
    def __init__(self): self.running: Dict[str, subprocess.Popen] = {}
    def start_python(self, path: str):
        if not os.path.isfile(path): return "❌ File not found"
        name = os.path.basename(path)
        if name in self.running and self.running[name].poll() is None: return "⚠️ Already running"
        p = subprocess.Popen([sys.executable, path], stdout=open(f"{name}.out.log", "w"), stderr=open(f"{name}.err.log", "w"), preexec_fn=os.setsid, cwd=os.path.dirname(path) or BASE_DIR)
        self.running[name] = p; db.save_process(name, p.pid, path)
        return f"✅ Started\nPID: {p.pid}"
    def stop(self, name: str):
        if name not in self.running: return "❌ Not running"
        try: os.killpg(os.getpgid(self.running[name].pid), signal.SIGTERM)
        except: pass
        db.remove_process(name); del self.running[name]; return "🛑 Stopped"
proc = ProcessManager()
TERMINAL_USERS = set()

def main_keyboard():
    return InlineKeyboardMarkup([[InlineKeyboardButton("🖥 Terminal", callback_data="terminal")], [InlineKeyboardButton("📂 Files", callback_data="files")], [InlineKeyboardButton("⚙️ Processes", callback_data="processes")], [InlineKeyboardButton("👥 Admins", callback_data="admins")], [InlineKeyboardButton("🔄 Refresh", callback_data="refresh")]])

@admin_only
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    text = f"🖥 **Real Server Manager**\n\n📁 Base Dir:\n\`{BASE_DIR}\`\n\n✅ Real Terminal\n✅ Real Python Runner\n"
    if update.callback_query: await update.callback_query.message.edit_text(text, parse_mode=ParseMode.MARKDOWN, reply_markup=main_keyboard())
    else: await update.message.reply_text(text, parse_mode=ParseMode.MARKDOWN, reply_markup=main_keyboard())

@admin_only
async def terminal_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    TERMINAL_USERS.add(update.effective_user.id)
    await update.callback_query.message.reply_text("🖥 **Terminal ON**\nSend any shell command\n/cancel to exit", parse_mode=ParseMode.MARKDOWN)

@admin_only
async def terminal_exec(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.effective_user.id not in TERMINAL_USERS: return
    cmd = update.message.text.strip()
    if cmd == "/cancel": TERMINAL_USERS.discard(update.effective_user.id); await update.message.reply_text("❎ Terminal closed"); return
    await context.bot.send_chat_action(update.effective_chat.id, ChatAction.TYPING)
    await update.message.reply_text(f"\`\`\`\n{run_shell(cmd)}\n\`\`\`", parse_mode=ParseMode.MARKDOWN)

@admin_only
async def files(update: Update, context: ContextTypes.DEFAULT_TYPE):
    items = os.listdir(BASE_DIR); text = "📂 **Files**\n\n"; kb = []
    for f in items[:25]:
        text += f"• \`{f}\`\n"
        if f.endswith(".py"): kb.append([InlineKeyboardButton(f"▶️ Run {f}", callback_data=f"run:{f}")])
    kb.append([InlineKeyboardButton("🔙 Back", callback_data="refresh")])
    await update.callback_query.message.edit_text(text, parse_mode=ParseMode.MARKDOWN, reply_markup=InlineKeyboardMarkup(kb))

@admin_only
async def run_python(update: Update, context: ContextTypes.DEFAULT_TYPE):
    file = update.callback_query.data.split(":", 1)[1]
    await update.callback_query.answer(proc.start_python(os.path.join(BASE_DIR, file)), show_alert=True)

@admin_only
async def processes(update: Update, context: ContextTypes.DEFAULT_TYPE):
    rows = db.processes(); text = "⚙️ **Processes**\n\n"; kb = []
    if not rows: text += "_No running process_\n"
    for name, pid, path in rows:
        text += f"• \`{name}\` PID \`{pid}\`\n"; kb.append([InlineKeyboardButton(f"🛑 Stop {name}", callback_data=f"stop:{name}")])
    kb.append([InlineKeyboardButton("🔙 Back", callback_data="refresh")])
    await update.callback_query.message.edit_text(text, parse_mode=ParseMode.MARKDOWN, reply_markup=InlineKeyboardMarkup(kb))

@admin_only
async def stop_process(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.callback_query.answer(proc.stop(update.callback_query.data.split(":", 1)[1]), show_alert=True)

@admin_only
async def admins(update: Update, context: ContextTypes.DEFAULT_TYPE):
    text = "👥 **Admins**\n\n" + "\n".join([f"• \`{a}\`" for a in db.admins()])
    await update.callback_query.message.edit_text(text, parse_mode=ParseMode.MARKDOWN, reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("🔙 Back", callback_data="refresh")]]))

def main():
    app = Application.builder().token(BOT_TOKEN).build()
    app.add_handler(CommandHandler("start", start))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, terminal_exec))
    app.add_handler(CallbackQueryHandler(terminal_start, pattern="^terminal$"))
    app.add_handler(CallbackQueryHandler(files, pattern="^files$"))
    app.add_handler(CallbackQueryHandler(processes, pattern="^processes$"))
    app.add_handler(CallbackQueryHandler(admins, pattern="^admins$"))
    app.add_handler(CallbackQueryHandler(run_python, pattern="^run:"))
    app.add_handler(CallbackQueryHandler(stop_process, pattern="^stop:"))
    app.add_handler(CallbackQueryHandler(start, pattern="^refresh$"))
    app.run_polling()

if __name__ == "__main__": main()
`;

// ================= سرور وب و رابط کاربری =================
app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>پنل نصب ربات‌های تلگرام</title>
  <link href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;700;900&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Vazirmatn', sans-serif; background: #05030f; color: #fff; min-height: 100vh; display: flex; align-items: center; justify-content: center; overflow: hidden; }
    .aurora { position: fixed; inset: 0; z-index: 0; pointer-events: none; background: radial-gradient(circle at 30% 30%, rgba(124,58,237,.4), transparent 50%), radial-gradient(circle at 70% 70%, rgba(6,182,212,.3), transparent 50%); filter: blur(100px); }
    .grid-bg { position: fixed; inset: 0; z-index: 0; pointer-events: none; opacity: .1; background-image: linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px); background-size: 40px 40px; }
    .container { position: relative; z-index: 1; width: min(500px, 90%); background: rgba(255,255,255,.05); backdrop-filter: blur(20px); border: 1px solid rgba(255,255,255,.1); border-radius: 24px; padding: 40px; box-shadow: 0 25px 50px rgba(0,0,0,.5); text-align: center; }
    h1 { font-size: 28px; font-weight: 900; margin-bottom: 10px; background: linear-gradient(135deg, #c4b5fd, #67e8f9); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    p { color: #9ca3af; margin-bottom: 30px; font-size: 14px; }
    .input { width: 100%; background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.1); border-radius: 14px; padding: 15px; color: #fff; font-family: inherit; font-size: 15px; margin-bottom: 15px; outline: none; transition: .3s; text-align: left; direction: ltr; }
    select.input { direction: rtl; text-align: right; cursor: pointer; }
    .input:focus { border-color: #7c3aed; box-shadow: 0 0 0 3px rgba(124,58,237,.2); }
    .btn { width: 100%; padding: 16px; border: none; border-radius: 14px; background: linear-gradient(90deg, #7c3aed, #ec4899); color: #fff; font-family: inherit; font-weight: 800; font-size: 16px; cursor: pointer; transition: .3s; margin-top: 10px; }
    .btn:hover { transform: translateY(-2px); box-shadow: 0 10px 25px rgba(124,58,237,.4); }
    .btn:disabled { opacity: .5; cursor: not-allowed; transform: none; }
    .terminal { margin-top: 30px; background: #000; border: 1px solid #333; border-radius: 12px; padding: 15px; height: 200px; overflow-y: auto; text-align: left; direction: ltr; font-family: monospace; font-size: 12px; color: #10b981; display: none; }
    .status { margin-top: 15px; font-weight: 700; font-size: 14px; display: none; }
  </style>
</head>
<body>
  <div class="aurora"></div>
  <div class="grid-bg"></div>
  <div class="container">
    <h1>🤖 پنل نصب ربات‌های تلگرام</h1>
    <p>نوع ربات را انتخاب کرده و توکن و آیدی عددی خود را وارد کنید.</p>
    <form id="installForm">
      <select id="botType" class="input" required>
        <option value="">-- انتخاب نوع ربات --</option>
        <option value="v2ray">🚀 ربات V2Ray و پروکسی</option>
        <option value="manager">🖥 ربات مدیریت سرور (Terminal)</option>
      </select>
      <input type="text" id="token" class="input" placeholder="Bot Token (123456:ABC...)" required>
      <input type="text" id="ownerId" class="input" placeholder="Admin ID (123456789)" required>
      <button type="submit" class="btn" id="submitBtn">نصب و راه‌اندازی ربات 🚀</button>
    </form>
    <div id="status" class="status"></div>
    <div id="terminal" class="terminal"></div>
  </div>
  <script>
    const form = document.getElementById('installForm');
    const status = document.getElementById('status');
    const terminal = document.getElementById('terminal');
    const btn = document.getElementById('submitBtn');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      btn.disabled = true; btn.textContent = 'در حال نصب... لطفا صبر کنید';
      status.style.display = 'block'; terminal.style.display = 'block';
      terminal.innerHTML = '> Starting installation process...\\n';
      status.textContent = 'در حال دانلود پیش‌نیازها و ساخت ربات...'; status.style.color = '#f59e0b';
      try {
        const res = await fetch('/install', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ botType: document.getElementById('botType').value, token: document.getElementById('token').value, ownerId: document.getElementById('ownerId').value }) });
        const data = await res.json();
        if (res.ok) { status.textContent = '✅ ' + data.message; status.style.color = '#10b981'; terminal.innerHTML += '> ' + data.message + '\\n'; startLogPolling(); } 
        else { status.textContent = '❌ خطا در نصب!'; status.style.color = '#ef4444'; terminal.innerHTML += '> Error: ' + data.message + '\\n'; btn.disabled = false; btn.textContent = 'تلاش مجدد 🔄'; }
      } catch (err) { status.textContent = '❌ خطای شبکه!'; status.style.color = '#ef4444'; btn.disabled = false; btn.textContent = 'تلاش مجدد 🔄'; }
    });
    function startLogPolling() { setInterval(async () => { try { const res = await fetch('/logs'); const text = await res.text(); terminal.innerHTML = text.replace(/\\n/g, '<br>'); terminal.scrollTop = terminal.scrollHeight; } catch (e) {} }, 2000); }
  </script>
</body>
</html>
  `);
});

// ================= منطق نصب =================
app.post('/install', async (req, res) => {
  const { botType, token, ownerId } = req.body;
  if (!botType || !token || !ownerId) return res.status(400).json({ message: 'اطلاعات ناقص است.' });

  try {
    const dir = path.join(__dirname, botType === 'v2ray' ? 'v2ray_bot' : 'manager_bot');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);

    // توقف ربات‌های قبلی برای جلوگیری از تداخل
    await execPromise('npx pm2 delete all || true');
    fs.writeFileSync(LOG_FILE, '');

    if (botType === 'v2ray') {
      fs.writeFileSync(path.join(dir, 'requirements.txt'), 'pyTelegramBotAPI\nrequests\nqrcode\nPillow');
      fs.writeFileSync(path.join(dir, 'bot.py'), v2rayCode.replace('__TOKEN__', token).replace('__OWNER__', ownerId));
    } else {
      fs.writeFileSync(path.join(dir, 'requirements.txt'), 'python-telegram-bot>=20.0');
      fs.writeFileSync(path.join(dir, 'bot.py'), managerCode.replace('__TOKEN__', token).replace('__OWNER__', ownerId));
    }

    // نصب پیش‌نیازها
    await execPromise(`pip3 install --no-cache-dir -r requirements.txt`, { cwd: dir });

    // اجرای ربات با PM2
    await execPromise(`npx pm2 start bot.py --interpreter python3 --name ${botType}-bot --output ${LOG_FILE} --error ${LOG_FILE}`, { cwd: dir });

    res.json({ success: true, message: `ربات ${botType === 'v2ray' ? 'V2Ray' : 'مدیریت سرور'} با موفقیت نصب و روشن شد.` });
  } catch (error) {
    fs.appendFileSync(LOG_FILE, '\n' + error.message + '\n');
    res.status(500).json({ success: false, message: error.message });
  }
});

app.get('/logs', (req, res) => {
  if (fs.existsSync(LOG_FILE)) res.type('text/plain').send(fs.readFileSync(LOG_FILE, 'utf8'));
  else res.send('No logs yet.');
});

app.listen(PORT, () => console.log('Dual Bot Installer running on port ' + PORT));
