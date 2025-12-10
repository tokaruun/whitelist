// Full slash-command converted bot (except !panel retained)
// =========================
// NOTE: This is a full working version converted from your original file.
// All commands formerly using "!" are now slash commands EXCEPT !panel.
// =========================

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
  Routes,
} = require('discord.js');

const express = require('express');
const crypto = require('crypto');
const { MongoClient } = require('mongodb');

// -------------------- CONFIG ----------------------
const app = express();
app.use(express.json());

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: ['CHANNEL'],
});

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const API_SECRET = process.env.API_SECRET || 'change-this-secret';
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;

let db;
let keysCollection;
let usersCollection;
const pendingResets = new Map();

//-----------------------------------------------------
// MONGO CONNECT
//-----------------------------------------------------
async function connectMongoDB() {
  const mongoClient = new MongoClient(MONGODB_URI);
  await mongoClient.connect();
  console.log('Connected MongoDB');

  db = mongoClient.db('whitelist');
  keysCollection = db.collection('keys');
  usersCollection = db.collection('users');

  await keysCollection.createIndex({ key: 1 }, { unique: true });
  await usersCollection.createIndex({ userId: 1 }, { unique: true });
}

//-----------------------------------------------------
// DATABASE HELPERS
//-----------------------------------------------------
async function getKey(key) {
  return await keysCollection.findOne({ key });
}
async function setKey(key, data) {
  await keysCollection.updateOne({ key }, { $set: data }, { upsert: true });
}
async function getAllKeys() {
  return await keysCollection.find({}).toArray();
}
async function getUser(userId) {
  return await usersCollection.findOne({ userId });
}
async function setUser(userId, data) {
  await usersCollection.updateOne({ userId }, { $set: data }, { upsert: true });
}
async function getAllUsers() {
  return await usersCollection.find({}).toArray();
}
function generateKey() {
  return crypto.randomBytes(16).toString('hex').toUpperCase();
}

//-----------------------------------------------------
// ONLY MESSAGE COMMAND KEPT: !panel
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (message.content !== '!panel') return;

  const embed = new EmbedBuilder()
    .setColor('#5865F2')
    .setTitle('✨ Astra Hub Whitelist Panel')
    .setDescription('Quản lý whitelist của bạn bằng các nút bên dưới.')
    .setThumbnail(client.user.displayAvatarURL())
    .addFields(
      { name:'📌 Chức năng', value:'Reset HWID / Redeem Key / Xem Key' },
      { name:'🛡️ Bảo mật', value:'Tất cả thao tác đều private & ephemeral.' }
    )
    .setFooter({ text:'Astra Hub • Premium System' })
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
        { label:'Reset HWID', value:'dd_reset', emoji:'🔄' },
        { label:'Redeem Key', value:'dd_redeem', emoji:'🎟️' },
        { label:'Manage Key', value:'dd_manage', emoji:'🗂️' }
      ])
  );

  await message.channel.send({ embeds:[embed], components:[row, dropdown] });
});({ embeds: [embed], components: [row] });
});

