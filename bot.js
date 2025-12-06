// bot.js - Full system: API + Discord bot + Mongo optional + JSON fallback
const express = require('express');
const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const { Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

// dynamic fetch for Node
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

/* ---------------- CONFIG ---------------- */
const PORT = process.env.PORT || 3000;
const SECRET_API_KEY = process.env.SECRET_API_KEY || 'my-secret-key-123456';
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const MONGODB_URI = process.env.MONGODB_URI || null; // optional
const DB_FILE = path.join(__dirname, 'data', 'db.json'); // fallback file DB

/* ---------------- STORAGE LAYER (Mongo or File) ---------------- */

let KeyModel = null;
let useMongo = false;

async function ensureDirForFile(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true }).catch(()=>{});
}

if (MONGODB_URI) {
  try {
    const mongoose = require('mongoose');
    mongoose.set('strictQuery', false);
    mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
      .then(()=> console.log('MongoDB connected'))
      .catch(err => console.error('MongoDB connect error:', err));
    const KeySchema = new mongoose.Schema({
      key: { type: String, unique: true },
      expiresAt: Date,
      active: { type: Boolean, default: true },
      used: { type: Boolean, default: false },
      createdAt: { type: Date, default: Date.now },
      redeemedBy: { type: String, default: null },
      redeemedAt: { type: Date, default: null }
    });
    KeyModel = mongoose.models.Key || mongoose.model('Key', KeySchema);
    useMongo = true;
    console.log('Using MongoDB for storage');
  } catch (err) {
    console.error('Failed to load mongoose, falling back to file DB:', err);
    useMongo = false;
  }
}

const fileDB = {
  data: { keys: [] },
  async load() {
    try {
      await ensureDirForFile(DB_FILE);
      const txt = await fs.readFile(DB_FILE, 'utf8').catch(()=>null);
      if (!txt) {
        this.data = { keys: [] };
        await this.save();
      } else {
        this.data = JSON.parse(txt);
        if (!this.data.keys) this.data.keys = [];
      }
    } catch (e) {
      console.error('fileDB load error', e);
      this.data = { keys: [] };
    }
  },
  async save() {
    try {
      await ensureDirForFile(DB_FILE);
      await fs.writeFile(DB_FILE, JSON.stringify(this.data, null, 2));
    } catch (e) {
      console.error('fileDB save error', e);
    }
  },
  async createKey(obj) {
    this.data.keys.push(obj);
    await this.save();
    return obj;
  },
  async findKey(k) {
    return this.data.keys.find(x => x.key === k) || null;
  },
  async updateKey(k, patch) {
    const idx = this.data.keys.findIndex(x => x.key === k);
    if (idx === -1) return null;
    this.data.keys[idx] = { ...this.data.keys[idx], ...patch };
    await this.save();
    return this.data.keys[idx];
  },
  async listKeys() { return this.data.keys.slice(); },
  async blacklistKey(k) { return this.updateKey(k, { active: false }); }
};

/* ---------------- HELPERS ---------------- */

function generateKey() {
  return crypto.randomBytes(12).toString('hex').toUpperCase(); // shorter, still random
}

async function createKeys({ durationMinutes = 30, quantity = 1 }) {
  const created = [];
  for (let i = 0; i < quantity; i++) {
    const key = generateKey();
    const expiresAt = durationMinutes ? new Date(Date.now() + durationMinutes * 60000) : null;
    if (useMongo && KeyModel) {
      const doc = await KeyModel.create({ key, expiresAt });
      created.push({ key: doc.key, expiresAt: doc.expiresAt });
    } else {
      await fileDB.load();
      const obj = { key, expiresAt: expiresAt ? expiresAt.toISOString() : null, active: true, used: false, createdAt: new Date().toISOString() };
      await fileDB.createKey(obj);
      created.push({ key: obj.key, expiresAt: obj.expiresAt });
    }
  }
  return created;
}

async function findKeyRecord(key) {
  if (useMongo && KeyModel) {
    return await KeyModel.findOne({ key }).lean();
  } else {
    await fileDB.load();
    return await fileDB.findKey(key);
  }
}

async function markKeyUsed(key, userId=null) {
  if (useMongo && KeyModel) {
    return await KeyModel.findOneAndUpdate({ key }, { used: true, redeemedBy: userId, redeemedAt: new Date() }, { new: true });
  } else {
    await fileDB.load();
    return await fileDB.updateKey(key, { used: true, redeemedBy: userId, redeemedAt: new Date().toISOString() });
  }
}

async function blacklistKey(key) {
  if (useMongo && KeyModel) {
    return await KeyModel.findOneAndUpdate({ key }, { active: false }, { new: true });
  } else {
    await fileDB.load();
    return await fileDB.blacklistKey(key);
  }
}

async function listAllKeys() {
  if (useMongo && KeyModel) {
    return await KeyModel.find().lean();
  } else {
    await fileDB.load();
    return await fileDB.listKeys();
  }
}

/* ---------------- EXPRESS API ---------------- */
const app = express();
app.use(express.json());

function authenticate(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey || apiKey !== SECRET_API_KEY) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

app.get('/', (req, res) => {
  res.json({ status: 'OK', mode: useMongo ? 'mongo' : 'file', uptime: process.uptime() });
});

