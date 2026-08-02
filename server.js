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
const REPO_URL = 'https://github.com/nekooee/telegram-group-manager-bot.git';

// پاک کردن لاگ قبلی در هر بار استارت
if (fs.existsSync(LOG_FILE)) fs.writeFileSync(LOG_FILE, '');

app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>نصب‌کننده ربات مدیریت گروه</title>
  <link href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;700;900&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Vazirmatn', sans-serif;
      background: #05030f;
      color: #fff;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }
    .aurora {
      position: fixed; inset: 0; z-index: 0; pointer-events: none;
      background: radial-gradient(circle at 30% 30%, rgba(124,58,237,.4), transparent 50%),
                  radial-gradient(circle at 70% 70%, rgba(6,182,212,.3), transparent 50%);
      filter: blur(100px);
    }
    .grid-bg {
      position: fixed; inset: 0; z-index: 0; pointer-events: none; opacity: .1;
      background-image: linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px);
      background-size: 40px 40px;
    }
    .container {
      position: relative; z-index: 1;
      width: min(500px, 90%);
      background: rgba(255,255,255,.05);
      backdrop-filter: blur(20px);
      border: 1px solid rgba(255,255,255,.1);
      border-radius: 24px;
      padding: 40px;
      box-shadow: 0 25px 50px rgba(0,0,0,.5);
      text-align: center;
    }
    h1 {
      font-size: 28px;
      font-weight: 900;
      margin-bottom: 10px;
      background: linear-gradient(135deg, #c4b5fd, #67e8f9);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    p { color: #9ca3af; margin-bottom: 30px; font-size: 14px; }
    .input {
      width: 100%;
      background: rgba(255,255,255,.08);
      border: 1px solid rgba(255,255,255,.1);
      border-radius: 14px;
      padding: 15px;
      color: #fff;
      font-family: inherit;
      font-size: 15px;
      margin-bottom: 15px;
      outline: none;
      transition: .3s;
      text-align: left;
      direction: ltr;
    }
    .input:focus { border-color: #7c3aed; box-shadow: 0 0 0 3px rgba(124,58,237,.2); }
    .btn {
      width: 100%;
      padding: 16px;
      border: none;
      border-radius: 14px;
      background: linear-gradient(90deg, #7c3aed, #ec4899);
      color: #fff;
      font-family: inherit;
      font-weight: 800;
      font-size: 16px;
      cursor: pointer;
      transition: .3s;
      margin-top: 10px;
    }
    .btn:hover { transform: translateY(-2px); box-shadow: 0 10px 25px rgba(124,58,237,.4); }
    .btn:disabled { opacity: .5; cursor: not-allowed; transform: none; }
    .terminal {
      margin-top: 30px;
      background: #000;
      border: 1px solid #333;
      border-radius: 12px;
      padding: 15px;
      height: 200px;
      overflow-y: auto;
      text-align: left;
      direction: ltr;
      font-family: monospace;
      font-size: 12px;
      color: #10b981;
      display: none;
    }
    .status { margin-top: 15px; font-weight: 700; font-size: 14px; display: none; }
  </style>
</head>
<body>
  <div class="aurora"></div>
  <div class="grid-bg"></div>
  
  <div class="container">
    <h1>🤖 نصب‌کننده ربات مدیریت گروه</h1>
    <p>توکن و آیدی عددی خود را وارد کنید تا ربات به صورت خودکار نصب و اجرا شود.</p>
    
    <form id="installForm">
      <input type="text" id="token" class="input" placeholder="Bot Token (123456:ABC...)" required>
      <input type="text" id="ownerId" class="input" placeholder="Owner ID (123456789)" required>
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
      btn.disabled = true;
      btn.textContent = 'در حال نصب... لطفا صبر کنید';
      status.style.display = 'block';
      terminal.style.display = 'block';
      terminal.innerHTML = '> Starting installation process...\\n';
      status.textContent = 'در حال دانلود و نصب ربات...';
      status.style.color = '#f59e0b';

      try {
        const res = await fetch('/install', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token: document.getElementById('token').value,
            ownerId: document.getElementById('ownerId').value
          })
        });
        
        const data = await res.json();
        
        if (res.ok) {
          status.textContent = '✅ ربات با موفقیت نصب و اجرا شد!';
          status.style.color = '#10b981';
          terminal.innerHTML += '> ' + data.message + '\\n';
          startLogPolling();
        } else {
          status.textContent = '❌ خطا در نصب!';
          status.style.color = '#ef4444';
          terminal.innerHTML += '> Error: ' + data.message + '\\n';
          btn.disabled = false;
          btn.textContent = 'تلاش مجدد 🔄';
        }
      } catch (err) {
        status.textContent = '❌ خطای شبکه!';
        status.style.color = '#ef4444';
        btn.disabled = false;
        btn.textContent = 'تلاش مجدد 🔄';
      }
    });

    function startLogPolling() {
      setInterval(async () => {
        try {
          const res = await fetch('/logs');
          const text = await res.text();
          terminal.innerHTML = text.replace(/\\n/g, '<br>');
          terminal.scrollTop = terminal.scrollHeight;
        } catch (e) {}
      }, 2000);
    }
  </script>
</body>
</html>
  `);
});

app.post('/install', async (req, res) => {
  const { token, ownerId } = req.body;
  if (!token || !ownerId) return res.status(400).json({ message: 'اطلاعات ناقص است.' });

  try {
    // 1. Clone Repository
    if (!fs.existsSync(BOT_DIR)) {
      await execPromise(`git clone ${REPO_URL} ${BOT_DIR}`);
    }

    // 2. Install Dependencies
    await execPromise('npm install', { cwd: BOT_DIR });

    // 3. Create .env file (تنظیمات ربات)
    // Note: متغیرها بر اساس استاندارد ربات‌های تلگرام نوشته شده‌اند
    const envContent = `
BOT_TOKEN=${token}
OWNER_ID=${ownerId}
SUDO=${ownerId}
ADMIN=${ownerId}
API_ID=12345
API_HASH=12345
    `;
    fs.writeFileSync(path.join(BOT_DIR, '.env'), envContent.trim());

    // 4. Start Bot with PM2
    // ابتدا pm2 را در پوشه ربات نصب می‌کنیم تا مطمئن شویم در دسترس است
    await execPromise('npm install pm2', { cwd: BOT_DIR });
    
    // ربات را استارت می‌کنیم و لاگ‌ها را به فایل bot.log می‌فرستیم
    await execPromise(`npx pm2 start index.js --name group-bot --output ${LOG_FILE} --error ${LOG_FILE}`, { cwd: BOT_DIR });

    res.json({ success: true, message: 'Bot installed and started successfully via PM2.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.get('/logs', (req, res) => {
  if (fs.existsSync(LOG_FILE)) {
    res.type('text/plain').send(fs.readFileSync(LOG_FILE, 'utf8'));
  } else {
    res.send('No logs yet.');
  }
});

app.listen(PORT, () => {
  console.log('Installer Panel running on port ' + PORT);
});
