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
const BOT_DIR = path.join(__dirname, 'target_bot');
const LOG_FILE = path.join(__dirname, 'bot.log');

if (fs.existsSync(LOG_FILE)) fs.writeFileSync(LOG_FILE, '');

// --- کد کامل ربات پایتون شما ---
const pythonCodeTemplate = String.raw`# -*- coding: utf-8 -*-
import telebot
from telebot.types import InlineKeyboardMarkup, InlineKeyboardButton
import requests
import sqlite3
import time
import threading
import os
import json
import logging
import qrcode
from io import BytesIO
from datetime import datetime

TOKEN = "__BOT_TOKEN__"
ADMIN_ID = __ADMIN_ID__
CHANNEL_ID = "pug62" 
CHANNEL_URL = f"https://t.me/pug62"

V2RAY_URLS = [
    "https://raw.githubusercontent.com/salehhamze/Sub/main/all",
    "https://raw.githubusercontent.com/yebekhe/TVC/main/subscriptions/xray/normal/mix",
    "https://raw.githubusercontent.com/mahdibland/V2RayAggregator/master/Eternity"
]

PROXY_URLS = [
    "https://raw.githubusercontent.com/hookzof/socks5_list/master/tg/mtproto.json",
    "https://raw.githubusercontent.com/MhdiTaheri/ProxyCollector/main/proxy.txt"
]

ITEMS_PER_PAGE = 5
CACHE_TIME = 300
SPAM_THRESHOLD = 2

logging.basicConfig(format='%(asctime)s - %(name)s - %(levelname)s - %(message)s', level=logging.INFO)
logger = logging.getLogger(__name__)
bot = telebot.TeleBot(TOKEN, parse_mode="Markdown")

class Database:
    def __init__(self, db_name="bot_data.db"):
        self.conn = sqlite3.connect(db_name, check_same_thread=False)
        self.cursor = self.conn.cursor()
        self.create_tables()
    def create_tables(self):
        self.cursor.execute("CREATE TABLE IF NOT EXISTS users (user_id INTEGER PRIMARY KEY, username TEXT, join_date TEXT, last_interaction TEXT)")
        self.cursor.execute("CREATE TABLE IF NOT EXISTS stats (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT, count INTEGER DEFAULT 0)")
        self.conn.commit()
    def add_user(self, user_id, username):
        date = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        try:
            self.cursor.execute("INSERT OR IGNORE INTO users (user_id, username, join_date, last_interaction) VALUES (?, ?, ?, ?)", (user_id, username, date, date))
            self.update_interaction(user_id)
            self.conn.commit()
        except Exception as e: logger.error(f"DB Error: {e}")
    def update_interaction(self, user_id):
        date = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        self.cursor.execute("UPDATE users SET last_interaction = ? WHERE user_id = ?", (date, user_id))
        self.conn.commit()
    def get_all_users(self):
        self.cursor.execute("SELECT user_id FROM users")
        return [row[0] for row in self.cursor.fetchall()]
    def get_stats(self):
        self.cursor.execute("SELECT COUNT(*) FROM users")
        return {"users": self.cursor.fetchone()[0]}

db = Database()

class ContentManager:
    def __init__(self):
        self.v2ray_cache = []
        self.proxy_cache = []
        self.last_update = 0
        self.lock = threading.Lock()
    def fetch_data(self):
        with self.lock:
            if time.time() - self.last_update < CACHE_TIME and self.v2ray_cache: return
            logger.info("Updating caches...")
            new_v2ray = []
            for url in V2RAY_URLS:
                try:
                    resp = requests.get(url, timeout=10)
                    if resp.status_code == 200:
                        for line in resp.text.splitlines():
                            if line.startswith(('vmess://', 'vless://', 'trojan://', 'ss://')): new_v2ray.append(line.strip())
                except Exception as e: logger.error(f"Error fetching V2Ray: {e}")
            new_proxies = []
            for url in PROXY_URLS:
                try:
                    resp = requests.get(url, timeout=10)
                    if resp.status_code == 200:
                        if url.endswith('.json'):
                            for p in resp.json():
                                if 'server' in p and 'port' in p and 'secret' in p: new_proxies.append(f"tg://proxy?server={p['server']}&port={p['port']}&secret={p['secret']}")
                        else:
                            for line in resp.text.splitlines():
                                if line.startswith('tg://proxy'): new_proxies.append(line.strip())
                except Exception as e: logger.error(f"Error fetching Proxy: {e}")
            self.v2ray_cache = list(set(new_v2ray))
            self.proxy_cache = list(set(new_proxies))
            self.last_update = time.time()
            logger.info(f"Cache Updated: {len(self.v2ray_cache)} V2Ray, {len(self.proxy_cache)} Proxies")
    def get_v2ray(self, page=1):
        self.fetch_data()
        start = (page - 1) * ITEMS_PER_PAGE
        return self.v2ray_cache[start:start+ITEMS_PER_PAGE], len(self.v2ray_cache)
    def get_proxies(self, page=1):
        self.fetch_data()
        start = (page - 1) * ITEMS_PER_PAGE
        return self.proxy_cache[start:start+ITEMS_PER_PAGE], len(self.proxy_cache)
    def get_all_v2ray_file(self):
        self.fetch_data()
        return "\n".join(self.v2ray_cache)

content_mgr = ContentManager()

class AntiSpam:
    def __init__(self): self.users = {}
    def is_spamming(self, user_id):
        now = time.time()
        if now - self.users.get(user_id, 0) < SPAM_THRESHOLD: return True
        self.users[user_id] = now
        return False

spam_checker = AntiSpam()

def check_join(user_id):
    if str(user_id) == str(ADMIN_ID): return True
    try:
        status = bot.get_chat_member(f"@{CHANNEL_ID}", user_id).status
        return status in ['creator', 'administrator', 'member']
    except Exception: return True

def generate_qr(data):
    qr = qrcode.QRCode(version=1, box_size=10, border=5)
    qr.add_data(data)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    bio = BytesIO()
    img.save(bio, 'PNG')
    bio.seek(0)
    return bio

def get_protocol_name(config):
    if config.startswith("vmess"): return "VMess ☁️"
    if config.startswith("vless"): return "VLess 🛡"
    if config.startswith("trojan"): return "Trojan 🐎"
    if config.startswith("ss"): return "Shadowsocks 👻"
    return "Config 📎"

def main_menu():
    markup = InlineKeyboardMarkup(row_width=2)
    markup.add(InlineKeyboardButton("🚀 کانفیگ V2Ray", callback_data="v2ray_1"), InlineKeyboardButton("📡 پروکسی تلگرام", callback_data="proxy_1"))
    markup.add(InlineKeyboardButton("📥 دانلود فایل کامل", callback_data="download_file"), InlineKeyboardButton("📊 وضعیت ربات", callback_data="bot_status"))
    markup.add(InlineKeyboardButton("حمایت از ما ❤️", url=CHANNEL_URL))
    return markup

def join_channel_kb():
    markup = InlineKeyboardMarkup()
    markup.add(InlineKeyboardButton("عضویت در کانال 📢", url=CHANNEL_URL))
    markup.add(InlineKeyboardButton("عضو شدم ✅", callback_data="check_join"))
    return markup

def pagination_kb(current_page, total_items, prefix):
    markup = InlineKeyboardMarkup(row_width=3)
    total_pages = (total_items + ITEMS_PER_PAGE - 1) // ITEMS_PER_PAGE
    btns = []
    if current_page > 1: btns.append(InlineKeyboardButton("⬅️ قبلی", callback_data=f"{prefix}_{current_page-1}"))
    btns.append(InlineKeyboardButton(f"{current_page}/{total_pages}", callback_data="noop"))
    if current_page < total_pages: btns.append(InlineKeyboardButton("بعدی ➡️", callback_data=f"{prefix}_{current_page+1}"))
    markup.add(*btns)
    markup.add(InlineKeyboardButton("🏠 بازگشت به خانه", callback_data="home"))
    return markup

@bot.message_handler(commands=['start'])
def send_welcome(message):
    db.add_user(message.from_user.id, message.from_user.username)
    if not check_join(message.from_user.id):
        bot.send_message(message.chat.id, "⚠️ برای استفاده از ربات لطفا در کانال ما عضو شوید:", reply_markup=join_channel_kb())
        return
    bot.send_message(message.chat.id, f"👋 سلام {message.from_user.first_name}!\n\nبه پیشرفته‌ترین ربات فیلترشکن خوش آمدید.\nلطفا یک گزینه را انتخاب کنید:", reply_markup=main_menu())

@bot.message_handler(commands=['admin'])
def admin_panel(message):
    if message.from_user.id != ADMIN_ID: return
    stats = db.get_stats()
    bot.send_message(message.chat.id, f"🕴 **پنل مدیریت**\n\n👤 تعداد کاربران: \`{stats['users']}\`\n💾 کش V2Ray: \`{len(content_mgr.v2ray_cache)}\`\n💾 کش Proxy: \`{len(content_mgr.proxy_cache)}\`\n\nبرای ارسال همگانی پیام، روی پیام مورد نظر ریپلای کن و بنویس \`/broadcast\`")

@bot.message_handler(commands=['broadcast'])
def broadcast_msg(message):
    if message.from_user.id != ADMIN_ID or not message.reply_to_message: return
    users = db.get_all_users()
    bot.reply_to(message, f"📢 شروع ارسال برای {len(users)} کاربر...")
    def send_thread():
        count = 0
        for uid in users:
            try: bot.copy_message(uid, message.chat.id, message.reply_to_message.message_id); count += 1; time.sleep(0.05)
            except: pass
        bot.send_message(ADMIN_ID, f"✅ ارسال همگانی تمام شد.\nتعداد موفق: {count}")
    threading.Thread(target=send_thread).start()

@bot.callback_query_handler(func=lambda call: True)
def callback_query(call):
    if spam_checker.is_spamming(call.from_user.id):
        bot.answer_callback_query(call.id, "⛔️ لطفا اسپم نکنید!", show_alert=True); return
    if call.data == "check_join":
        if check_join(call.from_user.id):
            bot.answer_callback_query(call.id, "✅ عضویت تایید شد.")
            bot.edit_message_text("✅ عضویت تایید شد. حالا از منو استفاده کنید:", call.message.chat.id, call.message.message_id, reply_markup=main_menu())
        else: bot.answer_callback_query(call.id, "❌ هنوز عضو نشده‌اید!", show_alert=True)
        return
    if not check_join(call.from_user.id):
        bot.delete_message(call.message.chat.id, call.message.message_id)
        bot.send_message(call.from_user.id, "⚠️ لطفا ابتدا در کانال عضو شوید:", reply_markup=join_channel_kb()); return

    if call.data == "home": bot.edit_message_text("🏠 منوی اصلی:", call.message.chat.id, call.message.message_id, reply_markup=main_menu())
    elif call.data == "bot_status":
        txt = f"📊 **وضعیت سرور ربات**\n\n🟢 وضعیت سرویس: آنلاین\n📡 پینگ: {round(time.time() % 1 * 100)}ms\n☁️ تعداد کانفیگ‌های فعال: {len(content_mgr.v2ray_cache)}\n🔐 تعداد پروکسی‌های فعال: {len(content_mgr.proxy_cache)}"
        bot.edit_message_text(txt, call.message.chat.id, call.message.message_id, reply_markup=pagination_kb(1, 1, "none"))
    elif call.data.startswith("v2ray_"):
        page = int(call.data.split("_")[1])
        configs, total = content_mgr.get_v2ray(page)
        if not configs: bot.answer_callback_query(call.id, "❌ کانفیگی یافت نشد!", show_alert=True); return
        text = f"☁️ **لیست کانفیگ‌های V2Ray (صفحه {page})**\n\n" + "\n".join([f"{i+1}. \`{cfg}\`\n🔹 {get_protocol_name(cfg)}\n➖➖➖➖➖➖" for i, cfg in enumerate(configs)]) + "\n\n⚠️ برای کپی روی کانفیگ کلیک کنید."
        try: bot.edit_message_text(text, call.message.chat.id, call.message.message_id, reply_markup=pagination_kb(page, total, "v2ray"))
        except: pass
    elif call.data.startswith("proxy_"):
        page = int(call.data.split("_")[1])
        proxies, total = content_mgr.get_proxies(page)
        if not proxies: bot.answer_callback_query(call.id, "❌ پروکسی یافت نشد!", show_alert=True); return
        markup = InlineKeyboardMarkup(row_width=2)
        markup.add(*[InlineKeyboardButton(f"اتصال به پروکسی {i+1} 🚀", url=p) for i, p in enumerate(proxies)])
        markup.keyboard.extend(pagination_kb(page, total, "proxy").keyboard)
        try: bot.edit_message_text(f"📡 **لیست پروکسی‌های تلگرام (صفحه {page})**\n\n", call.message.chat.id, call.message.message_id, reply_markup=markup)
        except: pass
    elif call.data == "download_file":
        all_configs = content_mgr.get_all_v2ray_file()
        if not all_configs: bot.answer_callback_query(call.id, "دیتایی وجود ندارد", show_alert=True); return
        bot.send_chat_action(call.message.chat.id, 'upload_document')
        bio = BytesIO(all_configs.encode('utf-8')); bio.name = "Configs_V2ray.txt"
        bot.send_document(call.message.chat.id, bio, caption=f"📦 **پک کامل کانفیگ‌ها**\n📅 تاریخ: {datetime.now().strftime('%Y-%m-%d')}\n🆔 @{CHANNEL_ID}")
    elif call.data == "noop": bot.answer_callback_query(call.id, f"صفحه {call.message.reply_markup.keyboard[0][1].text}")

@bot.message_handler(func=lambda m: m.text and m.text.startswith(('vmess://', 'vless://', 'trojan://')))
def convert_to_qr(message):
    if spam_checker.is_spamming(message.from_user.id): return
    bot.send_chat_action(message.chat.id, 'upload_photo')
    try: bot.send_photo(message.chat.id, generate_qr(message.text), caption="📱 **کد QR اختصاصی شما**", reply_to_message_id=message.message_id)
    except: bot.reply_to(message, "❌ خطا در ساخت QR Code")

def start_bot():
    threading.Thread(target=content_mgr.fetch_data).start()
    logger.info("Bot started successfully...")
    while True:
        try: bot.infinity_polling(timeout=10, long_polling_timeout=5)
        except Exception as e: logger.error(f"Polling Crash: {e}"); time.sleep(5)

if __name__ == "__main__":
    start_bot()
`;

