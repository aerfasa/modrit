app.post('/install', async (req, res) => {
  const { token, ownerId } = req.body;
  if (!token || !ownerId) return res.status(400).json({ message: 'اطلاعات ناقص است.' });

  try {
    // 1. دانلود کدها بدون نیاز به git (با استفاده از degit)
    if (!fs.existsSync(BOT_DIR)) {
      await execPromise(`npx degit nekooee/telegram-group-manager-bot ${BOT_DIR}`);
    }

    // 2. نصب پیش‌نیازها (تشخیص هوشمند Node.js یا Python)
    if (fs.existsSync(path.join(BOT_DIR, 'package.json'))) {
      await execPromise('npm install', { cwd: BOT_DIR });
    } else if (fs.existsSync(path.join(BOT_DIR, 'requirements.txt'))) {
      await execPromise('pip3 install -r requirements.txt', { cwd: BOT_DIR });
    }

    // 3. ساخت فایل .env (تنظیمات ربات)
    const envContent = `BOT_TOKEN=${token}\nOWNER_ID=${ownerId}\nSUDO=${ownerId}\nADMIN=${ownerId}\nAPI_ID=12345\nAPI_HASH=12345`;
    fs.writeFileSync(path.join(BOT_DIR, '.env'), envContent);

    // 4. اجرای ربات با PM2 (تشخیص فایل اصلی ربات)
    await execPromise('npm install pm2', { cwd: BOT_DIR });
    
    let startCmd = 'npx pm2 start index.js --name group-bot';
    if (fs.existsSync(path.join(BOT_DIR, 'main.py'))) {
      startCmd = 'npx pm2 start main.py --interpreter python3 --name group-bot';
    } else if (fs.existsSync(path.join(BOT_DIR, 'bot.py'))) {
      startCmd = 'npx pm2 start bot.py --interpreter python3 --name group-bot';
    } else if (fs.existsSync(path.join(BOT_DIR, 'app.py'))) {
      startCmd = 'npx pm2 start app.py --interpreter python3 --name group-bot';
    } else if (fs.existsSync(path.join(BOT_DIR, 'app.js'))) {
      startCmd = 'npx pm2 start app.js --name group-bot';
    }
    
    await execPromise(`${startCmd} --output ${LOG_FILE} --error ${LOG_FILE}`, { cwd: BOT_DIR });

    res.json({ success: true, message: 'ربات با موفقیت نصب و اجرا شد.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});
