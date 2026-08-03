const express = require('express');
const axios = require('axios');
const crypto = require('crypto');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 3000;

// ذخیره کارهای زمان‌بندی شده برای امکان توقف
const activeJobs = new Map();

// ================== ظاهر سایت (فرانت‌اند) ==================
app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ارسال‌کننده زمان‌بندی تلگرام</title>
  <link href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;700;900&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Vazirmatn', sans-serif; background: #05030f; color: #fff; min-height: 100vh; display: flex; align-items: center; justify-content: center; overflow-y: auto; padding: 20px; }
    .bg-aurora { position: fixed; inset: 0; z-index: 0; pointer-events: none; background: radial-gradient(circle at 30% 30%, rgba(124,58,237,.4), transparent 50%), radial-gradient(circle at 70% 70%, rgba(6,182,212,.3), transparent 50%); filter: blur(100px); }
    .grid-bg { position: fixed; inset: 0; z-index: 0; pointer-events: none; opacity: .1; background-image: linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px); background-size: 40px 40px; }
    .container { position: relative; z-index: 1; width: min(550px, 100%); background: rgba(255,255,255,.05); backdrop-filter: blur(20px); border: 1px solid rgba(255,255,255,.1); border-radius: 28px; padding: 35px; box-shadow: 0 25px 60px rgba(0,0,0,.6); text-align: center; margin: 20px 0; }
    h1 { font-size: 28px; font-weight: 900; margin-bottom: 8px; background: linear-gradient(135deg, #a78bfa, #67e8f9); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .sub { color: #9ca3af; margin-bottom: 30px; font-size: 13px; line-height: 1.9; }
    .input-group { margin-bottom: 20px; text-align: right; }
    .label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 8px; color: #cbd5e1; }
    .input { width: 100%; background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.1); border-radius: 14px; padding: 15px; color: #fff; font-family: inherit; font-size: 15px; outline: none; transition: .3s; text-align: left; direction: ltr; }
    textarea.input { direction: rtl; text-align: right; height: 100px; resize: vertical; }
    .input:focus { border-color: #7c3aed; box-shadow: 0 0 0 3px rgba(124,58,237,.25); }
    .row { display: flex; gap: 15px; }
    .row .input-group { flex: 1; }
    .btn { width: 100%; padding: 16px; border: none; border-radius: 14px; background: linear-gradient(90deg, #7c3aed, #ec4899); color: #fff; font-family: inherit; font-weight: 800; font-size: 16px; cursor: pointer; transition: all .3s; margin-top: 15px; }
    .btn:hover { transform: translateY(-2px); box-shadow: 0 15px 35px rgba(124,58,237,.5); }
    .btn:disabled { opacity: .5; cursor: not-allowed; transform: none; }
    .btn.stop { background: linear-gradient(90deg, #ef4444, #dc2626); display: none; }
    .result { margin-top: 20px; padding: 15px; border-radius: 14px; font-weight: 700; font-size: 14px; display: none; }
    .success { background: rgba(16,185,129,.15); border: 1px solid rgba(16,185,129,.3); color: #6ee7b7; }
    .error { background: rgba(239,68,68,.15); border: 1px solid rgba(239,68,68,.3); color: #fca5a5; }
    .live-log { background: #000; border: 1px solid #333; border-radius: 12px; padding: 15px; margin-top: 20px; height: 150px; overflow-y: auto; text-align: left; direction: ltr; font-family: monospace; font-size: 12px; color: #10b981; display: none; }
    @media (max-width: 500px) { .row { flex-direction: column; } }
  </style>
</head>
<body>
  <div class="bg-aurora"></div>
  <div class="grid-bg"></div>
  <div class="container">
    <h1>⚡️ ارسال‌کننده هوشمند</h1>
    <p class="sub">ارسال چند پیام با فاصله امن به یک گروه تلگرام.<br>⚠️ برای تست و یادگیری. از اسپم خودداری کنید!</p>
    
    <form id="senderForm">
      <div class="input-group">
        <span class="label">توکن ربات (Bot Token)</span>
        <input type="text" id="token" class="input" placeholder="123456:ABC..." required>
      </div>
      <div class="input-group">
        <span class="label">شناسه گروه (Chat ID)</span>
        <input type="text" id="chatId" class="input" placeholder="-100123456789" required>
      </div>
      <div class="input-group">
        <span class="label">متن پیام</span>
        <textarea id="message" class="input" placeholder="متن پیام را اینجا بنویسید..." required></textarea>
      </div>
      <div class="row">
        <div class="input-group">
          <span class="label">تعداد تکرار (حداکثر 10)</span>
          <input type="number" id="count" class="input" value="3" min="1" max="10" required>
        </div>
        <div class="input-group">
          <span class="label">فاصله (ثانیه، حداقل 10)</span>
          <input type="number" id="interval" class="input" value="10" min="10" required>
        </div>
      </div>
      
      <button type="submit" class="btn" id="startBtn">▶️ شروع ارسال</button>
      <button type="button" class="btn stop" id="stopBtn">⏹ توقف فوری</button>
    </form>
    
    <div id="resultBox" class="result"></div>
    <div id="logBox" class="live-log"></div>
  </div>

  <script>
    let currentJobId = null;
    const form = document.getElementById('senderForm');
    const startBtn = document.getElementById('startBtn');
    const stopBtn = document.getElementById('stopBtn');
    const resultBox = document.getElementById('resultBox');
    const logBox = document.getElementById('logBox');

    function addLog(text, isError = false) {
      logBox.style.display = 'block';
      const line = document.createElement('div');
      line.textContent = '> ' + text;
      line.style.color = isError ? '#f87171' : '#10b981';
      logBox.appendChild(line);
      logBox.scrollTop = logBox.scrollHeight;
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const token = document.getElementById('token').value.trim();
      const chatId = document.getElementById('chatId').value.trim();
      const message = document.getElementById('message').value.trim();
      const count = parseInt(document.getElementById('count').value);
      const interval = parseInt(document.getElementById('interval').value);

      if (!token || !chatId || !message) {
        alert('لطفاً همه فیلدها را پر کنید.');
        return;
      }

      // فعال/غیرفعال کردن دکمه‌ها
      startBtn.style.display = 'none';
      stopBtn.style.display = 'block';
      resultBox.style.display = 'none';
      logBox.innerHTML = ''; 
      
      try {
        const res = await fetch('/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, chatId, message, count, interval })
        });
        
        const data = await res.json();
        
        if (res.ok) {
          currentJobId = data.jobId;
          resultBox.className = 'result success';
          resultBox.textContent = '✅ ' + data.message;
          resultBox.style.display = 'block';
          addLog('ارسال شروع شد...');
          pollLogs(); 
        } else {
          resultBox.className = 'result error';
          resultBox.textContent = '❌ ' + data.error;
          resultBox.style.display = 'block';
          addLog(data.error, true);
          resetButtons();
        }
      } catch (err) {
        resultBox.className = 'result error';
        resultBox.textContent = '❌ خطای شبکه!';
        resultBox.style.display = 'block';
        resetButtons();
      }
    });

    stopBtn.addEventListener('click', async () => {
      if (!currentJobId) return;
      try {
        await fetch('/stop/' + currentJobId, { method: 'POST' });
        addLog('ارسال توسط کاربر متوقف شد.');
        resetButtons();
        currentJobId = null;
      } catch (e) {}
    });

    function resetButtons() {
      startBtn.style.display = 'block';
      stopBtn.style.display = 'none';
    }

    async function pollLogs() {
      if (!currentJobId) return;
      try {
        const res = await fetch('/status/' + currentJobId);
        const data = await res.json();
        
        if (data.logs) {
          logBox.innerHTML = ''; 
          data.logs.forEach(l => addLog(l.text, l.isError));
        }
        
        if (data.active) {
          setTimeout(pollLogs, 500); 
        } else {
          addLog('✅ عملیات به پایان رسید.');
          resetButtons();
          currentJobId = null;
        }
      } catch (e) {
        setTimeout(pollLogs, 1000);
      }
    }
  </script>
</body>
</html>
  `);
});

// ================== منطق سرور (بک‌اند) ==================

// آرایه برای ذخیره لاگ‌ها (برای هر Job)
const jobLogs = new Map();

// 1. شروع کار زمان‌بندی شده
app.post('/start', async (req, res) => {
  const { token, chatId, message, count, interval } = req.body;

  if (!token || !chatId || !message) {
    return res.status(400).json({ error: 'فیلدهای توکن، شناسه گروه و متن پیام الزامی هستند.' });
  }

  const repeatCount = parseInt(count);
  const intervalSec = parseInt(interval);

  if (isNaN(repeatCount) || repeatCount < 1 || repeatCount > 10) {
    return res.status(400).json({ error: 'تعداد تکرار باید عددی بین ۱ تا ۱۰ باشد.' });
  }

  if (isNaN(intervalSec) || intervalSec < 10) {
    return res.status(400).json({ error: 'فاصله زمانی باید حداقل ۱۰ ثانیه باشد.' });
  }

  try {
    // یک تست اولیه برای معتبر بودن توکن و دسترسی ربات به گروه
    try {
      await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
        chat_id: chatId,
        text: '✅ ربات با موفقیت به گروه متصل شد. ارسال پیام‌ها شروع می‌شود...',
        disable_web_page_preview: true
      }, { timeout: 10000 });
    } catch (initError) {
      const errMsg = initError.response?.data?.description || 'توکن نامعتبر است یا ربات در گروه عضویت/دسترسی ندارد.';
      return res.status(400).json({ error: errMsg });
    }

    const jobId = crypto.randomUUID();
    const logs = [];
    jobLogs.set(jobId, logs);

    let sent = 0;
    
    const timer = setInterval(async () => {
      try {
        await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
          chat_id: chatId,
          text: message,
          disable_web_page_preview: true
        }, { timeout: 10000 });
        
        sent++;
        logs.push({ text: `پیام ${sent} از ${repeatCount} ارسال شد.` });
        
        if (sent >= repeatCount) {
          clearInterval(timer);
          activeJobs.delete(jobId);
        }
      } catch (err) {
        const errMsg = err.response?.data?.description || err.message;
        logs.push({ text: `❌ خطا: ${errMsg}`, isError: true });
        clearInterval(timer);
        activeJobs.delete(jobId);
      }
    }, intervalSec * 1000);

    activeJobs.set(jobId, timer);

    res.json({
      success: true,
      jobId: jobId,
      message: `ارسال ${repeatCount} پیام با فاصله ${intervalSec} ثانیه شروع شد.`
    });
  } catch (error) {
    res.status(500).json({ error: 'خطای داخلی سرور.' });
  }
});

// 2. توقف کار زمان‌بندی شده
app.post('/stop/:jobId', (req, res) => {
  const { jobId } = req.params;
  const timer = activeJobs.get(jobId);

  if (timer) {
    clearInterval(timer);
    activeJobs.delete(jobId);
    return res.json({ success: true, message: 'ارسال متوقف شد.' });
  }
  
  res.status(404).json({ error: 'شناسه کار پیدا نشد یا عملیات به پایان رسیده است.' });
});

// 3. دریافت وضعیت و لاگ‌ها
app.get('/status/:jobId', (req, res) => {
  const { jobId } = req.params;
  const isActive = activeJobs.has(jobId);
  const logs = jobLogs.get(jobId) || [];

  res.json({
    active: isActive,
    logs: logs.slice(-10) 
  });
});

app.listen(PORT, () => console.log(`Safe Sender Panel running on port ${PORT}`));
