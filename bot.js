const express = require('express');
const pino = require('pino');
const readline = require('readline');
const fs = require('fs');
const path = require('path');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
  downloadMediaMessage
} = require('@whiskeysockets/baileys');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const OWNER_NUMBER = String(process.env.OWNER_NUMBER || '').replace(/\D/g, '');
const DATA_FILE = path.join(__dirname, 'data.json');
const AUTH_DIR = path.join(__dirname, 'auth_info');

let connected = false;
let botNumber = '';
let socketRef = null;
let startedAt = Date.now();
let messageCount = 0;
let lastError = '';

function readData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return { groups: {}, warnings: {}, points: {}, spam: {} };
  }
}
function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}
function groupSettings(data, jid) {
  if (!data.groups[jid]) {
    data.groups[jid] = {
      welcome: true, goodbye: true, antilink: false, antispam: false,
      rules: 'Be respectful. No spam, scams, harassment, or 18+ content.'
    };
  }
  return data.groups[jid];
}
function digits(jid = '') { return jid.split('@')[0].split(':')[0].replace(/\D/g, ''); }
function getText(message) {
  const m = message.message || {};
  return m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.caption ||
    m.buttonsResponseMessage?.selectedButtonId ||
    m.listResponseMessage?.singleSelectReply?.selectedRowId || '';
}
function mentionsFrom(message) {
  const ctx = message.message?.extendedTextMessage?.contextInfo ||
    message.message?.imageMessage?.contextInfo ||
    message.message?.videoMessage?.contextInfo || {};
  return ctx.mentionedJid || [];
}
function quotedKey(message) {
  const ctx = message.message?.extendedTextMessage?.contextInfo ||
    message.message?.imageMessage?.contextInfo ||
    message.message?.videoMessage?.contextInfo || {};
  if (!ctx.stanzaId) return null;
  return {
    remoteJid: message.key.remoteJid,
    fromMe: false,
    id: ctx.stanzaId,
    participant: ctx.participant
  };
}
async function reply(sock, jid, text, mentions = []) {
  return sock.sendMessage(jid, { text, mentions }, { quoted: undefined });
}
function menu() {
  return `📜 *BRIGHTWORKS BOT MENU*
Prefix: .

👥 *GENERAL*
.help / .menu
.info
.owner
.ping
.profile @user
.rank
.rules

🔨 *ADMIN ONLY*
.kick @user  |  .add 234...
.promote @user  |  .demote @user
.mute  |  .unmute
.tagall [message]  |  .hidetag [message]
.setname [name]  |  .setdesc [text]
.setpp (reply to image)  |  .link  |  .revoke
.warn @user  |  .warnings
.antilink on/off  |  .antispam on/off
.welcome on/off  |  .goodbye on/off
.delete (reply to a message)

😂 *FUN & GAMES*
.gay @user  |  .ship @user @user2
.8ball [question]  |  .joke  |  .quote  |  .meme
.truth  |  .dare  |  .roast @user  |  .simp @user

⚙️ .clear is not supported: WhatsApp does not provide a bot command to clear everyone's entire chat history.
Created by *BrightWorks* ✨`;
}
const jokes = [
  'Why did the phone need glasses? It lost its contacts. 🤓',
  'My Wi-Fi and I have a complicated relationship: we keep disconnecting.',
  'I told my computer I needed a break. It said: “No problem, I’ll go to sleep.”',
  'Why was the maths book sad? It had too many problems.',
  'I tried to catch fog yesterday. Mist.'
];
const quotes = [
  '“Great things are done by a series of small things brought together.” — Vincent van Gogh',
  '“It always seems impossible until it is done.” — Nelson Mandela',
  '“The secret of getting ahead is getting started.” — Mark Twain',
  '“It does not matter how slowly you go as long as you do not stop.” — Confucius'
];
const truths = [
  'What is one skill you wish you could learn instantly?',
  'What is the funniest thing that happened to you this week?',
  'What game or anime could you talk about for hours?',
  'What is one goal you want to achieve this year?'
];
const dares = [
  'Send the group your most-used emoji.',
  'Describe your favourite game using only three words.',
  'Give someone in the group a genuine compliment.',
  'Write a dramatic movie title for your day.'
];
const ball = [
  'It is looking good. 🔮', 'Ask again later. 👀', 'Definitely yes! ✅',
  'The signs say no. ❌', 'Hard to tell right now. 🤔', 'Absolutely! ✨'
];
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function scoreFor(text) {
  let n = 0;
  for (const c of text) n = (n * 31 + c.charCodeAt(0)) >>> 0;
  return n % 101;
}
function parseOnOff(value) {
  if (['on', 'yes', 'true'].includes((value || '').toLowerCase())) return true;
  if (['off', 'no', 'false'].includes((value || '').toLowerCase())) return false;
  return null;
}

