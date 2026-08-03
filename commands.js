const db = require('./db');
const { parseDuration, formatDuration, extractTarget, mention } = require('./utils');
const { LEVEL, getRole, roleName, canAct } = require('./roles');
const { detectTypes, checkFlood, checkSpam } = require('./locks');
const panel = require('./panel');

const PERSIAN_TRIGGERS = [
  ['رفع سکوت', 'unmute'],
  ['سکوت دائمی', 'mute'],
  ['سکوت', 'mute'],
  ['رفع بن', 'unban'],
  ['بن دائمی', 'ban'],
  ['بن', 'ban'],
  ['اخراج', 'kick'],
  ['حذف اخطار', 'unwarn'],
  ['پاک اخطار', 'clearwarn'],
  ['اخطار', 'warn'],
  ['حذف ویژه', 'unvip'],
  ['ویژه', 'vip'],
  ['حذف معاف', 'unexempt'],
  ['معاف', 'exempt'],
  ['ترفیع', 'promote'],
  ['عزل', 'demote'],
  ['حذف ادمین', 'unadmin'],
  ['ادمین', 'admin'],
  ['حذف مالک', 'unowner'],
  ['مالک', 'owner']
].sort((a, b) => b[0].length - a[0].length);

function timeNow() {
  return Math.floor(Date.now() / 1000);
}

