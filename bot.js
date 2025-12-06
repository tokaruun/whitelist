// bot.js - Discord Bot với MongoDB
const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
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
                
                new ButtonBuilder()
                    .setCustomId('add_key')
                    .setLabel('Add Key')
                    .setStyle(ButtonStyle.Secondary),
                
                new ButtonBuilder()
                    .setCustomId('blacklist_key')
                    .setLabel('Blacklist Key')
                    .setStyle(ButtonStyle.Danger)
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
                { name: '🔑 Total Keys', value: totalKeys.toString(), inline: true },
                { name: '👥 Total Users', value: totalUsers.toString(), inline: true },
                { name: '⏱️ Uptime', value: `${Math.floor(client.uptime / 1000 / 60)} minutes`, inline: true }
            )
            .setTimestamp();
        
        await message.reply({ embeds: [embed] });
    }
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;

    const userId = interaction.user.id;

    switch(interaction.customId) {
        case 'resethwid':
            const userData = await getUser(userId);
            
            if (!userData || !userData.hwid) {
                return await interaction.reply({
                    content: '❌ You don\'t have any HWID registered yet!',
                    ephemeral: true
                });
            }
            
            // Check role để xác định cooldown
            const member = await interaction.guild.members.fetch(userId);
            let cooldownTime;
            let cooldownName;
            
            if (member.roles.cache.some(role => role.name === 'Whitelist')) {
                // Role Whitelist: 4 hours
                cooldownTime = 4 * 60 * 60 * 1000;
                cooldownName = '4 hours';
            } else if (member.roles.cache.some(role => role.name === 'Prenium')) {
                // Role Prenium: 2.5 days
                cooldownTime = 2.5 * 24 * 60 * 60 * 1000;
                cooldownName = '2.5 days';
            } else {
                // No role: không được reset
                return await interaction.reply({
                    content: '❌ You need **Prenium** or **Whitelist** role to reset HWID!',
                    ephemeral: true
                });
            }
            
            // Check cooldown
            const lastReset = userData.lastHwidReset || 0;
            const timeSinceReset = Date.now() - lastReset;
            
            if (timeSinceReset < cooldownTime && lastReset !== 0) {
                const timeLeft = cooldownTime - timeSinceReset;
                const hoursLeft = Math.ceil(timeLeft / (60 * 60 * 1000));
                const daysLeft = Math.ceil(timeLeft / (24 * 60 * 60 * 1000));
                
                const timeDisplay = hoursLeft < 48 
                    ? `**${hoursLeft} hours**` 
                    : `**${daysLeft} days**`;
                
                return await interaction.reply({
                    content: `⏳ You can reset HWID again in ${timeDisplay}!`,
                    ephemeral: true
                });
            }
            
            // Confirmation button
            const confirmRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('confirm_reset_hwid')
                        .setLabel('✅ Confirm Reset')
                        .setStyle(ButtonStyle.Danger),
                    new ButtonBuilder()
                        .setCustomId('cancel_reset_hwid')
                        .setLabel('❌ Cancel')
                        .setStyle(ButtonStyle.Secondary)
                );
            
            await interaction.reply({
                content: '⚠️ **Are you sure you want to reset your HWID?**\n\n' +
                         `Current HWID: \`${userData.hwid}\`\n\n` +
                         `**Note:** You can reset HWID once every ${cooldownName}!`,
                components: [confirmRow],
                ephemeral: true
            });
            break;
        
        case 'confirm_reset_hwid':
            const userToReset = await getUser(userId);
            
            if (!userToReset || !userToReset.hwid) {
                return await interaction.update({
                    content: '❌ Error: No HWID found!',
                    components: []
                });
            }
            
            // Check role lại để xác định cooldown khi confirm
            const memberConfirm = await interaction.guild.members.fetch(userId);
            let cooldownDisplay;
            
            if (memberConfirm.roles.cache.some(role => role.name === 'Whitelist')) {
                cooldownDisplay = '4 hours';
            } else if (memberConfirm.roles.cache.some(role => role.name === 'Prenium')) {
                cooldownDisplay = '2.5 days';
            } else {
                cooldownDisplay = 'N/A';
            }
            
            const oldHwid = userToReset.hwid;
            
            // Reset HWID
            await setUser(userId, {
                ...userToReset,
                hwid: null,
                lastHwidReset: Date.now(),
                hwidResetCount: (userToReset.hwidResetCount || 0) + 1
            });
            
            // Log to MongoDB
            const logCollection = db.collection('hwid_reset_logs');
            await logCollection.insertOne({
                userId: userId,
                userTag: interaction.user.tag,
                oldHwid: oldHwid,
                resetAt: Date.now(),
                cooldown: cooldownDisplay
            });
            
            console.log(`🔄 HWID Reset: User ${userId} (${interaction.user.tag}) reset HWID from ${oldHwid}`);
            
            await interaction.update({
                content: '✅ **HWID Reset Successful!**\n\n' +
                         `Old HWID: \`${oldHwid}\`\n` +
                         'Your HWID has been cleared. You can now use your key on a new device.\n\n' +
                         `⏰ Next reset available in: **${cooldownDisplay}**`,
                components: []
            });
            break;
        
        case 'cancel_reset_hwid':
            await interaction.update({
                content: '❌ HWID reset cancelled.',
                components: []
            });
            break;

        case 'redeem_key':
            await interaction.reply({
                content: '🔑 Check DM to Redeem Key!',
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
                    return await dm.send('⏱️ Time out! Please try again.');
                }
                
                const key = collected.first().content.trim();
                const keyData = await getKey(key);
                
                if (!keyData) {
                    return await dm.send('❌ Key failed!');
                }
                
                if (!keyData.active) {
                    return await dm.send('❌ Key got blacklist!');
                }
                
                if (keyData.userId) {
                    return await dm.send('❌ Key already in use by someone else!');
                }
                
                if (keyData.expiresAt && Date.now() > keyData.expiresAt) {
                    return await dm.send('❌ Key expired');
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
                    : '♾️ Infinity';

                // Gán role 'Prenium'
                let roleResultText = '';
                try {
                    if (interaction.guild) {
                        const guild = interaction.guild;
                        const role = guild.roles.cache.find(r => r.name === 'Prenium');
                        if (role) {
                            const member = await guild.members.fetch(userId);
                            if (member) {
                                await member.roles.add(role);
                                roleResultText = '\n✅ You got role **Prenium** in Server!';
                            }
                        } else {
                            roleResultText = '\n⚠️ Role Prenium not found in server!';
                        }
                    }
                } catch (err) {
                    console.error('Role assignment error:', err);
                    roleResultText = '\n⚠️ Error assigning role. Check bot permissions.';
                }

                await dm.send(`✅ **Redeem Key Work**\nKey: \`${key}\`\n${expiryText}${roleResultText}`);
            } catch (error) {
                console.error('DM Error:', error);
                await interaction.followUp({
                    content: '❌ Cannot send DM! Please enable DM from server members.',
                    ephemeral: true
                });
            }
            break;

        case 'manage_key':
            const user = await getUser(userId);
            const userKeys = user?.keys || [];
            
            if (userKeys.length === 0) {
                return await interaction.reply({
                    content: '❌ You don\'t have Keys',
                    ephemeral: true
                });
            }
            
            const embed = new EmbedBuilder()
                .setColor('#0099FF')
                .setTitle('📋 Your Keys')
                .setTimestamp();
            
            for (let i = 0; i < userKeys.length; i++) {
                const key = userKeys[i];
                const keyData = await getKey(key);
                if (keyData) {
                    const status = keyData.active ? '🟢 Active' : '🔴 Inactive';
                    const expires = keyData.expiresAt 
                        ? new Date(keyData.expiresAt).toLocaleString('vi-VN')
                        : 'Forever';
                    
                    embed.addFields({
                        name: `Key #${i + 1}`,
                        value: `\`${key}\`\n${status} | Expires: ${expires}`,
                        inline: false
                    });
                }
            }
            
            await interaction.reply({
                embeds: [embed],
                ephemeral: true
            });
            break;

        case 'add_key':
            const targetRoleName = 'Whitelist';
            const member = interaction.member;
            if (!member) {
                return await interaction.reply({
                    content: '❌ Cannot identify member (must use in server).',
                    ephemeral: true
                });
            }
            const hasOwnerRole = member.roles.cache.some(role => role.name === targetRoleName);
            if (!hasOwnerRole) {
                return await interaction.reply({
                    content: `❌ You don't have **${targetRoleName}** to use this command!`,
                    ephemeral: true
                });
            }

            let apiUrl = (process.env.RAILWAY_STATIC_URL) || `http://localhost:${PORT}`;
            apiUrl = apiUrl.replace(/\/+$/, '');

            await interaction.reply({
                content: `➕ **Create key via API:**\n\n**Bash / macOS / Linux**\n\`\`\`bash\ncurl -X POST ${apiUrl}/api/keys/create \\\n  -H "x-api-key: ${API_SECRET}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"duration": 30, "quantity": 1}'\n\`\`\`\n\n**Windows (cmd.exe)**\n\`\`\`\ncurl -X POST "${apiUrl}/api/keys/create" -H "x-api-key: ${API_SECRET}" -H "Content-Type: application/json" -d "{\\\"duration\\\":30,\\\"quantity\\\":1}"\n\`\`\`\n\n**PowerShell**\n\`\`\`powershell\nInvoke-RestMethod -Method Post -Uri "${apiUrl}/api/keys/create" -Headers @{"x-api-key"="${API_SECRET}"; "Content-Type"="application/json"} -Body '{"duration":30,"quantity":1}'\n\`\`\``,
                ephemeral: true
            });
            break;

        case 'blacklist_key':
            if (!interaction.member.permissions.has('Administrator')) {
                return await interaction.reply({
                    content: '❌ Only Admin can blacklist!',
                    ephemeral: true
                });
            }
            await interaction.reply({
                content: '🚫 Use API endpoint `/api/keys/blacklist` to disable key.',
                ephemeral: true
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
    
    console.log(`✅ Created ${quantity} key(s)`);
    
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

// Blacklist key
app.post('/api/keys/blacklist', authenticate, async (req, res) => {
    const { key } = req.body;
    
    if (!key) {
        return res.status(400).json({ error: 'Key is required' });
    }
    
    const keyData = await getKey(key);
    
    if (!keyData) {
        return res.status(404).json({ error: 'Key not found' });
    }
    
    await setKey(key, { ...keyData, active: false });
    
    console.log(`🚫 Blacklisted key: ${key}`);
    
    res.json({
        success: true,
        message: 'Key blacklisted successfully',
        key
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
    
    const user = await getUser(keyData.userId);
    
    if (!user) {
        return res.json({ success: false, message: 'User not found' });
    }
    
    if (!user.hwid) {
        await setUser(keyData.userId, { ...user, hwid });
        console.log(`🔐 HWID registered for user ${keyData.userId}`);
        return res.json({ success: true, message: 'HWID registered successfully' });
    }
    
    if (user.hwid === hwid) {
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