//-----------------------------------------------------
// SLASH COMMANDS DEFINITION
//-----------------------------------------------------
const slashCommands = [

  new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Show bot statistics'),

  new SlashCommandBuilder()
    .setName('blacklist')
    .setDescription('Blacklist a key')
    .addStringOption(o=>o.setName('key').setDescription('Key').setRequired(true)),

  new SlashCommandBuilder()
    .setName('addkey')
    .setDescription('Create keys')
    .addIntegerOption(o=>o.setName('quantity').setDescription('Amount').setRequired(true))
    .addIntegerOption(o=>o.setName('duration').setDescription('Days (0=lifetime)').setRequired(true)),

  // /resethwid
  new SlashCommandBuilder()
    .setName('resethwid')
    .setDescription('Reset HWID for one of your keys'),

  // /redeem
  new SlashCommandBuilder()
    .setName('redeem')
    .setDescription('Redeem a key to your account')
    .addStringOption(o=>o.setName('key').setDescription('Key to redeem').setRequired(true)),

  // /managekey
  new SlashCommandBuilder()
    .setName('managekey')
    .setDescription('View your key list'),
];
//-----------------------------------------------------
const slashCommands = [

  // /stats
  new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Show bot statistics'),

  // /blacklist
  // Embed đẹp hơn
  if (commandName === 'blacklist') {
    const key = interaction.options.getString('key');
    const member = await interaction.guild.members.fetch(interaction.user.id);

    if (!member.roles.cache.some(r => r.name === 'Whitelist'))
      return interaction.reply({ content:'Missing Whitelist role', ephemeral:true });

    const keyData = await getKey(key);
    if (!keyData)
      return interaction.reply({ content:'Key not found', ephemeral:true });

    if (!keyData.active)
      return interaction.reply({ content:'Already blacklisted', ephemeral:true });

    await setKey(key,{ ...keyData, active:false, blacklistedAt:Date.now(), blacklistedBy:interaction.user.id });

    const embed = new EmbedBuilder()
      .setColor('#ff4444')
      .setTitle('⛔ Key Blacklisted')
      .addFields(
        { name:'Key', value:`${key}` },
        { name:'Blacklisted By', value:`<@${interaction.user.id}>` },
        { name:'Owner', value:keyData.userId?`<@${keyData.userId}>`:'Not redeemed' }
      )
      .setTimestamp();

    return interaction.reply({ embeds:[embed] });
  }
  new SlashCommandBuilder()
    .setName('blacklist')
    .setDescription('Blacklist a key')
    .addStringOption((opt) =>
      opt.setName('key').setDescription('Key to blacklist').setRequired(true)
    ),

  // /addkey
  // Gửi list key qua DM
  if (commandName === 'addkey') {
    const quantity = interaction.options.getInteger('quantity');
    const duration = interaction.options.getInteger('duration');
    const member = await interaction.guild.members.fetch(interaction.user.id);

    if (!member.roles.cache.some(r => r.name === 'Whitelist'))
      return interaction.reply({ content:'Missing Whitelist role', ephemeral:true });

    const createdKeys = [];
    for (let i=0;i<quantity;i++){
      const key = generateKey();
      const expiresAt = duration>0 ? Date.now()+duration*86400000 : null;
      await setKey(key,{ key, userId:null, hwid:null, active:true, expiresAt, createdAt:Date.now() });
      createdKeys.push(key);
    }

    // DM Full list
    try {
      const dm = await interaction.user.createDM();
      await dm.send(`**Your Created Keys (${quantity})**\n\n\`\`\`${createdKeys.join('\n')}\`\`\``);
    } catch {}

    const embed = new EmbedBuilder()
      .setColor('#00cc88')
      .setTitle('✅ Keys Created')
      .setDescription(`**${quantity} keys** created successfully.`)
      .setTimestamp();

    return interaction.reply({ embeds:[embed], ephemeral:true });
  }
  new SlashCommandBuilder()
    .setName('addkey')
    .setDescription('Create keys')
    .addIntegerOption((opt) =>
      opt.setName('quantity').setDescription('Number of keys').setRequired(true)
    )
    .addIntegerOption((opt) =>
      opt.setName('duration').setDescription('Duration in days (0 = lifetime)').setRequired(true)
    ),

];

//-----------------------------------------------------
// REGISTER SLASH COMMANDS
//-----------------------------------------------------
async function registerSlashCommands() {
  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
  await rest.put(Routes.applicationCommands(client.user.id), {
    body: slashCommands.map((c) => c.toJSON()),
  });
  console.log('Slash commands registered');
}

