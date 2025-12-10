// bot.js - Discord Bot với MongoDB
const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const express = require('express');
const crypto = require('crypto');
const { MongoClient } = require('mongodb');

const app = express();
app.use(express.json());

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
    ],
    partials: ['CHANNEL']
});

// Config
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const API_SECRET = process.env.API_SECRET || 'change-this-secret';
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI; // Add MongoDB URI to environment variables

// MongoDB setup
let db;
let keysCollection;
let usersCollection;

// Lưu temporary data cho reset HWID
const pendingResets = new Map(); // userId -> { key, timestamp }

async function connectMongoDB() {
    try {
        const mongoClient = new MongoClient(MONGODB_URI);
        await mongoClient.connect();
        console.log('✅ Connected to MongoDB');
        
        db = mongoClient.db('whitelist'); // Tên database
        keysCollection = db.collection('keys');
        usersCollection = db.collection('users');
        
        // Create indexes
        await keysCollection.createIndex({ key: 1 }, { unique: true });
        await usersCollection.createIndex({ userId: 1 }, { unique: true });
        
    } catch (error) {
        console.error('❌ MongoDB connection failed:', error);
        process.exit(1);
    }
}

// ==================== HELPER FUNCTIONS ====================

async function getKey(key) {
    return await keysCollection.findOne({ key });
}

async function setKey(key, data) {
    await keysCollection.updateOne(
        { key },
        { $set: data },
        { upsert: true }
    );
}

async function deleteKey(key) {
    await keysCollection.deleteOne({ key });
}

async function getAllKeys() {
    return await keysCollection.find({}).toArray();
}

async function getUser(userId) {
    return await usersCollection.findOne({ userId });
}

async function setUser(userId, data) {
    await usersCollection.updateOne(
        { userId },
        { $set: data },
        { upsert: true }
    );
}

async function getAllUsers() {
    return await usersCollection.find({}).toArray();
}

function generateKey() {
    return crypto.randomBytes(16).toString('hex').toUpperCase();
}

// ==================== DISCORD BOT ====================