// create keys: duration = minutes, quantity
app.post('/api/keys/create', authenticate, async (req, res) => {
  try {
    const duration = Number(req.body.duration) || 30;
    const quantity = Math.min(100, Number(req.body.quantity) || 1);
    const created = await createKeys({ durationMinutes: duration, quantity });
    return res.json({ success: true, count: created.length, keys: created });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
});

// verify key (API, for external apps)
// marks key used if valid
app.post('/api/keys/verify', authenticate, async (req, res) => {
  try {
    const { key } = req.body;
    if (!key) return res.status(400).json({ success:false, message: 'Missing key' });
    const rec = await findKeyRecord(key);
    if (!rec) return res.json({ success:false, message: 'Invalid key' });
    if (rec.active === false) return res.json({ success:false, message: 'Blacklisted' });
    if (rec.used) return res.json({ success:false, message: 'Already used' });
    if (rec.expiresAt && new Date(rec.expiresAt) < new Date()) return res.json({ success:false, message: 'Expired' });
    await markKeyUsed(key,null);
    return res.json({ success:true, message: 'OK' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ success:false, message: 'Server error' });
  }
});

app.post('/api/keys/blacklist', authenticate, async (req, res) => {
  try {
    const { key } = req.body;
    if (!key) return res.status(400).json({ error: 'Missing key' });
    const updated = await blacklistKey(key);
    if (!updated) return res.status(404).json({ error: 'Key not found' });
    return res.json({ success: true, key });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/keys/list', authenticate, async (req, res) => {
  try {
    const all = await listAllKeys();
    return res.json({ success:true, total: all.length, keys: all });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/keys/check/:key', authenticate, async (req, res) => {
  try {
    const rec = await findKeyRecord(req.params.key);
    if (!rec) return res.status(404).json({ error: 'Key not found' });
    const isExpired = rec.expiresAt ? (new Date(rec.expiresAt) < new Date()) : false;
    return res.json({ key: rec.key, active: rec.active, used: rec.used, expiresAt: rec.expiresAt, isExpired });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
});

/* ---------------- DISCORD BOT ---------------- */
const client = new Client({
  intents: [ GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.DirectMessages ],
  partials: [ Partials.Channel ]
});

const buttonsRow = new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId('redeem_key').setLabel('Redeem Key').setStyle(ButtonStyle.Success),
  new ButtonBuilder().setCustomId('get_key').setLabel('Get Key (30m)').setStyle(ButtonStyle.Secondary)
);

client.once('clientReady' in client ? 'clientReady' : 'ready', () => { // support deprecation warning
  console.log(`✅ Bot online: ${client.user.tag}`);
  console.log(`🚀 API Server running on port ${PORT}`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const content = message.content.trim();

  // show panel
  if (content === '!whitelist') {
    const embed = new EmbedBuilder()
      .setTitle('Whitelist Panel')
      .setDescription('Use buttons or commands:\n• `!getkey` – receive a key (30 minutes)\n• `!whitelist <key>` – redeem key')
      .setTimestamp();
    return message.channel.send({ embeds:[embed], components:[buttonsRow] });
  }

  // getkey command
  if (content.startsWith('!getkey')) {
    const durationMinutes = 30;
    const created = await createKeys({ durationMinutes, quantity: 1 });
    return message.reply(`🔑 Key created:\n\`${created[0].key}\`\nExpires in ${durationMinutes} minutes.`);
  }

  // whitelist command
  if (content.startsWith('!whitelist')) {
    const parts = content.split(/\s+/);
    if (!parts[1]) return message.reply('❌ Vui lòng nhập key. Ví dụ: `!whitelist ABC123`');
    const k = parts[1].trim();
    // verify locally (no need for HTTP call)
    const rec = await findKeyRecord(k);
    if (!rec) return message.reply('❌ Key không hợp lệ.');
    if (rec.active === false) return message.reply('❌ Key đã bị blacklist.');
    if (rec.used) return message.reply('❌ Key đã được sử dụng.');
    if (rec.expiresAt && new Date(rec.expiresAt) < new Date()) return message.reply('❌ Key đã hết hạn.');
    await markKeyUsed(k, message.author.id);
    return message.reply('✅ Key hợp lệ — bạn đã được whitelist!');
  }
});

// Interaction buttons
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;
  const id = interaction.customId;
  const userId = interaction.user.id;

  if (id === 'get_key') {
    await interaction.reply({ content: '⏳ Tạo key...' , ephemeral: true});
    const created = await createKeys({ durationMinutes: 30, quantity: 1 });
    return interaction.followUp({ content: `🔑 Key: \`${created[0].key}\` (30m)`, ephemeral: true });
  }

  if (id === 'redeem_key') {
    await interaction.reply({ content: '🔑 Mình đã gửi cho bạn 1 DM để nhập key.', ephemeral: true });
    try {
      const dm = await interaction.user.createDM();
      await dm.send('Vui lòng nhập key (60s):');

      const filter = m => m.author.id === userId;
      const collected = await dm.awaitMessages({ filter, max: 1, time: 60000 }).catch(()=>null);
      if (!collected) return dm.send('⏱️ Hết thời gian.');
      const k = collected.first().content.trim();
      const rec = await findKeyRecord(k);
      if (!rec) return dm.send('❌ Key không hợp lệ.');
      if (rec.active === false) return dm.send('❌ Key đã bị blacklist.');
      if (rec.used) return dm.send('❌ Key đã được sử dụng.');
      if (rec.expiresAt && new Date(rec.expiresAt) < new Date()) return dm.send('❌ Key đã hết hạn.');
      await markKeyUsed(k, interaction.user.id);
      return dm.send('✅ Redeem thành công — bạn đã được whitelist!');
    } catch (err) {
      console.error('DM error', err);
      return interaction.followUp({ content: '❌ Không thể gửi DM. Vui lòng bật DM.', ephemeral: true });
    }
  }
});

/* ---------------- START SERVER & LOGIN ---------------- */
app.listen(PORT, () => {
  console.log(`API running on port ${PORT}`);
});

if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN missing. Add it to Railway Variables.');
  process.exit(1);
}
client.login(BOT_TOKEN).catch(err => {
  console.error('Discord login failed:', err);
  process.exit(1);
});