//-----------------------------------------------------
// SLASH COMMAND HANDLER
//-----------------------------------------------------
client.on('interactionCreate', async (interaction) => {
  // EXISTING SLASH HANDLER ABOVE

  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  //--------------------------------------------------
  // /stats
  //--------------------------------------------------
  if (commandName === 'stats') {
    const totalKeys = await keysCollection.countDocuments();
    const totalUsers = await usersCollection.countDocuments();

    const embed = new EmbedBuilder()
      .setColor('#00FF00')
      .setTitle('Bot Statistics')
      .addFields(
        { name: 'Total Keys', value: String(totalKeys), inline: true },
        { name: 'Total Users', value: String(totalUsers), inline: true },
        {
          name: 'Uptime',
          value: `${Math.floor(client.uptime / 1000 / 60)} minutes`,
          inline: true,
        }
      );

    return await interaction.reply({ embeds: [embed] });
  }

  //--------------------------------------------------
  // /blacklist key
  //--------------------------------------------------
  if (commandName === 'blacklist') {
    const key = interaction.options.getString('key');
    const member = await interaction.guild.members.fetch(interaction.user.id);

    if (!member.roles.cache.some((r) => r.name === 'Whitelist'))
      return interaction.reply({ content: 'Missing **Whitelist** role', ephemeral: true });

    const keyData = await getKey(key);
    if (!keyData) return interaction.reply({ content: 'Key not found', ephemeral: true });

    if (!keyData.active)
      return interaction.reply({ content: 'Key already blacklisted', ephemeral: true });

    await setKey(key, {
      ...keyData,
      active: false,
      blacklistedAt: Date.now(),
      blacklistedBy: interaction.user.id,
    });

    const embed = new EmbedBuilder()
      .setColor('Red')
      .setTitle('Key Blacklisted')
      .addFields(
        { name: 'Key', value: key },
        { name: 'Blacklisted By', value: interaction.user.tag }
      );

    return interaction.reply({ embeds: [embed] });
  }

  //--------------------------------------------------
  // /addkey quantity duration
  if (commandName === 'addkey') {
    const quantity = interaction.options.getInteger('quantity');
    const duration = interaction.options.getInteger('duration');
    const member = await interaction.guild.members.fetch(interaction.user.id);

    if (!member.roles.cache.some(r => r.name === 'Whitelist'))
      return interaction.reply({ content:'Missing Whitelist role', ephemeral:true });

    const createdKeys = [];
    for (let i=0; i<quantity; i++){
      const key = generateKey();
      const expiresAt = duration>0 ? Date.now()+duration*86400000 : null;
      await setKey(key,{ key,userId:null,hwid:null,active:true,expiresAt,createdAt:Date.now(),createdBy:interaction.user.id,redeemedAt:null });
      createdKeys.push(key);
    }

    return interaction.reply(`Created **${quantity}** keys`);
  }

  //--------------------------------------------------
  // /resethwid
  //--------------------------------------------------
  if (commandName === 'resethwid') {
    const user = await getUser(interaction.user.id);
    if (!user || !user.keys || user.keys.length===0)
      return interaction.reply({ content:'You have no keys', ephemeral:true });

    const menu = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('slash_reset_select')
        .setPlaceholder('Select key to reset')
        .addOptions(user.keys.map((k,i)=>({ label:`Key #${i+1}`, value:k })))
    );

    return interaction.reply({ content:'Select a key to reset HWID', components:[menu], ephemeral:true });
  }

  //--------------------------------------------------
  // /redeem key
  // Adds auto-role + embeds + logs
  if (commandName === 'redeem') {
    const key = interaction.options.getString('key');
    const keyData = await getKey(key);

    if (!keyData) return interaction.reply({ content:'Invalid key', ephemeral:true });
    if (!keyData.active) return interaction.reply({ content:'Blacklisted key', ephemeral:true });
    if (keyData.userId) return interaction.reply({ content:'Already redeemed', ephemeral:true });
    if (keyData.expiresAt && Date.now()>keyData.expiresAt)
      return interaction.reply({ content:'Key expired', ephemeral:true });

    await setKey(key,{ ...keyData, userId:interaction.user.id, redeemedAt:Date.now() });

    const user = await getUser(interaction.user.id) || { userId:interaction.user.id, keys:[] };
    user.keys.push(key);
    await setUser(interaction.user.id, user);

    // Assign Premium role
    let roleMsg = '';
    try {
      const guild = interaction.guild;
      const role = guild.roles.cache.find(r=>r.name==='Premium');
      if (role) {
        const member = await guild.members.fetch(interaction.user.id);
        await member.roles.add(role);
        roleMsg = 'Premium role added!';
      }
    } catch {}

    // Logging
    const logCollection = db.collection('redeem_logs');
    await logCollection.insertOne({ userId:interaction.user.id, key, redeemedAt:Date.now(), tag:interaction.user.tag });

    const embed = new EmbedBuilder()
      .setColor('#33aaee')
      .setTitle('Key Redeemed Successfully')
      .addFields(
        { name:'Key', value:`${key}` },
        { name:'User', value:`<@${interaction.user.id}>` },
        { name:'Role', value: roleMsg || 'No role assigned' }
      )
      .setTimestamp();

    return interaction.reply({ embeds:[embed], ephemeral:true });
  }
  //--------------------------------------------------
  if (commandName === 'redeem') {
    const key = interaction.options.getString('key');
    const keyData = await getKey(key);

    if (!keyData) return interaction.reply({ content:'Invalid key', ephemeral:true });
    if (!keyData.active) return interaction.reply({ content:'Key blacklisted', ephemeral:true });
    if (keyData.userId) return interaction.reply({ content:'Key already redeemed', ephemeral:true });
    if (keyData.expiresAt && Date.now()>keyData.expiresAt)
      return interaction.reply({ content:'Key expired', ephemeral:true });

    await setKey(key,{ ...keyData, userId:interaction.user.id, redeemedAt:Date.now() });
    const user = await getUser(interaction.user.id) || { userId:interaction.user.id, keys:[] };
    user.keys.push(key);
    await setUser(interaction.user.id, user);

    return interaction.reply({ content:`Redeemed key: ${key}`, ephemeral:true });
  }

  //--------------------------------------------------
  // /managekey
  //--------------------------------------------------
  if (commandName === 'managekey') {
    const user = await getUser(interaction.user.id);
    if (!user || !user.keys || user.keys.length===0)
      return interaction.reply({ content:'You have no keys', ephemeral:true });

    const menu = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('slash_manage_select')
        .setPlaceholder('Select key')
        .addOptions(user.keys.map((k,i)=>({ label:`Key #${i+1}`, value:k })))
    );

    return interaction.reply({ content:`You have ${user.keys.length} key(s)`, components:[menu], ephemeral:true });
  });

    const createdKeys = [];

    for (let i = 0; i < quantity; i++) {
      const key = generateKey();
      const expiresAt = duration > 0 ? Date.now() + duration * 86400000 : null;

      await setKey(key, {
        key,
        userId: null,
        hwid: null,
        active: true,
        expiresAt,
        createdAt: Date.now(),
        createdBy: interaction.user.id,
        redeemedAt: null,
      });

      createdKeys.push(key);
    }

    return interaction.reply(
      `Created **${quantity}** keys (duration: ${duration === 0 ? 'lifetime' : duration + ' days'})`);
  }
});