// --- END PYTHON CODE ---

app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>نصب‌کننده ربات V2Ray</title>
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
    <h1>🚀 نصب‌کننده ربات V2Ray</h1>
    <p>توکن و آیدی عددی خود را وارد کنید تا ربات پایتون به صورت خودکار نصب و اجرا شود.</p>
    <form id="installForm">
      <input type="text" id="token" class="input" placeholder="Bot Token (123456:ABC...)" required>
      <input type="text" id="ownerId" class="input" placeholder="Admin ID (6732134123)" required>
      <button type="submit" class="btn" id="submitBtn">نصب و راه‌اندازی ربات 🤖</button>
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
      status.textContent = 'در حال ساخت و نصب ربات...'; status.style.color = '#f59e0b';
      try {
        const res = await fetch('/install', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: document.getElementById('token').value, ownerId: document.getElementById('ownerId').value }) });
        const data = await res.json();
        if (res.ok) { status.textContent = '✅ ربات با موفقیت نصب و اجرا شد!'; status.style.color = '#10b981'; terminal.innerHTML += '> ' + data.message + '\\n'; startLogPolling(); } 
        else { status.textContent = '❌ خطا در نصب!'; status.style.color = '#ef4444'; terminal.innerHTML += '> Error: ' + data.message + '\\n'; btn.disabled = false; btn.textContent = 'تلاش مجدد 🔄'; }
      } catch (err) { status.textContent = '❌ خطای شبکه!'; status.style.color = '#ef4444'; btn.disabled = false; btn.textContent = 'تلاش مجدد 🔄'; }
    });
    function startLogPolling() { setInterval(async () => { try { const res = await fetch('/logs'); const text = await res.text(); terminal.innerHTML = text.replace(/\\n/g, '<br>'); terminal.scrollTop = terminal.scrollHeight; } catch (e) {} }, 2000); }
  </script>