client.on('ready', async () => {
    console.log(`✅ Bot online: ${client.user.tag}`);
    console.log(`🚀 API running on port ${PORT}`);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    
    if (message.content === '!whitelist') {
        const embed = new EmbedBuilder()
            .setColor('#FF1744')
            .setTitle('Whitelist Panel D4Vd HuB')
            .setDescription('Use the buttons below to manage your keys.')
            .setThumbnail(client.user.displayAvatarURL())
            .setTimestamp();

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('resethwid')
                    .setLabel('Resethwid')
                    .setStyle(ButtonStyle.Danger),
                
                new ButtonBuilder()
                    .setCustomId('redeem_key')
                    .setLabel('Redeem Key')
                    .setStyle(ButtonStyle.Success),
                
                new ButtonBuilder()
                    .setCustomId('manage_key')
                    .setLabel('Manage Key')
                    .setStyle(ButtonStyle.Primary),
                
            );

        await message.channel.send({
            embeds: [embed],
            components: [row]
        });
    }
    
    if (message.content === '!stats') {
        const totalKeys = await keysCollection.countDocuments();
        const totalUsers = await usersCollection.countDocuments();
        
        const embed = new EmbedBuilder()
            .setColor('#00FF00')
            .setTitle('📊 Bot Statistics')
            .addFields(
                { name: ' Total Keys', value: totalKeys.toString(), inline: true },
                { name: ' Total Users', value: totalUsers.toString(), inline: true },
                { name: ' Uptime', value: `${Math.floor(client.uptime / 1000 / 60)} minutes`, inline: true }
            )
            .setTimestamp();
        
        await message.reply({ embeds: [embed] });
    }
    
    // ← THÊM ĐOẠN NÀY VÀO ĐÂY
    if (message.content.startsWith('!blacklist ')) {
        // Check role Whitelist
        const member = message.guild.members.cache.get(message.author.id);
        
        if (!member.roles.cache.some(role => role.name === 'Whitelist')) {
            return await message.reply({
                content: ' You need **Whitelist** role to use this command!'
            });
        }
        
        // Lấy key từ message
        const key = message.content.split(' ')[1]?.trim();
        
        if (!key) {
            return await message.reply({
                content: '❌ Please provide a key!\n**Usage:** `!blacklist <KEY>`'
            });
        }
        
        // Kiểm tra key có tồn tại không
        const keyData = await getKey(key);
        
        if (!keyData) {
            return await message.reply({
                content: `❌ Key not found: \`${key}\``
            });
        }
        
        // Kiểm tra key đã bị blacklist chưa
        if (!keyData.active) {
            return await message.reply({
                content: `⚠️ Key \`${key}\` is already blacklisted!`
            });
        }
        
        // Blacklist key
        await setKey(key, {
            ...keyData,
            active: false,
            blacklistedAt: Date.now(),
            blacklistedBy: message.author.id
        });
        
        // Log to MongoDB
        const logCollection = db.collection('blacklist_logs');
        await logCollection.insertOne({
            key: key,
            blacklistedBy: message.author.id,
            blacklistedByTag: message.author.tag,
            blacklistedAt: Date.now(),
            previousOwner: keyData.userId
        });
        
        console.log(`🚫 Key blacklisted: ${key} by ${message.author.tag}`);
        
        // Tạo embed response
        const embed = new EmbedBuilder()
            .setColor('#FF0000')
            .setTitle('🚫 Key Blacklisted')
            .addFields(
                { name: 'Key', value: `\`${key}\``, inline: false },
                { name: 'Blacklisted By', value: `${message.author.tag}`, inline: true },
                { name: 'Previous Owner', value: keyData.userId ? `<@${keyData.userId}>` : 'Not redeemed', inline: true },
                { name: 'Status', value: '🔴 Inactive', inline: true }
            )
            .setTimestamp();
        
        await message.reply({ embeds: [embed] });
    }
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton() && !interaction.isStringSelectMenu()) return;

    const userId = interaction.user.id;

    switch(interaction.customId) {
        case 'resethwid':
            const userDataReset = await getUser(userId);
            
            if (!userDataReset || !userDataReset.keys || userDataReset.keys.length === 0) {
                return await interaction.reply({
                    content: ' You don\'t have any keys!',
                    ephemeral: true
                });
            }
            
            // Lấy tất cả keys có HWID
            const keysWithHwid = [];
            for (const key of userDataReset.keys) {
                const keyData = await getKey(key);
                if (keyData && keyData.hwid) {
                    keysWithHwid.push({ key, hwid: keyData.hwid });
                }
            }
            
            if (keysWithHwid.length === 0) {
                return await interaction.reply({
                    content: ' None of your keys have HWID registered yet!',
                    ephemeral: true
                });
            }
            
            // Check role để xác định cooldown
            const memberReset = await interaction.guild.members.fetch(userId);
            let cooldownName;
            
            if (memberReset.roles.cache.some(role => role.name === 'Reset Access')) {
                cooldownName = '1 second';
            } else if (memberReset.roles.cache.some(role => role.name === 'Premium')) {
                cooldownName = '2.5 days';
            } else {
                return await interaction.reply({
                    content: ' You need **Premium**  role to reset HWID!',
                    ephemeral: true
                });
            }
            
            // Luôn hiện dropdown menu (dù 1 key hay nhiều keys)
            const resetKeyMenu = new ActionRowBuilder()
                .addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId('select_key_reset_hwid')
                        .setPlaceholder('Select a key to reset HWID')
                        .addOptions(
                            keysWithHwid.map((item, index) => ({
                                label: `Key #${index + 1}`,
                                description: `${item.key.substring(0, 16)}... | HWID: ${item.hwid.substring(0, 20)}...`,
                                value: item.key
                            }))
                        )
                );
            
            await interaction.reply({
                content: ' **Select a key to reset HWID:**\n\n' +
                         `You have **${keysWithHwid.length} key(s)** with HWID registered.\n` +
                         `Cooldown: **${cooldownName}**`,
                components: [resetKeyMenu],
                ephemeral: true
            });
            break;
        
        case 'select_key_reset_hwid':
            if (!interaction.isStringSelectMenu()) return;
            
            const selectedKey = interaction.values[0];
            const userDataSelect = await getUser(userId);
            const selectedKeyData = await getKey(selectedKey);
            
            if (!selectedKeyData || !selectedKeyData.hwid) {
                return await interaction.update({
                    content: ' Error: Key or HWID not found!',
                    components: []
                });
            }
            
            // Check role và cooldown
            const memberSelect = await interaction.guild.members.fetch(userId);
            let cooldownTimeSelect;
            let cooldownNameSelect;
            
            if (memberSelect.roles.cache.some(role => role.name === 'Reset Access')) {
                cooldownTimeSelect = 1000;
                cooldownNameSelect = 'Resset Acess ';
            } else if (memberSelect.roles.cache.some(role => role.name === 'Premium')) {
                cooldownTimeSelect = 2.5 * 24 * 60 * 60 * 1000;
                cooldownNameSelect = '2.5 days';
            } else {
                return await interaction.update({
                    content: ' You need **Premium**  role to reset HWID!',
                    components: []
                });
            }
            
            const lastResetSelect = userDataSelect.lastHwidReset || 0;
            const timeSinceResetSelect = Date.now() - lastResetSelect;
            
            if (timeSinceResetSelect < cooldownTimeSelect && lastResetSelect !== 0) {
                const timeLeft = cooldownTimeSelect - timeSinceResetSelect;
                const secondsLeft = Math.ceil(timeLeft / 1000);
                const hoursLeft = Math.ceil(timeLeft / (60 * 60 * 1000));
                const daysLeft = Math.ceil(timeLeft / (24 * 60 * 60 * 1000));
                
                let timeDisplay;
                if (cooldownTimeSelect === 1000) {
                timeDisplay = `**${secondsLeft} second(s)**`;
                } 
                else if (cooldownTimeSelect === 24 * 60 * 60 * 1000) {
                    timeDisplay = `**${hoursLeft} hour(s)**`;
                }
                else if (cooldownTimeSelect === 2.5 * 24 * 60 * 60 * 1000) {
                    timeDisplay = `**${daysLeft} day(s)**`;
                }
                return await interaction.update({
                    content: ` You can reset HWID again in ${timeDisplay}!`,
                    components: []
                });
            }
            
            const confirmRowSelect = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('confirm_reset_hwid')
                        .setLabel(' Confirm Reset')
                        .setStyle(ButtonStyle.Danger),
                    new ButtonBuilder()
                        .setCustomId('cancel_reset_hwid')
                        .setLabel(' Cancel')
                        .setStyle(ButtonStyle.Secondary)
                );
            
            // Lưu key vào pending resets
            pendingResets.set(userId, { key: selectedKey, timestamp: Date.now() });
            
            await interaction.update({
                content: ' **Are you sure you want to reset HWID for this key?**\n\n' +
                         `Key: \`${selectedKey}\`\n` +
                         `Current HWID: \`${selectedKeyData.hwid}\`\n\n` +
                         `**Note:** You can reset HWID once every ${cooldownNameSelect}!`,
                components: [confirmRowSelect]
            });
            break;
        
        case 'confirm_reset_hwid':
            // Lấy key từ pending resets
            const pendingReset = pendingResets.get(userId);
            
            if (!pendingReset) {
                return await interaction.update({
                    content: ' Error: Reset session expired. Please try again.',
                    components: []
                });
            }
            
            // Check timeout (5 minutes)
            if (Date.now() - pendingReset.timestamp > 5 * 60 * 1000) {
                pendingResets.delete(userId);
                return await interaction.update({
                    content: ' Reset session expired. Please try again.',
                    components: []
                });
            }
            
            const keyToReset = pendingReset.key;
            const userToReset = await getUser(userId);
            const keyDataToReset = await getKey(keyToReset);
            
            if (!keyDataToReset || !keyDataToReset.hwid) {
                pendingResets.delete(userId);
                return await interaction.update({
                    content: ' Error: Key or HWID not found!',
                    components: []
                });
            }
            
            // Check role lại để xác định cooldown khi confirm
            const memberConfirm = await interaction.guild.members.fetch(userId);
            let cooldownDisplay;
            
            if (memberConfirm.roles.cache.some(role => role.name === 'Reset Access')) {
                cooldownDisplay = 'Reset Acess ';
            } else if (memberConfirm.roles.cache.some(role => role.name === 'Premium')) {
                cooldownDisplay = '2.5 days';
            } else {
                cooldownDisplay = 'N/A';
            }
            
            const oldHwid = keyDataToReset.hwid;
            
            // Reset HWID cho key cụ thể
            await setKey(keyToReset, {
                ...keyDataToReset,
                hwid: null
            });
            
            // Update user reset time
            await setUser(userId, {
                ...userToReset,
                lastHwidReset: Date.now(),
                hwidResetCount: (userToReset.hwidResetCount || 0) + 1
            });
            
            // Log to MongoDB
            const logCollection = db.collection('hwid_reset_logs');
            await logCollection.insertOne({
                userId: userId,
                userTag: interaction.user.tag,
                key: keyToReset,
                oldHwid: oldHwid,
                resetAt: Date.now(),
                cooldown: cooldownDisplay
            });
            
            // Clear pending reset
            pendingResets.delete(userId);
            
            console.log(` HWID Reset: User ${userId} (${interaction.user.tag}) reset HWID for key ${keyToReset}`);
            
            await interaction.update({
                content: ' **HWID Reset Successful!**\n\n' +
                         `Key: \`${keyToReset}\`\n` +
                         `Old HWID: \`${oldHwid}\`\n` +
                         'Your HWID has been cleared. You can now use this key on a new device.\n\n' +
                         ` Next reset available in: **${cooldownDisplay}**`,
                components: []
            });
            break;
        
        case 'cancel_reset_hwid':
            pendingResets.delete(userId);
            await interaction.update({
                content: ' HWID reset cancelled.',
                components: []
            });
            break;

        case 'redeem_key':
            await interaction.reply({
                content: ' Check DM to Redeem Key!',
                ephemeral: true
            });
            
            try {
                const dm = await interaction.user.createDM();
                await dm.send('**Enter your Key:**\n_(Have 60 sec to enter, if fail button again redeem key)_');
                
                const filter = m => m.author.id === userId;
                const collected = await dm.awaitMessages({
                    filter,
                    max: 1,
                    time: 60000,
                    errors: ['time']
                });
                
                if (!collected.size) {
                    return await dm.send(' Time out! Please try again.');
                }
                
                const key = collected.first().content.trim();
                const keyData = await getKey(key);
                
                if (!keyData) {
                    return await dm.send(' Key failed!');
                }
                
                if (!keyData.active) {
                    return await dm.send(' Key got blacklist!');
                }
                
                if (keyData.userId) {
                    return await dm.send(' Key already in use by someone else!');
                }
                
                if (keyData.expiresAt && Date.now() > keyData.expiresAt) {
                    return await dm.send(' Key expired');
                }
                
                // Redeem thành công
                await setKey(key, {
                    ...keyData,
                    userId: userId,
                    redeemedAt: Date.now()
                });
                
                const user = await getUser(userId) || { userId, keys: [], hwid: null };
                user.keys = user.keys || [];
                user.keys.push(key);
                await setUser(userId, user);

                const expiryText = keyData.expiresAt 
                    ? `Expired: ${new Date(keyData.expiresAt).toLocaleString('vi-VN')}`
                    : ' Infinity';

                // Gán role 'Premium'
                let roleResultText = '';
                try {
                    if (interaction.guild) {
                        const guild = interaction.guild;
                        const role = guild.roles.cache.find(r => r.name === 'Premium');
                        if (role) {
                            const member = await guild.members.fetch(userId);
                            if (member) {
                                await member.roles.add(role);
                                roleResultText = '\n You got role **Premium** in Server!';
                            }
                        } else {
                            roleResultText = '\n Role Premium not found in server!';
                        }
                    }
                } catch (err) {
                    console.error('Role assignment error:', err);
                    roleResultText = '\n Error assigning role. Check bot permissions.';
                }

                await dm.send(` **Redeem Key Work**\nKey: \`${key}\`\n${expiryText}${roleResultText}`);
            } catch (error) {
                console.error('DM Error:', error);
                await interaction.followUp({
                    content: ' Cannot send DM! Please enable DM from server members.',
                    ephemeral: true
                });
            }
            break;

        case 'manage_key':
            const user = await getUser(userId);
            const userKeys = user?.keys || [];
            
            if (userKeys.length === 0) {
                return await interaction.reply({
                    content: ' You don\'t have Keys',
                    ephemeral: true
                });
            }
            
            // Tạo dropdown menu để chọn key
            const manageKeyMenu = new ActionRowBuilder()
                .addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId('view_key_details')
                        .setPlaceholder('Select a key to view details')
                        .addOptions(
                            userKeys.map((key, index) => ({
                                label: `Key #${index + 1}`,
                                description: `${key.substring(0, 20)}...`,
                                value: key
                            }))
                        )
                );
            
            const manageEmbed = new EmbedBuilder()
                .setColor('#0099FF')
                .setTitle(' Your Keys')
                .setDescription(`You have **${userKeys.length}** key(s).\nSelect a key below to view details.`)
                .setTimestamp();
            
            await interaction.reply({
                embeds: [manageEmbed],
                components: [manageKeyMenu],
                ephemeral: true
            });
            break;
        
        case 'view_key_details':
            if (!interaction.isStringSelectMenu()) return;
            
            const selectedKeyDetail = interaction.values[0];
            const keyDataDetail = await getKey(selectedKeyDetail);
            
            if (!keyDataDetail) {
                return await interaction.update({
                    content: ' Key not found!',
                    components: [],
                    embeds: []
                });
            }
            
            const status = keyDataDetail.active ? '🟢 Active' : '🔴 Inactive';
            const expires = keyDataDetail.expiresAt 
                ? new Date(keyDataDetail.expiresAt).toLocaleString('vi-VN')
                : 'Lifetime';
            const hwid = keyDataDetail.hwid || '❌ Not registered yet';
            const redeemed = keyDataDetail.redeemedAt
                ? new Date(keyDataDetail.redeemedAt).toLocaleString('vi-VN')
                : ' Not redeemed';
            
            const detailEmbed = new EmbedBuilder()
                .setColor(keyDataDetail.active ? '#00FF00' : '#FF0000')
                .setTitle(' Key Details')
                .addFields(
                    { name: 'Key', value: `\`${selectedKeyDetail}\``, inline: false },
                    { name: 'Status', value: status, inline: true },
                    { name: 'Expires', value: expires, inline: true },
                    { name: 'HWID', value: `\`${hwid}\``, inline: false },
                    { name: 'Redeemed At', value: redeemed, inline: false }
                )
                .setTimestamp();
            
            const backButton = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('back_to_manage_key')
                        .setLabel(' Back')
                        .setStyle(ButtonStyle.Secondary)
                );
            
            await interaction.update({
                embeds: [detailEmbed],
                components: [backButton]
            });
            break;
        
        case 'back_to_manage_key':
            const userBack = await getUser(userId);
            const userKeysBack = userBack?.keys || [];
            
            if (userKeysBack.length === 0) {
                return await interaction.update({
                    content: ' You don\'t have Keys',
                    components: [],
                    embeds: []
                });
            }
            
            const selectMenuBack = new ActionRowBuilder()
                .addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId('view_key_details')
                        .setPlaceholder('Select a key to view details')
                        .addOptions(
                            userKeysBack.map((key, index) => ({
                                label: `Key #${index + 1}`,
                                description: `${key.substring(0, 20)}...`,
                                value: key
                            }))
                        )
                );
            
            const embedBack = new EmbedBuilder()
                .setColor('#0099FF')
                .setTitle(' Your Keys')
                .setDescription(`You have **${userKeysBack.length}** key(s).\nSelect a key below to view details.`)
                .setTimestamp();
            
            await interaction.update({
                embeds: [embedBack],
                components: [selectMenuBack]
            });
            break;
    }   
});

