// bot.js - Clean refactor single-file (slash + !panel kept)
// Node 18+ tested (syntax clean)

const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  SlashCommandBuilder,
  REST,
  Routes
} = require('discord.js');

const express = require('express');
const crypto = require('crypto');
const { MongoClient } = require('mongodb');

const app = express();
app.use(express.json());

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const API_SECRET = process.env.API_SECRET || 'change-this-secret';
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';

if (!DISCORD_TOKEN) {
  console.error('DISCORD_TOKEN not set in environment!');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ],
  partials: ['CHANNEL']
});

let db;
let keysCollection;
let usersCollection;

const pendingResets = new Map();

async function connectMongoDB() {
  try {
    const mongoClient = new MongoClient(MONGODB_URI);
    await mongoClient.connect();
    db = mongoClient.db('whitelist');
    keysCollection = db.collection('keys');
    usersCollection = db.collection('users');

    await keysCollection.createIndex({ key: 1 }, { unique: true });
    await usersCollection.createIndex({ userId: 1 }, { unique: true });

    console.log('Connected to MongoDB');
  } catch (err) {
    console.error('MongoDB connection failed:', err);
    process.exit(1);
  }
}

// DB helpers
async function getKey(key) {
  return await keysCollection.findOne({ key });
}
async function setKey(key, data) {
  return await keysCollection.updateOne({ key }, { $set: data }, { upsert: true });
}
async function getAllKeys() {
  return await keysCollection.find({}).toArray();
}
async function getUser(userId) {
  return await usersCollection.findOne({ userId });
}
async function setUser(userId, data) {
  return await usersCollection.updateOne({ userId }, { $set: data }, { upsert: true });
}
function generateKey() {
  return crypto.randomBytes(16).toString('hex').toUpperCase();
}

// ------------------ Message command: !panel (kept) ------------------
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (message.content !== '!panel') return;

  const embed = new EmbedBuilder()
    .setColor('#5865F2')
    .setTitle('✨ Astra Hub Whitelist Panel')
    .setDescription('Quản lý whitelist của bạn bằng các nút bên dưới.')
    .setThumbnail(client.user?.displayAvatarURL?.() || null)
    .addFields(
      { name: '📌 Chức năng', value: 'Reset HWID / Redeem Key / Xem Key' },
      { name: '🛡️ Bảo mật', value: 'Tất cả thao tác đều private & ephemeral.' }
    )
    .setFooter({ text: 'Astra Hub • Premium System' })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('resethwid').setLabel('🔄 Reset HWID').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('redeem_key').setLabel('🎟️ Redeem').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('manage_key').setLabel('🗂️ Manage').setStyle(ButtonStyle.Primary)
  );

  const dropdown = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('panel_dropdown')
      .setPlaceholder('Chọn chức năng…')
      .addOptions([
        { label: 'Reset HWID', value: 'dd_reset', emoji: '🔄' },
        { label: 'Redeem Key', value: 'dd_redeem', emoji: '🎟️' },
        { label: 'Manage Key', value: 'dd_manage', emoji: '🗂️' }
      ])
  );

  await message.channel.send({ embeds: [embed], components: [row, dropdown] });
});

// ------------------ Slash commands definition (array) ------------------
const slashCommands = [
  new SlashCommandBuilder().setName('stats').setDescription('Show bot statistics'),
  new SlashCommandBuilder().setName('blacklist').setDescription('Blacklist a key')
    .addStringOption(o => o.setName('key').setDescription('Key to blacklist').setRequired(true)),
  new SlashCommandBuilder().setName('addkey').setDescription('Create keys')
    .addIntegerOption(o => o.setName('quantity').setDescription('Number of keys').setRequired(true))
    .addIntegerOption(o => o.setName('duration').setDescription('Duration days (0 = lifetime)').setRequired(true)),
  new SlashCommandBuilder().setName('resethwid').setDescription('Reset HWID for one of your keys'),
  new SlashCommandBuilder().setName('redeem').setDescription('Redeem a key to your account')
    .addStringOption(o => o.setName('key').setDescription('Key to redeem').setRequired(true)),
  new SlashCommandBuilder().setName('managekey').setDescription('View your keys')
];

// register function (called on ready)
async function registerSlashCommands() {
  try {
    const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
    await rest.put(Routes.applicationCommands(client.user.id), { body: slashCommands.map(c => c.toJSON()) });
    console.log('Slash commands registered globally.');
  } catch (err) {
    console.error('Failed to register slash commands:', err);
  }
}

