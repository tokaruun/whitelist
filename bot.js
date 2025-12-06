// bot.js - Discord Bot với API (Railway Version)
const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const express = require('express');
const crypto = require('crypto');

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
})

// Lấy config từ environment variables
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const API_SECRET = process.env.API_SECRET || 'change-this-secret';
const PORT = process.env.PORT || 3000;

// Database đơn giản (trong production nên dùng MongoDB/PostgreSQL)
const keys = new Map();
const users = new Map();

// ==================== DISCORD BOT ====================

client.on('ready', () => {
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
    
    // Command để xem stats
    if (message.content === '!stats') {
        const embed = new EmbedBuilder()
            .setColor('#00FF00')
            .setTitle('📊 Bot Statistics')
            .addFields(
                { name: '🔑 Total Keys', value: keys.size.toString(), inline: true },
                { name: '👥 Total Users', value: users.size.toString(), inline: true },
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
            const userData = users.get(userId);
            if (userData && userData.hwid) {
                userData.hwid = null;
                users.set(userId, userData);
                await interaction.reply({
                    content: '✅ HWID đã được reset thành công!',
                    ephemeral: true
                });
            } else {
                await interaction.reply({
                    content: '❌ Bạn chưa có HWID nào!',
                    ephemeral: true
                });
            }
            break;

        case 'redeem_key':
            await interaction.reply({
                content: '🔑 Check DM để nhập key!',
                ephemeral: true
            });
            
            try {
                const dm = await interaction.user.createDM();
                await dm.send('**Nhập key của bạn:**\n_(Có 60 giây để nhập)_');
                
                const filter = m => m.author.id === userId;
                const collected = await dm.awaitMessages({
                filter,
                max: 1,
                time: 60000,
                errors: ['time']
           });
                
                if (!collected.size) {
                    return await dm.send('⏱️ Hết thời gian! Vui lòng thử lại.');
                }
                
                const key = collected.first().content.trim();
                const keyData = keys.get(key);
                
                if (!keyData) {
                    return await dm.send('❌ Key không tồn tại!');
                }
                
                if (!keyData.active) {
                    return await dm.send('❌ Key đã bị blacklist!');
                }
                
                if (keyData.userId) {
                    return await dm.send('❌ Key đã được sử dụng bởi người khác!');
                }
                
                if (keyData.expiresAt && Date.now() > keyData.expiresAt) {
                    return await dm.send('❌ Key đã hết hạn!');
                }
                
                // Redeem thành công
                keyData.userId = userId;
                keyData.redeemedAt = Date.now();
                keys.set(key, keyData);
                
                const user = users.get(userId) || { keys: [], hwid: null };
                user.keys.push(key);
                users.set(userId, user);
                
                const expiryText = keyData.expiresAt 
                    ? `Hết hạn: ${new Date(keyData.expiresAt).toLocaleString('vi-VN')}`
                    : 'Vĩnh viễn';
                
                await dm.send(`✅ **Redeem key thành công!**\n🔑 Key: \`${key}\`\n⏰ ${expiryText}`);
            } catch (error) {
                console.error('DM Error:', error);
                await interaction.followUp({
                    content: '❌ Không thể gửi DM! Vui lòng bật DM từ server members.',
                    ephemeral: true
                });
            }
            break;

        case 'manage_key':
            const userKeys = users.get(userId)?.keys || [];
            if (userKeys.length === 0) {
                return await interaction.reply({
                    content: '❌ Bạn chưa có key nào!',
                    ephemeral: true
                });
            }
            
            const embed = new EmbedBuilder()
                .setColor('#0099FF')
                .setTitle('📋 Keys của bạn')
                .setTimestamp();
            
            userKeys.forEach((key, index) => {
                const keyData = keys.get(key);
                const status = keyData.active ? '# 🟢 Work' : '🔴 Inactive';
                const expires = keyData.expiresAt 
                    ? new Date(keyData.expiresAt).toLocaleString('vi-VN')
                    : 'Vĩnh viễn';
                
                embed.addFields({
                    name: `Key #${index + 1}`,
                    value: `\`${key}\`\n${status} | Hết hạn: ${expires}`,
                    inline: false
                });
            });
            
            await interaction.reply({
                embeds: [embed],
                ephemeral: true
            });
            break;

        case 'add_key':
            if (!interaction.member.permissions.has('Administrator')) {
                return await interaction.reply({
                    content: 'Only admins can add keys',
                    ephemeral: true
                });
            }

            let apiUrl = ("http://"+process.env.RAILWAY_STATIC_URL) || `http://localhost:${PORT}`;
            // Remove any trailing slashes to avoid double-slash issues when concatenating
            apiUrl = apiUrl.replace(/\/+$/, '');

            await interaction.reply({
                content: `➕ **Tạo key qua API:**\n\n**Bash / macOS / Linux**\n\`\`\`bash\ncurl -X POST ${apiUrl}/api/keys/create \\\n+  -H "x-api-key: ${API_SECRET}" \\\n+  -H "Content-Type: application/json" \\\n+  -d '{"duration": 30, "quantity": 1}'\n\`\`\`\n\n**Windows (cmd.exe)**\n\`\`\`\ncurl -X POST "${apiUrl}/api/keys/create" -H "x-api-key: ${API_SECRET}" -H "Content-Type: application/json" -d \"{\\\"duration\\\":30,\\\"quantity\\\":1}\"\n\`\`\`\n\n**PowerShell (Invoke-RestMethod)**\n\`\`\`powershell\nInvoke-RestMethod -Method Post -Uri "${apiUrl}/api/keys/create" -Headers @{"x-api-key"="${API_SECRET}"; "Content-Type"="application/json"} -Body '{"duration":30,"quantity":1}'\n\`\`\``,
                ephemeral: true
            });
            break;

        case 'blacklist_key':
            if (!interaction.member.permissions.has('Administrator')) {
                return await interaction.reply({
                    content: '❌ Chỉ Admin mới có thể blacklist!',
                    ephemeral: true
                });
            }
            await interaction.reply({
                content: '🚫 Sử dụng API endpoint `/api/keys/blacklist` để vô hiệu hóa key.',
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

function generateKey() {
    return crypto.randomBytes(16).toString('hex').toUpperCase();
}

// Health check
app.get('/', (req, res) => {
    res.json({ 
        status: 'OK',
        bot: client.user ? client.user.tag : 'Not ready',
        uptime: Math.floor(process.uptime()),
        keys: keys.size,
        users: users.size
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
app.post('/api/keys/create', authenticate, (req, res) => {
    const { duration, quantity = 1 } = req.body;
    
    if (quantity > 100) {
        return res.status(400).json({ error: 'Maximum 100 keys per request' });
    }
    
    const createdKeys = [];
    
    for (let i = 0; i < quantity; i++) {
        const key = generateKey();
        const expiresAt = duration ? Date.now() + (duration * 24 * 60 * 60 * 1000) : null;
        
        keys.set(key, {
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
app.get('/api/keys/check/:key', authenticate, (req, res) => {
    const { key } = req.params;
    const keyData = keys.get(key);
    
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
app.post('/api/keys/blacklist', authenticate, (req, res) => {
    const { key } = req.body;
    
    if (!key) {
        return res.status(400).json({ error: 'Key is required' });
    }
    
    const keyData = keys.get(key);
    
    if (!keyData) {
        return res.status(404).json({ error: 'Key not found' });
    }
    
    keyData.active = false;
    keys.set(key, keyData);
    
    console.log(`🚫 Blacklisted key: ${key}`);
    
    res.json({
        success: true,
        message: 'Key blacklisted successfully',
        key
    });
});

// List tất cả keys
app.get('/api/keys/list', authenticate, (req, res) => {
    const allKeys = [];
    
    keys.forEach((value, key) => {
        allKeys.push({
            key,
            ...value,
            isExpired: value.expiresAt && Date.now() > value.expiresAt
        });
    });
    
    res.json({
        success: true,
        total: allKeys.length,
        keys: allKeys
    });
});

// Xác thực HWID (cho game/app)
app.post('/api/verify', (req, res) => {
    const { key, hwid } = req.body;
    
    if (!key || !hwid) {
        return res.status(400).json({ 
            success: false, 
            message: 'Key and HWID are required' 
        });
    }
    
    const keyData = keys.get(key);
    
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
    
    const user = users.get(keyData.userId);
    
    if (!user.hwid) {
        user.hwid = hwid;
        users.set(keyData.userId, user);
        console.log(`🔐 HWID registered for user ${keyData.userId}`);
        return res.json({ success: true, message: 'HWID registered successfully' });
    }
    
    if (user.hwid === hwid) {
        return res.json({ success: true, message: 'Access granted' });
    }
    
    return res.json({ success: false, message: 'HWID mismatch' });
});

// ==================== START ====================

app.listen(PORT, () => {
    console.log(`🚀 API Server running on port ${PORT}`);
});

// Kiểm tra có token không
if (!DISCORD_TOKEN) {
    console.error('❌ DISCORD_TOKEN không được thiết lập!');
    console.error('Vui lòng thêm DISCORD_TOKEN vào environment variables');
    process.exit(1);
}

client.login(DISCORD_TOKEN).catch(err => {
    console.error('❌ Không thể đăng nhập Discord:', err);
    process.exit(1);
});