// ==================== API ENDPOINTS ====================

function authenticate(req, res, next) {
    const apiKey = req.headers['x-api-key'];
    if (apiKey !== API_SECRET) {
        return res.status(401).json({ error: 'Unauthorized - Invalid API Key' });
    }
    next();
}

// Health check
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
    res.json({ 
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage()
    });
});

// Tạo key
app.post('/api/keys/create', authenticate, async (req, res) => {
    const { duration, quantity = 1 } = req.body;
    
    if (quantity > 100) {
        return res.status(400).json({ error: 'Maximum 100 keys per request' });
    }
    
    const createdKeys = [];
    
    for (let i = 0; i < quantity; i++) {
        const key = generateKey();
        const expiresAt = duration ? Date.now() + (duration * 24 * 60 * 60 * 1000) : null;
        
        await setKey(key, {
            key,
            userId: null,
            hwid: null,
            active: true,
            expiresAt,
            createdAt: Date.now(),
            redeemedAt: null
        });
        
        createdKeys.push({
            key,
            expires: expiresAt ? new Date(expiresAt).toISOString() : 'Never'
        });
    }
    
    console.log(` Created ${quantity} key(s)`);
    
    res.json({
        success: true,
        count: quantity,
        keys: createdKeys
    });
});

// Kiểm tra key
app.get('/api/keys/check/:key', authenticate, async (req, res) => {
    const { key } = req.params;
    const keyData = await getKey(key);
    
    if (!keyData) {
        return res.status(404).json({ error: 'Key not found' });
    }
    
    res.json({
        key,
        ...keyData,
        isExpired: keyData.expiresAt && Date.now() > keyData.expiresAt
    });
});