// ------------------ Single interaction handler ------------------
client.on('interactionCreate', async (interaction) => {
  try {
    // -------------------- Handle chat input /slash commands --------------------
    if (interaction.isChatInputCommand()) {
      const commandName = interaction.commandName;

      // /stats
      if (commandName === 'stats') {
        const totalKeys = await keysCollection.countDocuments();
        const totalUsers = await usersCollection.countDocuments();
        const embed = new EmbedBuilder()
          .setColor('#00FF00')
          .setTitle('Bot Statistics')
          .addFields(
            { name: 'Total Keys', value: String(totalKeys), inline: true },
            { name: 'Total Users', value: String(totalUsers), inline: true },
            { name: 'Uptime', value: `${Math.floor(client.uptime / 1000 / 60)} minutes`, inline: true }
          )
          .setTimestamp();
        return await interaction.reply({ embeds: [embed], ephemeral: true });
      }

      // /blacklist
      if (commandName === 'blacklist') {
        const key = interaction.options.getString('key');
        const member = await interaction.guild.members.fetch(interaction.user.id);
        if (!member.roles.cache.some(r => r.name === 'Whitelist')) {
          return interaction.reply({ content: 'Missing Whitelist role', ephemeral: true });
        }
        const keyData = await getKey(key);
        if (!keyData) return interaction.reply({ content: 'Key not found', ephemeral: true });
        if (!keyData.active) return interaction.reply({ content: 'Key already blacklisted', ephemeral: true });

        await setKey(key, { ...keyData, active: false, blacklistedAt: Date.now(), blacklistedBy: interaction.user.id });

        // log
        const logCollection = db.collection('blacklist_logs');
        await logCollection.insertOne({
          key,
          blacklistedBy: interaction.user.id,
          blacklistedByTag: interaction.user.tag,
          blacklistedAt: Date.now(),
          previousOwner: keyData.userId || null
        });

        const embed = new EmbedBuilder()
          .setColor('#ff4444')
          .setTitle('⛔ Key Blacklisted')
          .addFields(
            { name: 'Key', value: `${key}` },
            { name: 'Blacklisted By', value: `<@${interaction.user.id}>` },
            { name: 'Previous Owner', value: keyData.userId ? `<@${keyData.userId}>` : 'Not redeemed' }
          )
          .setTimestamp();

        return interaction.reply({ embeds: [embed], ephemeral: true });
      }

      // /addkey
      if (commandName === 'addkey') {
        const quantity = interaction.options.getInteger('quantity');
        const duration = interaction.options.getInteger('duration');
        const member = await interaction.guild.members.fetch(interaction.user.id);
        if (!member.roles.cache.some(r => r.name === 'Whitelist')) {
          return interaction.reply({ content: 'Missing Whitelist role', ephemeral: true });
        }

        if (quantity < 1 || quantity > 100) {
          return interaction.reply({ content: 'Quantity must be 1-100', ephemeral: true });
        }

        const createdKeys = [];
        for (let i = 0; i < quantity; i++) {
          const key = generateKey();
          const expiresAt = duration > 0 ? Date.now() + duration * 24 * 60 * 60 * 1000 : null;
          await setKey(key, {
            key,
            userId: null,
            hwid: null,
            active: true,
            expiresAt,
            createdAt: Date.now(),
            createdBy: interaction.user.id,
            redeemedAt: null
          });
          createdKeys.push({ key, expiresAt });
        }

        // log creation
        const logCollection = db.collection('key_creation_logs');
        await logCollection.insertOne({
          createdBy: interaction.user.id,
          createdByTag: interaction.user.tag,
          quantity,
          duration,
          keys: createdKeys.map(k => k.key),
          createdAt: Date.now()
        });

        // DM full list
        try {
          const dm = await interaction.user.createDM();
          await dm.send(`**Your Created Keys (${quantity})**\n\n\`\`\`${createdKeys.map(k => k.key).join('\n')}\`\`\``);
        } catch (err) {
          console.warn('Could not send DM for created keys:', err?.message || err);
        }

        const embed = new EmbedBuilder()
          .setColor('#00cc88')
          .setTitle('✅ Keys Created')
          .setDescription(`Created **${quantity}** keys (${duration === 0 ? 'lifetime' : duration + ' days'})`)
          .setTimestamp();

        return interaction.reply({ embeds: [embed], ephemeral: true });
      }

      // /redeem
      if (commandName === 'redeem') {
        const key = interaction.options.getString('key');
        const keyData = await getKey(key);
        if (!keyData) return interaction.reply({ content: 'Invalid key', ephemeral: true });
        if (!keyData.active) return interaction.reply({ content: 'Key is blacklisted', ephemeral: true });
        if (keyData.userId) return interaction.reply({ content: 'Key already redeemed', ephemeral: true });
        if (keyData.expiresAt && Date.now() > keyData.expiresAt) return interaction.reply({ content: 'Key expired', ephemeral: true });

        await setKey(key, { ...keyData, userId: interaction.user.id, redeemedAt: Date.now() });

        const user = await getUser(interaction.user.id) || { userId: interaction.user.id, keys: [] };
        user.keys = user.keys || [];
        user.keys.push(key);
        await setUser(interaction.user.id, user);

        // auto add Premium role
        let roleMsg = 'No role assigned';
        try {
          const guild = interaction.guild;
          if (guild) {
            const role = guild.roles.cache.find(r => r.name === 'Premium');
            if (role) {
              const member = await guild.members.fetch(interaction.user.id);
              await member.roles.add(role);
              roleMsg = 'Premium role added';
            } else {
              roleMsg = 'Role Premium not found';
            }
          }
        } catch (err) {
          console.warn('Role assign error:', err);
          roleMsg = 'Error assigning role';
        }

        // log redeem
        await db.collection('redeem_logs').insertOne({
          userId: interaction.user.id,
          userTag: interaction.user.tag,
          key,
          redeemedAt: Date.now()
        });

        const embed = new EmbedBuilder()
          .setColor('#33aaee')
          .setTitle('🎉 Key Redeemed')
          .addFields(
            { name: 'Key', value: `\`${key}\`` },
            { name: 'User', value: `<@${interaction.user.id}>` },
            { name: 'Role', value: roleMsg }
          )
          .setTimestamp();

        return interaction.reply({ embeds: [embed], ephemeral: true });
      }

      // /resethwid (starts flow by showing select menu)
      if (commandName === 'resethwid') {
        const user = await getUser(interaction.user.id);
        if (!user || !user.keys || user.keys.length === 0) {
          return interaction.reply({ content: "You don't have any keys.", ephemeral: true });
        }
        const keysWithHwid = [];
        for (const k of user.keys) {
          const kd = await getKey(k);
          if (kd && kd.hwid) keysWithHwid.push({ key: k, hwid: kd.hwid });
        }
        if (keysWithHwid.length === 0) {
          return interaction.reply({ content: 'You have no keys with HWID registered.', ephemeral: true });
        }

        const menu = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId('slash_reset_select')
            .setPlaceholder('Select a key to reset HWID')
            .addOptions(keysWithHwid.map((item, idx) => ({
              label: `Key #${idx + 1}`,
              description: `${item.key.substring(0, 20)}...`,
              value: item.key
            })))
        );

        return interaction.reply({
          content: `You have **${keysWithHwid.length}** key(s) with HWID. Select one to reset.`,
          components: [menu],
          ephemeral: true
        });
      }

      // /managekey
      if (commandName === 'managekey') {
        const user = await getUser(interaction.user.id);
        if (!user || !user.keys || user.keys.length === 0) {
          return interaction.reply({ content: "You don't have keys.", ephemeral: true });
        }

        const menu = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId('slash_manage_select')
            .setPlaceholder('Select key to view')
            .addOptions(user.keys.map((k, i) => ({
              label: `Key #${i + 1}`,
              description: `${k.substring(0, 20)}...`,
              value: k
            })))
        );

        const embed = new EmbedBuilder()
          .setColor('#0099FF')
          .setTitle('🗂️ Your Keys')
          .setDescription(`You have **${user.keys.length}** key(s). Select one below.`)
          .setTimestamp();

        return interaction.reply({ embeds: [embed], components: [menu], ephemeral: true });
      }
    }

    // -------------------- Handle selects and buttons --------------------
    // panel dropdown (from !panel)
    if (interaction.isStringSelectMenu() && interaction.customId === 'panel_dropdown') {
      const val = interaction.values[0];
      if (val === 'dd_reset') return interaction.reply({ content: 'Use /resethwid to proceed (slash).', ephemeral: true });
      if (val === 'dd_redeem') return interaction.reply({ content: 'Use /redeem <key> to redeem (slash).', ephemeral: true });
      if (val === 'dd_manage') return interaction.reply({ content: 'Use /managekey to view your keys (slash).', ephemeral: true });
    }

    // reset select
    if (interaction.isStringSelectMenu() && interaction.customId === 'slash_reset_select') {
      const selectedKey = interaction.values[0];
      const keyData = await getKey(selectedKey);
      const user = await getUser(interaction.user.id) || {};
      const member = interaction.guild ? await interaction.guild.members.fetch(interaction.user.id) : null;

      // role-based cooldown determination
      let cooldownTime = 0;
      let cooldownName = '';
      if (member && member.roles.cache.some(r => r.name === 'Reset Access')) {
        cooldownTime = 1000; cooldownName = '1 second';
      } else if (member && member.roles.cache.some(r => r.name === 'Server Booster')) {
        cooldownTime = 12 * 60 * 60 * 1000; cooldownName = '12 hours';
      } else if (member && member.roles.cache.some(r => r.name === 'Premium')) {
        cooldownTime = 2.5 * 24 * 60 * 60 * 1000; cooldownName = '2.5 days';
      } else {
        return interaction.reply({ content: 'You need Premium role to reset HWID.', ephemeral: true });
      }

      const last = user.lastHwidReset || 0;
      if (Date.now() - last < cooldownTime) {
        const left = cooldownTime - (Date.now() - last);
        const hours = Math.ceil(left / (60 * 60 * 1000));
        return interaction.reply({ content: `Cooldown! Try again in approx ${hours} hour(s).`, ephemeral: true });
      }

      if (!keyData || !keyData.hwid) {
        return interaction.reply({ content: 'Selected key has no HWID registered.', ephemeral: true });
      }

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`slash_confirm_reset_${selectedKey}`).setLabel('Confirm Reset').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('slash_cancel_reset').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
      );

      const embed = new EmbedBuilder()
        .setColor('#ff4444')
        .setTitle('Confirm HWID Reset')
        .setDescription(`Key: \`${selectedKey}\`\nHWID: \`${keyData.hwid}\`\nCooldown after reset: **${cooldownName}**`)
        .setTimestamp();

      return interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
    }

    // confirm reset button
    if (interaction.isButton() && interaction.customId.startsWith('slash_confirm_reset_')) {
      const key = interaction.customId.replace('slash_confirm_reset_', '');
      const keyData = await getKey(key);
      if (!keyData) return interaction.reply({ content: 'Key not found.', ephemeral: true });

      await setKey(key, { ...keyData, hwid: null });

      const user = await getUser(interaction.user.id) || { userId: interaction.user.id };
      await setUser(interaction.user.id, { ...user, lastHwidReset: Date.now(), hwidResetCount: (user.hwidResetCount || 0) + 1 });

      // log to mongo
      await db.collection('hwid_reset_logs').insertOne({
        userId: interaction.user.id,
        userTag: interaction.user.tag,
        key,
        oldHwid: keyData.hwid,
        resetAt: Date.now()
      });

      const embed = new EmbedBuilder()
        .setColor('#22dd22')
        .setTitle('HWID Reset Successful')
        .setDescription(`Key: \`${key}\``)
        .setTimestamp();

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // cancel reset button
    if (interaction.isButton() && interaction.customId === 'slash_cancel_reset') {
      return interaction.reply({ content: 'HWID reset cancelled.', ephemeral: true });
    }

    // manage select -> show details with Back button
    if (interaction.isStringSelectMenu() && interaction.customId === 'slash_manage_select') {
      const key = interaction.values[0];
      const data = await getKey(key);
      if (!data) return interaction.reply({ content: 'Key not found.', ephemeral: true });

      const embed = new EmbedBuilder()
        .setColor(data.active ? '#22dd99' : '#dd4444')
        .setTitle('🔍 Key Details')
        .addFields(
          { name: 'Key', value: `\`${key}\`` },
          { name: 'Status', value: data.active ? 'Active' : 'Inactive', inline: true },
          { name: 'Expires', value: data.expiresAt ? new Date(data.expiresAt).toLocaleString() : 'Lifetime', inline: true },
          { name: 'HWID', value: data.hwid || 'Not registered', inline: false },
          { name: 'Redeemed', value: data.redeemedAt ? new Date(data.redeemedAt).toLocaleString() : 'Not redeemed', inline: false }
        )
        .setTimestamp();

      const backRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('slash_manage_back').setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary)
      );

      return interaction.reply({ embeds: [embed], components: [backRow], ephemeral: true });
    }

    // manage back button -> re-show menu
    if (interaction.isButton() && interaction.customId === 'slash_manage_back') {
      const user = await getUser(interaction.user.id);
      const menu = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('slash_manage_select')
          .setPlaceholder('Select key')
          .addOptions((user.keys || []).map((k, i) => ({ label: `Key #${i + 1}`, value: k })))
      );
      return interaction.reply({ content: 'Your keys:', components: [menu], ephemeral: true });
    }

    // panel buttons (from !panel message)
    if (interaction.isButton() && interaction.customId === 'resethwid') {
      return interaction.reply({ content: 'Use /resethwid (slash) to reset HWID.', ephemeral: true });
    }
    if (interaction.isButton() && interaction.customId === 'redeem_key') {
      return interaction.reply({ content: 'Use /redeem <key> (slash) to redeem.', ephemeral: true });
    }
    if (interaction.isButton() && interaction.customId === 'manage_key') {
      return interaction.reply({ content: 'Use /managekey (slash) to manage keys.', ephemeral: true });
    }
  } catch (err) {
    console.error('interaction handler error:', err);
    if (interaction && !interaction.replied) {
      try { await interaction.reply({ content: 'An error occurred.', ephemeral: true }); } catch (e) {}
    }
  }
});