</body>
</html>
  `);
});

app.post('/install', async (req, res) => {
  const { token, ownerId } = req.body;
  if (!token || !ownerId) return res.status(400).json({ message: 'اطلاعات ناقص است.' });

  try {
    if (!fs.existsSync(BOT_DIR)) fs.mkdirSync(BOT_DIR);

    // 1. ساخت فایل requirements.txt برای نصب کتابخانه‌های پایتون
    const requirements = "pyTelegramBotAPI\nrequests\nqrcode\nPillow";
    fs.writeFileSync(path.join(BOT_DIR, 'requirements.txt'), requirements);

    // 2. جایگزینی توکن و آیدی در کد پایتون و ذخیره آن
    let finalPythonCode = pythonCodeTemplate
      .replace('__BOT_TOKEN__', token)
      .replace('__ADMIN_ID__', ownerId);
    
    fs.writeFileSync(path.join(BOT_DIR, 'bot.py'), finalPythonCode);

    // 3. نصب پیش‌نیازهای پایتون
    await execPromise('pip3 install -r requirements.txt', { cwd: BOT_DIR });

    // 4. نصب PM2 و اجرای ربات
    await execPromise('npm install pm2', { cwd: BOT_DIR });
    await execPromise(`npx pm2 start bot.py --interpreter python3 --name v2ray-bot --output ${LOG_FILE} --error ${LOG_FILE}`, { cwd: BOT_DIR });

    res.json({ success: true, message: 'ربات V2Ray با موفقیت ساخته و روشن شد.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.get('/logs', (req, res) => {
  if (fs.existsSync(LOG_FILE)) res.type('text/plain').send(fs.readFileSync(LOG_FILE, 'utf8'));
  else res.send('No logs yet.');
});

app.listen(PORT, () => console.log('V2Ray Installer Panel running on port ' + PORT));