// List tất cả keys
app.get('/api/keys/list', authenticate, async (req, res) => {
    const allKeys = await getAllKeys();
    
    const keysWithStatus = allKeys.map(keyData => ({
        ...keyData,
        isExpired: keyData.expiresAt && Date.now() > keyData.expiresAt
    }));
    
    res.json({
        success: true,
        total: keysWithStatus.length,
        keys: keysWithStatus
    });
});

// Xác thực HWID (cho game/app) - QUAN TRỌNG CHO LUA LOADER
app.post('/api/verify', async (req, res) => {
    const { key, hwid } = req.body;
    
    if (!key || !hwid) {
        return res.status(400).json({ 
            success: false, 
            message: 'Key and HWID are required' 
        });
    }
    
    const keyData = await getKey(key);
    
    if (!keyData) {
        return res.json({ success: false, message: 'Invalid key' });
    }
    
    if (!keyData.active) {
        return res.json({ success: false, message: 'Key is blacklisted' });
    }
    
    if (keyData.expiresAt && Date.now() > keyData.expiresAt) {
        return res.json({ success: false, message: 'Key has expired' });
    }
    
    if (!keyData.userId) {
        return res.json({ success: false, message: 'Key not redeemed yet' });
    }
    
    // Check HWID từ key (không phải từ user nữa)
    if (!keyData.hwid) {
        // Lần đầu tiên sử dụng key, register HWID vào key
        await setKey(key, { ...keyData, hwid });
        console.log(`🔐 HWID registered for key ${key}: ${hwid}`);
        return res.json({ success: true, message: 'HWID registered successfully' });
    }
    
    if (keyData.hwid === hwid) {
        return res.json({ success: true, message: 'Access granted' });
    }
    
    return res.json({ success: false, message: 'HWID mismatch' });
});

// ==================== START ====================

async function start() {
    // Connect MongoDB first
    await connectMongoDB();
    
    // Start Express server
    app.listen(PORT, () => {
        console.log(`🚀 API Server running on port ${PORT}`);
    });
    
    // Login Discord bot
    if (!DISCORD_TOKEN) {
        console.error('❌ DISCORD_TOKEN not set!');
        process.exit(1);
    }
    
    await client.login(DISCORD_TOKEN).catch(err => {
        console.error('❌ Cannot login Discord:', err);
        process.exit(1);
    });
}

start();