// ------------------ API endpoints (kept) ------------------
function authenticate(req, res, next) {
  if (req.headers['x-api-key'] !== API_SECRET) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

app.get('/', async (req, res) => {
  const totalKeys = await keysCollection.countDocuments();
  const totalUsers = await usersCollection.countDocuments();
  res.json({
    status: 'OK',
    bot: client.user ? client.user.tag : 'Not ready',
    uptime: Math.floor(process.uptime()),
    keys: totalKeys,
    users: totalUsers
  });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString(), uptime: process.uptime(), memory: process.memoryUsage() });
});

app.post('/api/keys/create', authenticate, async (req, res) => {
  const { duration, quantity = 1 } = req.body;
  if (quantity > 100) return res.status(400).json({ error: 'Maximum 100 keys per request' });

  const createdKeys = [];
  for (let i = 0; i < quantity; i++) {
    const key = generateKey();
    const expiresAt = duration ? Date.now() + duration * 24 * 60 * 60 * 1000 : null;
    await setKey(key, { key, userId: null, hwid: null, active: true, expiresAt, createdAt: Date.now(), redeemedAt: null });
    createdKeys.push({ key, expires: expiresAt ? new Date(expiresAt).toISOString() : 'Never' });
  }

  await db.collection('key_creation_logs').insertOne({ createdBy: 'api', quantity, duration, createdAt: Date.now(), keys: createdKeys.map(k => k.key) });

  res.json({ success: true, count: quantity, keys: createdKeys });
});