app.use(express.static(path.join(__dirname, 'public')));
app.get('/api/status', (_req, res) => {
  res.json({
    name: 'BRIGHTWORKS BOT',
    connected,
    botNumber,
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    messagesHandled: messageCount,
    lastError
  });
});
app.get('/api/commands', (_req, res) => {
  res.json({ commands: ['.help', '.info', '.owner', '.ping', '.profile', '.rank', '.rules', '.kick', '.add', '.promote', '.demote', '.mute', '.unmute', '.tagall', '.hidetag', '.setname', '.setdesc', '.setpp', '.link', '.revoke', '.warn', '.warnings', '.antilink', '.antispam', '.welcome', '.goodbye', '.delete', '.gay', '.ship', '.8ball', '.joke', '.quote', '.meme', '.truth', '.dare', '.roast', '.simp'] });
});
app.listen(PORT, '127.0.0.1', () => {
  console.log(`BrightWorks dashboard: http://127.0.0.1:${PORT}`);
});

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, answer => { rl.close(); resolve(answer.trim()); }));
}

async function startBot() {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  let version;
  try { ({ version } = await fetchLatestBaileysVersion()); } catch {}
  const sock = makeWASocket({
    auth: state,
    version,
    logger: pino({ level: 'silent' }),
    browser: Browsers.macOS('BrightWorks Bot'),
    printQRInTerminal: false,
    markOnlineOnConnect: false,
    syncFullHistory: false
  });
  socketRef = sock;

  if (!state.creds.registered) {
    console.log('\nPair your own WhatsApp account. Keep the code private.');
    const phone = (await ask('Enter your WhatsApp number with country code, digits only (e.g. 2348012345678): ')).replace(/\D/g, '');
    if (!phone || phone.length < 10) {
      console.log('That number does not look valid. Stop and run npm start again.');
      process.exit(1);
    }
    try {
      const code = await sock.requestPairingCode(phone);
      console.log(`\nYour WhatsApp linking code is: ${code}\n`);
      console.log('On WhatsApp: Settings > Linked devices > Link a device > Link with phone number instead.');
      console.log('Enter the code in WhatsApp. Do not share it with anyone.\n');
    } catch (err) {
      lastError = err.message || String(err);
      console.error('Could not generate pairing code:', lastError);
    }
  }

  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
    if (connection === 'open') {
      connected = true;
      lastError = '';
      botNumber = digits(sock.user?.id || '');
      console.log(`Connected as ${botNumber || 'WhatsApp account'}`);
    }
    if (connection === 'close') {
      connected = false;
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      lastError = lastDisconnect?.error?.message || 'Connection closed';
      if (statusCode !== DisconnectReason.loggedOut) {
        console.log('Connection closed; trying to reconnect...');
        setTimeout(() => startBot().catch(err => console.error(err)), 2500);
      } else {
        console.log('WhatsApp logged this session out. Remove auth_info only if you want to pair again.');
      }
    }
  });

  sock.ev.on('group-participants.update', async update => {
    try {
      const data = readData();
      const settings = groupSettings(data, update.id);
      saveData(data);
      for (const participant of update.participants || []) {
        const who = '@' + digits(participant);
        if (update.action === 'add' && settings.welcome) {
          await sock.sendMessage(update.id, { text: `🌟 Welcome ${who} to the group! Read the rules with .rules and enjoy your stay.`, mentions: [participant] });
        } else if (update.action === 'remove' && settings.goodbye) {
          await sock.sendMessage(update.id, { text: `👋 ${who} has left the group. Take care!`, mentions: [participant] });
        }
      }
    } catch (e) { console.error('Welcome/goodbye error:', e.message); }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      try { await handleMessage(sock, msg); }
      catch (e) { console.error('Message handler error:', e.message); }
    }
  });
}