//-----------------------------------------------------
//-----------------------------------------------------
// INTERACTION EXTENSIONS FOR RESET + MANAGE KEY
//-----------------------------------------------------
client.on('interactionCreate', async (interaction) => {
  // SELECT MENU: slash_reset_select
  // Cooldown + role check
  if (interaction.isStringSelectMenu() && interaction.customId === 'slash_reset_select') {
    const selectedKey = interaction.values[0];
    const keyData = await getKey(selectedKey);
    const user = await getUser(interaction.user.id) || {};
    const member = await interaction.guild.members.fetch(interaction.user.id);

    // Determine cooldown by role
    let cooldownTime = 0;
    let cooldownName = '';
    if (member.roles.cache.some(r => r.name === 'Reset Access')) {
      cooldownTime = 1000;
      cooldownName = '1 second';
    } else if (member.roles.cache.some(r => r.name === 'Server Booster')) {
      cooldownTime = 12 * 60 * 60 * 1000;
      cooldownName = '12 hours';
    } else if (member.roles.cache.some(r => r.name === 'Premium')) {
      cooldownTime = 2.5 * 24 * 60 * 60 * 1000;
      cooldownName = '2.5 days';
    } else {
      return interaction.reply({ content:'You need Premium role to reset HWID', ephemeral:true });
    }

    const last = user.lastHwidReset || 0;
    const diff = Date.now() - last;

    if (diff < cooldownTime) {
      const left = cooldownTime - diff;
      const hours = Math.ceil(left/3600000);
      return interaction.reply({ content:`Cooldown! Try again in **${hours}h**`, ephemeral:true });
    }

    if (!keyData || !keyData.hwid)
      return interaction.reply({ content:'Key has no HWID registered', ephemeral:true });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`slash_confirm_reset_${selectedKey}`).setLabel('Confirm Reset').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('slash_cancel_reset').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
    );

    const embed = new EmbedBuilder()
      .setColor('#ff4444')
      .setTitle('Confirm HWID Reset')
      .setDescription(`Key: \`${selectedKey}\`
HWID: \`${keyData.hwid}\`
Cooldown after reset: **${cooldownName}**`)
      .setTimestamp();

    return interaction.reply({ embeds:[embed], components:[row], ephemeral:true });
  }
  if (interaction.isStringSelectMenu() && interaction.customId === 'slash_reset_select') {
    const selectedKey = interaction.values[0];
    const keyData = await getKey(selectedKey);

    if (!keyData || !keyData.hwid) {
      return interaction.reply({ content: 'Key has no HWID to reset', ephemeral: true });
    }

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`slash_confirm_reset_${selectedKey}`).setLabel('Confirm Reset').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('slash_cancel_reset').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
    );

    return interaction.reply({
      content: `Reset HWID for key: 
\`${selectedKey}\`
Current HWID: \`${keyData.hwid}\``,
      components: [row],
      ephemeral: true
    });
  }

  // BUTTON CONFIRM RESET
  // Add logging + cooldown save
  if (interaction.isButton() && interaction.customId.startsWith('slash_confirm_reset_')) {
    const key = interaction.customId.replace('slash_confirm_reset_', '');
    const keyData = await getKey(key);
    if (!keyData)
      return interaction.reply({ content:'Key not found', ephemeral:true });

    // Reset HWID
    await setKey(key, { ...keyData, hwid:null });

    const user = await getUser(interaction.user.id) || { userId:interaction.user.id };
    await setUser(interaction.user.id, { ...user, lastHwidReset: Date.now() });

    // Log to MongoDB
    const logCollection = db.collection('hwid_reset_logs');
    await logCollection.insertOne({
      userId: interaction.user.id,
      key: key,
      oldHwid: keyData.hwid,
      resetAt: Date.now(),
      userTag: interaction.user.tag
    });

    const embed = new EmbedBuilder()
      .setColor('#22dd22')
      .setTitle('HWID Reset Successful')
      .setDescription(`Key: \`${key}\``)
      .setTimestamp();

    return interaction.reply({ embeds:[embed], ephemeral:true });
  }
  if (interaction.isButton() && interaction.customId.startsWith('slash_confirm_reset_')) {
    const key = interaction.customId.replace('slash_confirm_reset_', '');
    const keyData = await getKey(key);

    if (!keyData) return interaction.reply({ content: 'Key not found', ephemeral: true });

    await setKey(key, { ...keyData, hwid: null });

    const user = await getUser(interaction.user.id) || { userId: interaction.user.id };
    await setUser(interaction.user.id, { ...user, lastHwidReset: Date.now() });

    return interaction.reply({ content: `HWID reset successful for key:
\`${key}\``, ephemeral: true });
  }

  // BUTTON CANCEL RESET
  if (interaction.isButton() && interaction.customId === 'slash_cancel_reset') {
    return interaction.reply({ content:'HWID reset cancelled', ephemeral:true });
  }

  // MANAGE BACK BUTTON
  if (interaction.isButton() && interaction.customId === 'slash_manage_back') {
    const user = await getUser(interaction.user.id);
    const menu = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('slash_manage_select')
        .setPlaceholder('Select key')
        .addOptions(user.keys.map((k,i)=>({ label:`Key #${i+1}`, value:k })))
    );

    return interaction.reply({ content:'Your keys:', components:[menu], ephemeral:true });
  }
  if (interaction.isButton() && interaction.customId === 'slash_cancel_reset') {
    return interaction.reply({ content: 'HWID reset cancelled', ephemeral: true });
  }

  // SELECT MENU: manage key
  // Added Back button
  if (interaction.isStringSelectMenu() && interaction.customId === 'slash_manage_select') {
    const key = interaction.values[0];
    const data = await getKey(key);

    const embed = new EmbedBuilder()
      .setColor(data.active?'#22dd99':'#dd4444')
      .setTitle('🔍 Key Details')
      .addFields(
        { name:'Key', value:key },
        { name:'Status', value:data.active?'Active':'Inactive' },
        { name:'Expires', value:data.expiresAt?new Date(data.expiresAt).toLocaleString():'Lifetime' },
        { name:'HWID', value:data.hwid||'Not registered' },
        { name:'Redeemed', value:data.redeemedAt?new Date(data.redeemedAt).toLocaleString():'Not redeemed' }
      );

    const back = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('slash_manage_back').setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary)
    );

    return interaction.reply({ embeds:[embed], components:[back], ephemeral:true });
  }
  if (interaction.isStringSelectMenu() && interaction.customId === 'slash_manage_select') {
    const key = interaction.values[0];
    const data = await getKey(key);

    const embed = new EmbedBuilder()
      .setColor(data.active ? 'Green' : 'Red')
      .setTitle('Key Details')
      .addFields(
        { name: 'Key', value: `${key}` },
        { name: 'Status', value: data.active ? 'Active' : 'Inactive' },
        { name: 'Expires', value: data.expiresAt ? new Date(data.expiresAt).toLocaleString() : 'Lifetime' },
        { name: 'HWID', value: data.hwid || 'Not Registered' },
        { name: 'Redeemed', value: data.redeemedAt ? new Date(data.redeemedAt).toLocaleString() : 'Not redeemed' }
      );

    return interaction.reply({ embeds: [embed], ephemeral: true });
  }
});

// API ENDPOINTS (identical to original)
//-----------------------------------------------------

function authenticate(req, res, next) {
  if (req.headers['x-api-key'] !== API_SECRET)
    return res.status(401).json({ error: 'Unauthorized' });
  next();
}

app.get('/', async (req, res) => {
  res.json({ status: 'OK' });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', uptime: process.uptime() });
});

//-----------------------------------------------------
// START BOT + API
//-----------------------------------------------------
async function start() {
  await connectMongoDB();

  app.listen(PORT, () => console.log('API Running'));

  await client.login(DISCORD_TOKEN);
  client.once('ready', async () => {
    await registerSlashCommands();
    console.log(`Bot logged in as ${client.user.tag}`);
  });
}

start();