app.get('/api/keys/check/:key', authenticate, async (req, res) => {
  const { key } = req.params;
  const keyData = await getKey(key);
  if (!keyData) return res.status(404).json({ error: 'Key not found' });
  res.json({ key, ...keyData, isExpired: keyData.expiresAt && Date.now() > keyData.expiresAt });
});

app.get('/api/keys/list', authenticate, async (req, res) => {
  const allKeys = await getAllKeys();
  const keysWithStatus = allKeys.map(k => ({ ...k, isExpired: k.expiresAt && Date.now() > k.expiresAt }));
  res.json({ success: true, total: keysWithStatus.length, keys: keysWithStatus });
});

app.post('/api/verify', async (req, res) => {
  const { key, hwid } = req.body;
  if (!key || !hwid) return res.status(400).json({ success: false, message: 'Key and HWID required' });

  const keyData = await getKey(key);
  if (!keyData) return res.json({ success: false, message: 'Invalid key' });
  if (!keyData.active) return res.json({ success: false, message: 'Key is blacklisted' });
  if (keyData.expiresAt && Date.now() > keyData.expiresAt) return res.json({ success: false, message: 'Key expired' });
  if (!keyData.userId) return res.json({ success: false, message: 'Key not redeemed yet' });

  if (!keyData.hwid) {
    await setKey(key, { ...keyData, hwid });
    await db.collection('hwid_register_logs').insertOne({ key, hwid, registeredAt: Date.now() });
    return res.json({ success: true, message: 'HWID registered successfully' });
  }
  if (keyData.hwid === hwid) return res.json({ success: true, message: 'Access granted' });
  return res.json({ success: false, message: 'HWID mismatch' });
});

// ------------------ Start function ------------------
async function start() {
  await connectMongoDB();
  app.listen(PORT, () => console.log(`API running on port ${PORT}`));
  client.login(DISCORD_TOKEN).catch(err => {
    console.error('Discord login failed:', err);
    process.exit(1);
  });
  client.once('ready', async () => {
    console.log(`Bot online: ${client.user.tag}`);
    await registerSlashCommands();
  });
}

start();