async function handleMessage(sock, msg) {
  if (!msg.message || msg.key.fromMe) return;
  const jid = msg.key.remoteJid;
  if (!jid || jid === 'status@broadcast') return;
  const isGroup = jid.endsWith('@g.us');
  const sender = isGroup ? (msg.key.participant || '') : jid;
  const senderNum = digits(sender);
  const text = getText(msg).trim();
  if (!text) return;
  messageCount++;

  const data = readData();
  const settings = isGroup ? groupSettings(data, jid) : null;

  let metadata = null;
  let participantList = [];
  let senderIsAdmin = false;
  let botIsAdmin = false;
  if (isGroup) {
    try {
      metadata = await sock.groupMetadata(jid);
      participantList = metadata.participants || [];
      senderIsAdmin = participantList.some(p => p.id === sender && (p.admin === 'admin' || p.admin === 'superadmin'));
      botIsAdmin = participantList.some(p => p.id === sock.user?.id && (p.admin === 'admin' || p.admin === 'superadmin'));
    } catch {}
  }

  // Optional anti-link moderation. Bot must be an admin to delete messages.
  const linkFound = /(https?:\/\/|www\.|chat\.whatsapp\.com\/)/i.test(text);
  if (isGroup && settings.antilink && linkFound && !senderIsAdmin && !senderNum.endsWith(OWNER_NUMBER) && botIsAdmin) {
    try { await sock.sendMessage(jid, { delete: msg.key }); } catch {}
    await reply(sock, jid, '🔗 Links are disabled in this group.');
    saveData(data);
    return;
  }

  // Basic rate limiter: repeated bursts only; not a replacement for a real moderation system.
  if (isGroup && settings.antispam && !senderIsAdmin) {
    const key = `${jid}:${sender}`;
    const now = Date.now();
    const old = data.spam[key] || [];
    const recent = old.filter(t => now - t < 8000);
    recent.push(now);
    data.spam[key] = recent;
    if (recent.length > 6 && botIsAdmin) {
      try { await sock.sendMessage(jid, { delete: msg.key }); } catch {}
      saveData(data);
      return;
    }
  }

  if (!text.startsWith('.')) { saveData(data); return; }
  const body = text.slice(1).trim();
  const firstSpace = body.indexOf(' ');
  const command = (firstSpace < 0 ? body : body.slice(0, firstSpace)).toLowerCase();
  const argsText = firstSpace < 0 ? '' : body.slice(firstSpace + 1).trim();
  const args = argsText.split(/\s+/).filter(Boolean);
  const mentioned = mentionsFrom(msg);
  const targets = mentioned.length ? mentioned : args.filter(a => /^\d{8,16}$/.test(a)).map(n => n.replace(/\D/g, '') + '@s.whatsapp.net');
  const target = targets[0];
  const requireGroup = async () => {
    if (!isGroup) { await reply(sock, jid, 'This command only works in a group.'); return false; }
    return true;
  };
  const requireAdmin = async () => {
    if (!await requireGroup()) return false;
    if (!senderIsAdmin && senderNum !== OWNER_NUMBER) {
      await reply(sock, jid, '⛔ Only group admins can use this command.');
      return false;
    }
    return true;
  };
  const requireBotAdmin = async () => {
    if (!botIsAdmin) { await reply(sock, jid, '⚠️ Make BrightWorks Bot a group admin first.'); return false; }
    return true;
  };

  if (['menu', 'help'].includes(command)) return reply(sock, jid, menu());
  if (command === 'info') return reply(sock, jid, `🤖 *BRIGHTWORKS BOT*\nVersion: 1.0\nStatus: ${connected ? 'Connected' : 'Starting'}\nCommands use the . prefix.\nCreated by BrightWorks ✨`);
  if (command === 'owner') return reply(sock, jid, OWNER_NUMBER ? `👑 Bot owner: +${OWNER_NUMBER}` : 'Owner number is not set. Add OWNER_NUMBER to your environment.');
  if (command === 'ping') return reply(sock, jid, `🏓 Pong! ${Date.now() - (msg.messageTimestamp ? Number(msg.messageTimestamp) * 1000 : Date.now())}ms`);
  if (command === 'rules') return reply(sock, jid, isGroup ? `📜 *GROUP RULES*\n${settings.rules}` : 'Group rules are available inside groups.');
  if (command === 'profile' || command === 'rank') {
    const person = target || sender;
    const key = `${jid}:${person}`;
    const points = data.points[key] || 0;
    const name = person.split('@')[0];
    return reply(sock, jid, command === 'profile'
      ? `👤 *PROFILE*\nUser: @${name}\nPoints: ${points}\nRank: ${points >= 100 ? 'Elite' : points >= 50 ? 'Pro' : points >= 10 ? 'Rising' : 'Newbie'}` 
      : `🏆 @${name}\nPoints: ${points}\nRank: ${points >= 100 ? 'Elite' : points >= 50 ? 'Pro' : points >= 10 ? 'Rising' : 'Newbie'}`, [person]);
  }

  const adminCommands = ['kick','add','promote','demote','mute','unmute','tagall','hidetag','setname','setdesc','setpp','link','revoke','warn','warnings','antilink','antispam','welcome','goodbye','delete','clear'];
  if (adminCommands.includes(command) && !await requireAdmin()) return;

  if (command === 'kick' || command === 'promote' || command === 'demote') {
    if (!target) return reply(sock, jid, `Mention a member or provide their number. Example: .${command} @user`);
    if (!await requireBotAdmin()) return;
    const action = command === 'kick' ? 'remove' : command === 'promote' ? 'promote' : 'demote';
    try {
      await sock.groupParticipantsUpdate(jid, [target], action);
      return reply(sock, jid, `✅ ${command} request completed for @${digits(target)}.`, [target]);
    } catch { return reply(sock, jid, 'Could not do that. Check bot admin status and WhatsApp group permissions.'); }
  }
  if (command === 'add') {
    if (!await requireBotAdmin()) return;
    const number = (args[0] || '').replace(/\D/g, '');
    if (number.length < 10) return reply(sock, jid, 'Usage: .add 2348012345678');
    try {
      const result = await sock.groupParticipantsUpdate(jid, [`${number}@s.whatsapp.net`], 'add');
      return reply(sock, jid, `Add request sent. WhatsApp may require an invitation link for this person.`);
    } catch { return reply(sock, jid, 'Could not add that person. WhatsApp may require an invite link or their privacy settings may block adding.'); }
  }
  if (command === 'mute' || command === 'unmute') {
    if (!await requireBotAdmin()) return;
    try {
      await sock.groupSettingUpdate(jid, command === 'mute' ? 'announcement' : 'not_announcement');
      return reply(sock, jid, command === 'mute' ? '🔇 Group set so only admins can send messages.' : '🔊 Group members can send messages again.');
    } catch { return reply(sock, jid, 'Could not change group settings. Check bot admin permissions.'); }
  }
  if (command === 'tagall' || command === 'hidetag') {
    if (!await requireBotAdmin()) return;
    const people = participantList.map(p => p.id);
    const note = argsText || (command === 'tagall' ? 'Attention everyone!' : '📢 Group announcement');
    try {
      if (command === 'tagall') {
        const chunks = [];
        for (let i = 0; i < people.length; i += 40) chunks.push(people.slice(i, i + 40));
        for (const chunk of chunks) await sock.sendMessage(jid, { text: `${note}\n${chunk.map(p => '@' + digits(p)).join(' ')}`, mentions: chunk });
      } else {
        await sock.sendMessage(jid, { text: note, mentions: people });
      }
      return;
    } catch { return reply(sock, jid, 'Could not tag members. Try a shorter message.'); }
  }
  if (command === 'setname') {
    if (!argsText) return reply(sock, jid, 'Usage: .setname New Group Name');
    if (!await requireBotAdmin()) return;
    try { await sock.groupUpdateSubject(jid, argsText); return reply(sock, jid, '✅ Group name updated.'); }
    catch { return reply(sock, jid, 'Could not change the group name. Check bot admin permissions.'); }
  }
  if (command === 'setdesc') {
    if (!argsText) return reply(sock, jid, 'Usage: .setdesc Your group description');
    if (!await requireBotAdmin()) return;
    try { await sock.groupUpdateDescription(jid, argsText); return reply(sock, jid, '✅ Group description updated.'); }
    catch { return reply(sock, jid, 'Could not change the description. Check bot admin permissions.'); }
  }
  if (command === 'setpp') {
    const q = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    if (!q) return reply(sock, jid, 'Reply directly to an image with .setpp. If this build cannot read that image type, set the group picture manually.');
    if (!await requireBotAdmin()) return;
    try {
      const fake = { key: msg.key, message: q };
      const buffer = await downloadMediaMessage(fake, 'buffer', {});
      await sock.updateProfilePicture(jid, buffer);
      return reply(sock, jid, '✅ Group picture updated.');
    } catch { return reply(sock, jid, 'Could not update the group picture. Try a normal image and check bot admin permissions.'); }
  }
  if (command === 'link') {
    if (!await requireBotAdmin()) return;
    try { return reply(sock, jid, `🔗 Group invite link:\nhttps://chat.whatsapp.com/${await sock.groupInviteCode(jid)}`); }
    catch { return reply(sock, jid, 'Could not get the invite link.'); }
  }
  if (command === 'revoke') {
    if (!await requireBotAdmin()) return;
    try { await sock.groupRevokeInvite(jid); return reply(sock, jid, `🔐 Invite link reset.\nNew link: https://chat.whatsapp.com/${await sock.groupInviteCode(jid)}`); }
    catch { return reply(sock, jid, 'Could not reset the invite link.'); }
  }
  if (command === 'warn') {
    if (!target) return reply(sock, jid, 'Usage: .warn @user [reason]');
    const key = `${jid}:${target}`;
    data.warnings[key] = data.warnings[key] || [];
    data.warnings[key].push({ reason: argsText.replace(/@\d+/g, '').trim() || 'No reason provided', by: senderNum, at: new Date().toISOString() });
    saveData(data);
    return reply(sock, jid, `⚠️ @${digits(target)} now has ${data.warnings[key].length} warning(s).`, [target]);
  }
  if (command === 'warnings') {
    const person = target || sender;
    const list = data.warnings[`${jid}:${person}`] || [];
    return reply(sock, jid, list.length ? `⚠️ Warnings for @${digits(person)}:\n${list.map((w,i)=>`${i+1}. ${w.reason}`).join('\n')}` : 'No warnings recorded for that member.', [person]);
  }
  if (['antilink','antispam','welcome','goodbye'].includes(command)) {
    const value = parseOnOff(args[0]);
    if (value === null) return reply(sock, jid, `Usage: .${command} on/off`);
    settings[command] = value;
    saveData(data);
    return reply(sock, jid, `✅ ${command} is now ${value ? 'ON' : 'OFF'} for this group.`);
  }
  if (command === 'delete') {
    const key = quotedKey(msg);
    if (!key) return reply(sock, jid, 'Reply to the message you want to delete, then send .delete.');
    if (!await requireBotAdmin()) return;
    try { await sock.sendMessage(jid, { delete: key }); return; }
    catch { return reply(sock, jid, 'Could not delete that message. The bot may lack permission or the message may be too old.'); }
  }
  if (command === 'clear') return reply(sock, jid, 'ℹ️ .clear cannot erase everyone’s entire chat history. WhatsApp does not provide that bot capability, so this command is disabled.');

  // Fun commands are playful generators, not factual tests or claims about anyone.
  if (command === 'gay') {
    const person = target || sender;
    return reply(sock, jid, `🌈 Fun meter for @${digits(person)}: *${scoreFor(digits(person) + new Date().toDateString())}%*.\nJust a random joke score — it does not determine anyone's sexuality.`, [person]);
  }
  if (command === 'ship') {
    const people = targets.length >= 2 ? targets.slice(0,2) : [sender, target].filter(Boolean);
    if (people.length < 2) return reply(sock, jid, 'Mention two people: .ship @user @user2');
    const pct = scoreFor(people.join('') + 'ship');
    return reply(sock, jid, `💞 @${digits(people[0])} + @${digits(people[1])} = *${pct}%* compatibility (for fun only)!`, people);
  }
  if (command === '8ball') return reply(sock, jid, argsText ? `🎱 ${pick(ball)}` : 'Ask a question. Example: .8ball Will I win my next match?');
  if (command === 'joke') return reply(sock, jid, `😂 ${pick(jokes)}`);
  if (command === 'quote') return reply(sock, jid, `💬 ${pick(quotes)}`);
  if (command === 'meme') return reply(sock, jid, pick([
    'WHEN THE TEACHER SAYS “GROUP WORK” AND YOU KNOW YOU’RE THE WHOLE GROUP 😭',
    'ME: ONE MORE GAME. ALSO ME: WHY IS IT 2 AM? 🎮',
    'WHEN THE WIFI LAGS RIGHT AT THE FINAL BOSS: 💀',
    'I HAVE 99 PROBLEMS AND LOW BATTERY MADE IT 100 🔋'
  ]));
  if (command === 'truth') return reply(sock, jid, `🗣️ Truth: ${pick(truths)}`);
  if (command === 'dare') return reply(sock, jid, `🎯 Dare: ${pick(dares)}`);
  if (command === 'roast') {
    const person = target || sender;
    return reply(sock, jid, `🔥 @${digits(person)}, your loading screen has a loading screen. 😂 (Friendly roast!)`, [person]);
  }
  if (command === 'simp') {
    const person = target || sender;
    return reply(sock, jid, `💘 Simp meter for @${digits(person)}: ${scoreFor(digits(person) + 'simp')}%. Purely a joke!`, [person]);
  }

  // Award a point for using a recognized command, then report unknown commands.
  const known = ['menu','help','info','owner','ping','rules','profile','rank','kick','add','promote','demote','mute','unmute','tagall','hidetag','setname','setdesc','setpp','link','revoke','warn','warnings','antilink','antispam','welcome','goodbye','delete','clear','gay','ship','8ball','joke','quote','meme','truth','dare','roast','simp'];
  if (!known.includes(command)) return reply(sock, jid, `❓ Unknown command: .${command}\nType .menu to see the command list.`);
}

startBot().catch(err => {
  lastError = err.message || String(err);
  console.error('Bot startup failed:', err);
});