function registerCommands(bot, botOwnerId) {
  // ---------- tracking middleware ----------
  bot.on('message', async (ctx, next) => {
    const msg = ctx.message;
    if (msg.from) {
      db.upsertUser(msg.from.id, {
        username: msg.from.username || null,
        firstName: msg.from.first_name || msg.from.username || String(msg.from.id)
      });
    }
    if (ctx.chat && (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup')) {
      const group = db.getGroup(ctx.chat.id);
      group.stats.messages = (group.stats.messages || 0) + 1;
      const today = new Date().toISOString().slice(0, 10);
      if (group.stats.lastReset !== today) {
        group.stats.today = {};
        group.stats.lastReset = today;
      }
      group.stats.today[msg.from.id] = (group.stats.today[msg.from.id] || 0) + 1;

      const types = Array.from(detectTypes(msg));
      group.recentMessages.unshift({
        id: msg.message_id,
        from: msg.from.id,
        isBot: !!msg.from.is_bot,
        types,
        date: Date.now()
      });
      group.recentMessages = group.recentMessages.slice(0, 800);
      db.saveGroup(ctx.chat.id, group);

      // lock enforcement (skip for exempt+ roles)
      const actorLevel = getRole(group, msg.from.id, botOwnerId);
      if (actorLevel < LEVEL.VIP && group.locks) {
        let violated = types.find((t) => group.locks[t]);
        if (!violated && group.locks.flood && checkFlood(ctx.chat.id, msg.from.id)) violated = 'flood';
        if (!violated && group.locks.spam && checkSpam(ctx.chat.id, msg.from.id, msg.text)) violated = 'spam';
        if (violated) {
          try {
            await ctx.deleteMessage(msg.message_id);
            db.addLog(ctx.chat.id, { type: 'lock', by: 'system', target: msg.from.id, note: `deleted for locked type: ${violated}` });
          } catch (e) {}
          return; // don't process further (locked message)
        }
      }
    }
    return next();
  });

  // ---------- new members / bot added ----------
  bot.on('new_chat_members', async (ctx) => {
    const me = await ctx.telegram.getMe();
    for (const member of ctx.message.new_chat_members) {
      if (member.id === me.id) {
        await ctx.reply(
          'ربات با موفقیت در گروه نصب شد.\nبرای مشاهده امکانات از /panel استفاده کنید.',
          panel.MAIN_MENU
        );
      } else {
        const group = db.getGroup(ctx.chat.id);
        const text = (group.welcome || 'خوش اومدی {name}!').replace('{name}', member.first_name || member.username || '');
        await ctx.reply(text);
      }
    }
  });

  bot.action(/panel:.*/, (ctx) => panel.handleCallback(ctx, db));
  bot.action(/lock:.*/, (ctx) => panel.handleCallback(ctx, db));

  bot.command(['panel', 'gpanel'], (ctx) => panel.showMain(ctx));

  // ================= moderation dispatch =================
  const ACTIONS = {
    mute: { minLevel: LEVEL.ADMIN, duration: true, apply: applyMute, label: 'سکوت' },
    unmute: { minLevel: LEVEL.ADMIN, apply: applyUnmute, label: 'رفع سکوت' },
    ban: { minLevel: LEVEL.ADMIN, duration: true, apply: applyBan, label: 'بن' },
    unban: { minLevel: LEVEL.ADMIN, apply: applyUnban, label: 'رفع بن' },
    kick: { minLevel: LEVEL.ADMIN, apply: applyKick, label: 'اخراج' },
    warn: { minLevel: LEVEL.ADMIN, apply: applyWarn, label: 'اخطار' },
    unwarn: { minLevel: LEVEL.ADMIN, apply: applyUnwarn, label: 'حذف اخطار' },
    clearwarn: { minLevel: LEVEL.ADMIN, apply: applyClearWarn, label: 'پاک کردن اخطارها' },
    vip: { minLevel: LEVEL.GOWNER, duration: true, apply: applyVip, label: 'ویژه' },
    unvip: { minLevel: LEVEL.GOWNER, apply: applyUnvip, label: 'حذف ویژه' },
    exempt: { minLevel: LEVEL.ADMIN, apply: applyExempt, label: 'معاف' },
    unexempt: { minLevel: LEVEL.ADMIN, apply: applyUnexempt, label: 'حذف معافیت' },
    admin: { minLevel: LEVEL.GOWNER, apply: applyAdmin, label: 'ادمین ربات' },
    unadmin: { minLevel: LEVEL.GOWNER, apply: applyUnadmin, label: 'حذف ادمین' },
    owner: { minLevel: LEVEL.OWNER, apply: applyOwner, label: 'مالک' },
    unowner: { minLevel: LEVEL.OWNER, apply: applyUnowner, label: 'حذف مالک' },
    promote: { minLevel: LEVEL.GOWNER, apply: applyPromote, label: 'ترفیع مدیر' },
    demote: { minLevel: LEVEL.GOWNER, apply: applyDemote, label: 'عزل مدیر' }
  };

  async function dispatch(ctx, canonical, argsText) {
    if (!ctx.chat || (ctx.chat.type !== 'group' && ctx.chat.type !== 'supergroup')) {
      return ctx.reply('این دستور فقط داخل گروه کار می‌کند.');
    }
    const action = ACTIONS[canonical];
    const group = db.getGroup(ctx.chat.id);
    const actorLevel = getRole(group, ctx.from.id, botOwnerId);
    if (actorLevel < action.minLevel) {
      return ctx.reply('شما دسترسی لازم برای این دستور را ندارید.');
    }

    const target = extractTarget(ctx, argsText);
    if (!target) {
      return ctx.reply('کاربر مورد نظر را ریپلای کنید یا @یوزرنیم / آیدی عددی وارد کنید.');
    }
    if (target.notFound || !target.id) {
      return ctx.reply('این کاربر در دیتابیس ربات پیدا نشد (باید قبلاً در گروه پیام داده باشد).');
    }
    if (target.id === ctx.from.id) {
      return ctx.reply('نمی‌توانید این عملیات را روی خودتان انجام دهید.');
    }

    const targetLevel = getRole(group, target.id, botOwnerId);
    if (!canAct(actorLevel, targetLevel)) {
      return ctx.reply('این کاربر نقش بالاتر یا مساوی شما دارد، امکان انجام عملیات نیست.');
    }

    let duration = null;
    if (action.duration) {
      duration = parseDuration(target.restText);
      if (target.restText && !duration) {
        return ctx.reply('فرمت زمان نامعتبر است. مثال: 30s, 10m, 1h, 2d, 1w, permanent');
      }
      if (!duration) duration = { permanent: true };
    }

    try {
      const resultText = await action.apply(ctx, group, target, duration, botOwnerId);
      db.saveGroup(ctx.chat.id, group);
      db.addLog(ctx.chat.id, { type: canonical, by: ctx.from.id, target: target.id });
      await ctx.reply(resultText || `${action.label} برای ${target.name} انجام شد.`, { parse_mode: 'HTML' });
    } catch (e) {
      await ctx.reply('خطا در اجرای عملیات: ' + e.message);
    }
  }

  for (const canonical of Object.keys(ACTIONS)) {
    bot.command(canonical, (ctx) => {
      const argsText = ctx.message.text.split(/\s+/).slice(1).join(' ');
      dispatch(ctx, canonical, argsText);
    });
  }

  bot.hears(/^[\S\s]+/, async (ctx, next) => {
    const text = ctx.message.text || '';
    if (text.startsWith('/')) return next();
    for (const [trigger, canonical] of PERSIAN_TRIGGERS) {
      if (text === trigger || text.startsWith(trigger + ' ')) {
        const argsText = text.slice(trigger.length).trim();
        return dispatch(ctx, canonical, argsText);
      }
    }
    return next();
  });

  // ================= apply functions =================
  async function applyMute(ctx, group, target, duration) {
    const untilDate = duration.permanent ? 0 : timeNow() + Math.floor(duration.ms / 1000);
    await ctx.telegram.restrictChatMember(ctx.chat.id, target.id, {
      permissions: {
        can_send_messages: false,
        can_send_audios: false,
        can_send_documents: false,
        can_send_photos: false,
        can_send_videos: false,
        can_send_video_notes: false,
        can_send_voice_notes: false,
        can_send_polls: false,
        can_send_other_messages: false,
        can_add_web_page_previews: false
      },
      until_date: untilDate
    });
    group.mutes[target.id] = { until: untilDate, permanent: duration.permanent };
    return `${mention(target.name, target.id)} به مدت ${duration.permanent ? 'دائمی' : formatDuration(duration.ms)} سکوت شد.`;
  }

  async function applyUnmute(ctx, group, target) {
    await ctx.telegram.restrictChatMember(ctx.chat.id, target.id, {
      permissions: {
        can_send_messages: true,
        can_send_audios: true,
        can_send_documents: true,
        can_send_photos: true,
        can_send_videos: true,
        can_send_video_notes: true,
        can_send_voice_notes: true,
        can_send_polls: true,
        can_send_other_messages: true,
        can_add_web_page_previews: true
      }
    });
    delete group.mutes[target.id];
    return `سکوت ${mention(target.name, target.id)} برداشته شد.`;
  }

  async function applyBan(ctx, group, target, duration) {
    const untilDate = duration.permanent ? 0 : timeNow() + Math.floor(duration.ms / 1000);
    await ctx.telegram.banChatMember(ctx.chat.id, target.id, untilDate || undefined);
    group.bans[target.id] = { until: untilDate, permanent: duration.permanent };
    return `${mention(target.name, target.id)} به مدت ${duration.permanent ? 'دائمی' : formatDuration(duration.ms)} بن شد.`;
  }

  async function applyUnban(ctx, group, target) {
    await ctx.telegram.unbanChatMember(ctx.chat.id, target.id, { only_if_banned: true });
    delete group.bans[target.id];
    return `بن ${mention(target.name, target.id)} برداشته شد.`;
  }

  async function applyKick(ctx, group, target) {
    await ctx.telegram.banChatMember(ctx.chat.id, target.id);
    await ctx.telegram.unbanChatMember(ctx.chat.id, target.id, { only_if_banned: true });
    return `${mention(target.name, target.id)} از گروه اخراج شد.`;
  }

  const WARN_ACTION_LABELS = { ban: 'بن دائم', mute: 'سکوت دائم', kick: 'اخراج' };

  async function applyWarn(ctx, group, target) {
    const limit = group.settings.warnLimit || 3;
    const action = group.settings.warnAction || 'ban';
    group.warns[target.id] = (group.warns[target.id] || 0) + 1;
    const count = group.warns[target.id];
    if (count >= limit) {
      if (action === 'ban') {
        await ctx.telegram.banChatMember(ctx.chat.id, target.id);
        group.bans[target.id] = { until: 0, permanent: true };
      } else if (action === 'mute') {
        await ctx.telegram.restrictChatMember(ctx.chat.id, target.id, {
          permissions: { can_send_messages: false },
          until_date: 0
        });
        group.mutes[target.id] = { until: 0, permanent: true };
      } else if (action === 'kick') {
        await ctx.telegram.banChatMember(ctx.chat.id, target.id);
        await ctx.telegram.unbanChatMember(ctx.chat.id, target.id, { only_if_banned: true });
      }
      group.warns[target.id] = 0;
      return `${mention(target.name, target.id)} به دلیل رسیدن به ${limit} اخطار، ${WARN_ACTION_LABELS[action]} شد.`;
    }
    return `${mention(target.name, target.id)} اخطار گرفت (${count}/${limit}).`;
  }

  async function applyUnwarn(ctx, group, target) {
    const limit = group.settings.warnLimit || 3;
    group.warns[target.id] = Math.max(0, (group.warns[target.id] || 0) - 1);
    return `یک اخطار از ${mention(target.name, target.id)} حذف شد (${group.warns[target.id]}/${limit}).`;
  }

  async function applyClearWarn(ctx, group, target) {
    group.warns[target.id] = 0;
    return `تمام اخطارهای ${mention(target.name, target.id)} پاک شد.`;
  }

  async function applyVip(ctx, group, target, duration) {
    const until = duration.permanent ? null : Date.now() + duration.ms;
    group.vips[target.id] = { until };
    return `${mention(target.name, target.id)} ویژه شد${until ? ' برای ' + formatDuration(duration.ms) : ' (دائمی)'}.`;
  }

  async function applyUnvip(ctx, group, target) {
    delete group.vips[target.id];
    return `عضویت ویژه ${mention(target.name, target.id)} حذف شد.`;
  }

  async function applyExempt(ctx, group, target) {
    if (!group.exempts.includes(target.id)) group.exempts.push(target.id);
    return `${mention(target.name, target.id)} از قفل‌ها و فیلترها معاف شد.`;
  }

  async function applyUnexempt(ctx, group, target) {
    group.exempts = group.exempts.filter((id) => id !== target.id);
    return `معافیت ${mention(target.name, target.id)} حذف شد.`;
  }

  async function applyAdmin(ctx, group, target) {
    if (!group.admins.includes(target.id)) group.admins.push(target.id);
    return `${mention(target.name, target.id)} ادمین ربات شد.`;
  }

  async function applyUnadmin(ctx, group, target) {
    group.admins = group.admins.filter((id) => id !== target.id);
    return `دسترسی ادمین ${mention(target.name, target.id)} حذف شد.`;
  }

  async function applyOwner(ctx, group, target) {
    if (!group.owners.includes(target.id)) group.owners.push(target.id);
    return `${mention(target.name, target.id)} مالک گروه شد.`;
  }

  async function applyUnowner(ctx, group, target) {
    group.owners = group.owners.filter((id) => id !== target.id);
    return `مالکیت ${mention(target.name, target.id)} حذف شد.`;
  }

  async function applyPromote(ctx, group, target) {
    await ctx.telegram.promoteChatMember(ctx.chat.id, target.id, {
      can_delete_messages: true,
      can_restrict_members: true,
      can_invite_users: true,
      can_pin_messages: true,
      can_manage_chat: true,
      can_change_info: false,
      can_promote_members: false
    });
    if (!group.managers.includes(target.id)) group.managers.push(target.id);
    return `${mention(target.name, target.id)} به مدیریت (ادمین تلگرام) ترفیع یافت.`;
  }

  async function applyDemote(ctx, group, target) {
    await ctx.telegram.promoteChatMember(ctx.chat.id, target.id, {
      can_delete_messages: false,
      can_restrict_members: false,
      can_invite_users: false,
      can_pin_messages: false,
      can_manage_chat: false,
      can_change_info: false,
      can_promote_members: false
    });
    group.managers = group.managers.filter((id) => id !== target.id);
    return `${mention(target.name, target.id)} از مدیریت عزل شد.`;
  }

  // ================= info commands =================
  bot.command(['user', 'ustats', 'roles', 'history'], async (ctx) => {
    const argsText = ctx.message.text.split(/\s+/).slice(1).join(' ');
    const group = db.getGroup(ctx.chat.id);
    const target = extractTarget(ctx, argsText) || {
      id: ctx.from.id,
      name: ctx.from.first_name || ctx.from.username,
      restText: ''
    };
    if (!target.id) return ctx.reply('کاربر پیدا نشد.');
    const level = getRole(group, target.id, botOwnerId);
    const cmd = ctx.message.text.split(/\s+/)[0].replace('/', '');
    if (cmd === 'history') {
      const logs = group.logs.filter((l) => l.target === target.id).slice(0, 10);
      const text = logs.length
        ? logs.map((l) => `${l.type} — ${new Date(l.date).toLocaleString('fa-IR')}`).join('\n')
        : 'تاریخچه‌ای یافت نشد.';
      return ctx.reply(`تاریخچه ${target.name}:\n${text}`);
    }
    const msgCount = (group.stats.today && group.stats.today[target.id]) || 0;
    const warns = group.warns[target.id] || 0;
    const muted = !!group.mutes[target.id];
    const banned = !!group.bans[target.id];
    await ctx.replyWithHTML(
      `پنل کاربر ${mention(target.name, target.id)}\n` +
      `نقش: ${roleName(level)}\n` +
      `پیام امروز: ${msgCount}\n` +
      `اخطار: ${warns}/3\n` +
      `وضعیت: ${banned ? 'بن' : muted ? 'سکوت' : 'عادی'}`
    );
  });

  // ================= group management commands =================
  bot.command('settings', async (ctx) => {
    const group = db.getGroup(ctx.chat.id);
    await ctx.reply(
      `تنظیمات گروه:\nزبان: ${group.settings.language}\n` +
      `تعداد ادمین‌ها: ${group.admins.length}\nتعداد مالکان: ${group.owners.length}\n` +
      `تعداد ویژه‌ها: ${Object.keys(group.vips).length}\n` +
      `آستانه اخطار: ${group.settings.warnLimit || 3}\nمجازات اخطار: ${WARN_ACTION_LABELS[group.settings.warnAction || 'ban']}\n\n` +
      `برای تغییر: /setwarn <تعداد> <ban|mute|kick>  مثال: /setwarn 5 mute`
    );
  });

  bot.command('setwarn', async (ctx) => {
    const group = db.getGroup(ctx.chat.id);
    const actorLevel = getRole(group, ctx.from.id, botOwnerId);
    if (actorLevel < LEVEL.GOWNER) return ctx.reply('فقط مالک گروه می‌تواند این تنظیم را تغییر دهد.');
    const parts = ctx.message.text.split(/\s+/);
    const count = parseInt(parts[1], 10);
    const action = (parts[2] || '').toLowerCase();
    if (!count || count < 1 || !['ban', 'mute', 'kick'].includes(action)) {
      return ctx.reply('فرمت درست: /setwarn <تعداد> <ban|mute|kick>  مثال: /setwarn 5 mute');
    }
    group.settings.warnLimit = count;
    group.settings.warnAction = action;
    db.saveGroup(ctx.chat.id, group);
    await ctx.reply(`تنظیم شد: بعد از ${count} اخطار → ${WARN_ACTION_LABELS[action]}`);
  });

  bot.command(['locks', 'security'], async (ctx) => {
    const group = db.getGroup(ctx.chat.id);
    await ctx.reply('وضعیت قفل‌ها:', panel.MAIN_MENU);
    await panel.handleCallback({ ...ctx, callbackQuery: { data: 'panel:locks' }, updateType: 'message' }, db).catch(() => {});
  });

  bot.command(['stats'], async (ctx) => {
    const group = db.getGroup(ctx.chat.id);
    await ctx.reply(`آمار گروه:\nکل پیام‌ها: ${group.stats.messages}\nادمین‌ها: ${group.admins.length}\nمالکان: ${group.owners.length}\nویژه‌ها: ${Object.keys(group.vips).length}`);
  });

  bot.command('today', async (ctx) => {
    const group = db.getGroup(ctx.chat.id);
    const entries = Object.entries(group.stats.today || {}).sort((a, b) => b[1] - a[1]).slice(0, 15);
    if (!entries.length) return ctx.reply('امروز پیامی ثبت نشده.');
    const lines = entries.map(([id, count]) => {
      const u = db.getUser(id);
      return `${u ? u.firstName : id}: ${count}`;
    });
    await ctx.reply(`آمار امروز:\n${lines.join('\n')}`);
  });

  bot.command('logs', async (ctx) => {
    const group = db.getGroup(ctx.chat.id);
    if (!group.logs.length) return ctx.reply('گزارشی ثبت نشده.');
    const lines = group.logs.slice(0, 10).map((l) => `${l.type} — ${new Date(l.date).toLocaleString('fa-IR')}`);
    await ctx.reply(`آخرین گزارشات:\n${lines.join('\n')}`);
  });

  function listCommand(name, field, formatter) {
    bot.command(name, async (ctx) => {
      const group = db.getGroup(ctx.chat.id);
      const data = group[field];
      const ids = Array.isArray(data) ? data : Object.keys(data);
      if (!ids.length) return ctx.reply('لیست خالی است.');
      const lines = ids.map((id) => {
        const u = db.getUser(id);
        const label = u ? u.firstName : id;
        return formatter ? formatter(id, label, data) : `- ${label} (${id})`;
      });
      await ctx.reply(lines.join('\n'));
    });
  }

  listCommand('admins', 'admins');
  listCommand('owners', 'owners');
  listCommand('exempts', 'exempts');
  listCommand('mutelist', 'mutes');
  listCommand('banlist', 'bans');
  listCommand('vips', 'vips', (id, label, data) => `- ${label} (${id}) تا ${data[id].until ? new Date(data[id].until).toLocaleDateString('fa-IR') : 'همیشه'}`);
  bot.command('warnlist', async (ctx) => {
    const group = db.getGroup(ctx.chat.id);
    const entries = Object.entries(group.warns).filter(([, c]) => c > 0);
    if (!entries.length) return ctx.reply('کاربری با اخطار وجود ندارد.');
    const lines = entries.map(([id, c]) => {
      const u = db.getUser(id);
      return `- ${u ? u.firstName : id}: ${c}/3`;
    });
    await ctx.reply(lines.join('\n'));
  });

  bot.command('backup', async (ctx) => {
    const group = db.getGroup(ctx.chat.id);
    const buffer = Buffer.from(JSON.stringify(group, null, 2), 'utf8');
    await ctx.replyWithDocument({ source: buffer, filename: `backup-${ctx.chat.id}.json` });
  });

  bot.command('restore', async (ctx) => {
    const reply = ctx.message.reply_to_message;
    if (!reply || !reply.document) return ctx.reply('برای بازیابی، روی فایل بکاپ ریپلای کنید.');
    try {
      const link = await ctx.telegram.getFileLink(reply.document.file_id);
      const res = await fetch(link.href);
      const data = await res.json();
      db.saveGroup(ctx.chat.id, data);
      await ctx.reply('بازیابی با موفقیت انجام شد.');
    } catch (e) {
      await ctx.reply('خطا در بازیابی: ' + e.message);
    }
  });

  bot.command('reset', async (ctx) => {
    const what = ctx.message.text.split(/\s+/)[1];
    const group = db.getGroup(ctx.chat.id);
    const map = {
      locks: () => (group.locks = {}),
      welcome: () => (group.welcome = 'سلام {name} خوش اومدی به گروه!'),
      rules: () => (group.rules = ''),
      filters: () => {},
      buttons: () => {},
      colors: () => {},
      settings: () => (group.settings = { language: 'fa' })
    };
    if (!map[what]) return ctx.reply('نوع بازنشانی نامعتبر است.');
    map[what]();
    db.saveGroup(ctx.chat.id, group);
    await ctx.reply(`${what} بازنشانی شد.`);
  });

  bot.command('clear', async (ctx) => {
    const what = ctx.message.text.split(/\s+/)[1];
    const group = db.getGroup(ctx.chat.id);
    const map = {
      bans: () => (group.bans = {}),
      mutes: () => (group.mutes = {}),
      warns: () => (group.warns = {}),
      vips: () => (group.vips = {}),
      exempts: () => (group.exempts = []),
      managers: () => (group.managers = []),
      owners: () => (group.owners = []),
      reports: () => {},
      today: () => (group.stats.today = {}),
      stats: () => (group.stats = { messages: 0, today: {}, lastReset: new Date().toISOString().slice(0, 10) }),
      logs: () => (group.logs = [])
    };
    if (!map[what]) return ctx.reply('نوع پاکسازی نامعتبر است.');
    map[what]();
    db.saveGroup(ctx.chat.id, group);
    await ctx.reply(`${what} پاک شد.`);
  });

  // ================= message management =================
  bot.command('del', async (ctx) => {
    const reply = ctx.message.reply_to_message;
    if (!reply) return ctx.reply('روی پیام مورد نظر ریپلای کنید.');
    try {
      await ctx.deleteMessage(reply.message_id);
      await ctx.deleteMessage(ctx.message.message_id);
    } catch (e) {}
  });

  bot.command('pin', async (ctx) => {
    const reply = ctx.message.reply_to_message;
    if (!reply) return ctx.reply('روی پیام مورد نظر ریپلای کنید.');
    await ctx.pinChatMessage(reply.message_id);
    await ctx.reply('پیام پین شد.');
  });

  bot.command('unpin', async (ctx) => {
    await ctx.unpinChatMessage();
    await ctx.reply('پین برداشته شد.');
  });

  bot.command(['rules'], async (ctx) => {
    const group = db.getGroup(ctx.chat.id);
    await ctx.reply(group.rules || 'قوانینی ثبت نشده است.');
  });

  bot.command(['setrules'], async (ctx) => {
    const text = ctx.message.text.split(/\s+/).slice(1).join(' ');
    const group = db.getGroup(ctx.chat.id);
    group.rules = text;
    db.saveGroup(ctx.chat.id, group);
    await ctx.reply('قوانین به‌روزرسانی شد.');
  });

  bot.command(['welcome'], async (ctx) => {
    const group = db.getGroup(ctx.chat.id);
    await ctx.reply(group.welcome);
  });

  bot.command(['setwelcome', 'editwelcome'], async (ctx) => {
    const text = ctx.message.text.split(/\s+/).slice(1).join(' ');
    if (!text) return ctx.reply('متن خوش‌آمدگویی را بنویسید. از {name} برای نام کاربر استفاده کنید.');
    const group = db.getGroup(ctx.chat.id);
    group.welcome = text;
    db.saveGroup(ctx.chat.id, group);
    await ctx.reply('پیام خوش‌آمدگویی به‌روزرسانی شد.');
  });

  // ================= locks =================
  bot.command(['lock', 'unlock'], async (ctx) => {
    const group = db.getGroup(ctx.chat.id);
    const actorLevel = getRole(group, ctx.from.id, botOwnerId);
    if (actorLevel < LEVEL.ADMIN) return ctx.reply('دسترسی لازم را ندارید.');
    const [cmd, type] = ctx.message.text.split(/\s+/);
    const action = cmd.replace('/', '');
    if (!type) return ctx.reply('نوع قفل را مشخص کنید. مثال: /lock links');
    group.locks[type] = action === 'lock';
    db.saveGroup(ctx.chat.id, group);
    await ctx.reply(`قفل ${type} ${action === 'lock' ? 'فعال' : 'غیرفعال'} شد.`);
  });

  // ================= purge / cleanup =================
  bot.command(['purge', 'cleanup'], async (ctx) => {
    const group = db.getGroup(ctx.chat.id);
    const actorLevel = getRole(group, ctx.from.id, botOwnerId);
    if (actorLevel < LEVEL.ADMIN) return ctx.reply('دسترسی لازم را ندارید.');
    const arg = ctx.message.text.split(/\s+/)[1];
    if (!arg) return ctx.reply('نوع پاکسازی را وارد کنید: عدد، bots، links، forwards، media، muted_messages');

    let toDelete = [];
    if (/^\d+$/.test(arg)) {
      toDelete = group.recentMessages.slice(0, parseInt(arg, 10));
    } else if (arg === 'bots') {
      toDelete = group.recentMessages.filter((m) => m.isBot);
    } else if (arg === 'muted_messages') {
      toDelete = group.recentMessages.filter((m) => group.mutes[m.from]);
    } else if (['links', 'forwards', 'media'].includes(arg)) {
      const typeKey = arg === 'forwards' ? 'forward' : arg;
      toDelete = group.recentMessages.filter((m) => m.types.includes(typeKey));
    } else {
      return ctx.reply('نوع پاکسازی نامعتبر است.');
    }

    let deleted = 0;
    for (const m of toDelete) {
      try {
        await ctx.telegram.deleteMessage(ctx.chat.id, m.id);
        deleted++;
      } catch (e) {}
    }
    group.recentMessages = group.recentMessages.filter((m) => !toDelete.includes(m));
    db.saveGroup(ctx.chat.id, group);
    await ctx.reply(`${deleted} پیام حذف شد.`);
  });
}

module.exports = registerCommands;
