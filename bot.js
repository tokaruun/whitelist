// bot.js - D4Vd HuB Discord Bot with MongoDB
const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const express = require('express');
const crypto = require('crypto');
const mongoose = require('mongoose');

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

// Environment Variables
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const API_SECRET = process.env.API_SECRET || 'change-this-secret';
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;

// ==================== MONGODB SCHEMAS ====================

const keySchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true, index: true },
    userId: { type: String, default: null },
    hwid: { type: String, default: null },
    active: { type: Boolean, default: true },
    expiresAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now },
    redeemedAt: { type: Date, default: null }
});

const userSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true, index: true },
    keys: [{ type: String }],
    hwid: { type: String, default: null }
});

const Key = mongoose.model('Key', keySchema);
const User = mongoose.model('User', userSchema);

// ==================== CONNECT MONGODB ====================

if (!MONGODB_URI) {
    console.error('❌ MONGODB_URI not set!');
    console.error('Please add MONGODB_URI to environment variables');
    process.exit(1);
}

mongoose.connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => {
    console.log('✅ MongoDB connected successfully!');
}).catch(err => {
    console.error('❌ MongoDB connection error:', err.message);
    process.exit(1);
});

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
    
    if (message.content === '!stats') {
        try {
            const totalKeys = await Key.countDocuments();
            const totalUsers = await User.countDocuments();
            const activeKeys = await Key.countDocuments({ active: true });
            
            const embed = new EmbedBuilder()
                .setColor('#00FF00')
                .setTitle('📊 Bot Statistics')
                .addFields(
                    { name: '🔑 Total Keys', value: totalKeys.toString(), inline: true },
                    { name: '✅ Active Keys', value: activeKeys.toString(), inline: true },
                    { name: '👥 Total Users', value: totalUsers.toString(), inline: true },
                    { name: '⏱️ Uptime', value: `${Math.floor(client.uptime / 1000 / 60)} minutes`, inline: true }
                )
                .setTimestamp();
            
            await message.reply({ embeds: [embed] });
        } catch (error) {
            console.error('Stats error:', error);
            await message.reply('❌ Error getting stats!');
        }
    }
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;

    const userId = interaction.user.id;

    try {
        switch(interaction.customId) {
            case 'resethwid':
                const userData = await User.findOne({ userId });
                if (userData && userData.hwid) {
                    userData.hwid = null;
                    await userData.save();
                    await interaction.reply({
                        content: '✅ HWID Reset successful!',
                        ephemeral: true
                    });
                } else {
                    await interaction.reply({
                        content: '❌ You don\'t have HWID yet',
                        ephemeral: true
                    });
                }
                break;

            case 'redeem_key':
                await interaction.reply({
                    content: '🔑 Check DM to Redeem Key!',
                    ephemeral: true
                });
                
                try {
                    const dm = await interaction.user.createDM();
                    await dm.send('**Enter your Key:**\n_(You have 60 seconds)_');
                    
                    const filter = m => m.author.id === userId;
                    const collected = await dm.awaitMessages({
                        filter,
                        max: 1,
                        time: 60000,
                        errors: ['time']
                    });
                    
                    if (!collected.size) {
                        return await dm.send('⏱️ Time\'s up! Please try again.');
                    }
                    
                    const keyText = collected.first().content.trim();
                    const keyData = await Key.findOne({ key: keyText });
                    
                    if (!keyData) {
                        return await dm.send('❌ Key failed!');
                    }
                    
                    if (!keyData.active) {
                        return await dm.send('❌ Key got blacklist!');
                    }
                    
                    if (keyData.userId) {
                        return await dm.send('❌ Key already in use by someone else!');
                    }
                    
                    if (keyData.expiresAt && Date.now() > keyData.expiresAt.getTime()) {
                        return await dm.send('❌ Key expired');
                    }
                    
                    // Redeem key
                    keyData.userId = userId;
                    keyData.redeemedAt = new Date();
                    await keyData.save();
                    
                    let user = await User.findOne({ userId });
                    if (!user) {
                        user = new User({ userId, keys: [], hwid: null });
                    }
                    user.keys.push(keyText);
                    await user.save();

                    const expiryText = keyData.expiresAt 
                        ? `Expired: ${keyData.expiresAt.toLocaleString()}`
                        : 'Infinity';

                    // Assign Premium role
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
                                roleResultText = '\n⚠️ Role `Prenium` not found on server.';
                            }
                        }
                    } catch (err) {
                        console.error('Role assignment error:', err);
                        roleResultText = '\n⚠️ Error assigning role.';
                    }

                    await dm.send(`✅ **Redeem Key Work**\n🔑 Key: \`${keyText}\`\n⏰ ${expiryText}${roleResultText}`);
                } catch (error) {
                    console.error('DM Error:', error);
                    await interaction.followUp({
                        content: '❌ Cannot send DM! Please enable DM from server members.',
                        ephemeral: true
                    });
                }
                break;

            case 'manage_key':
                const user = await User.findOne({ userId });
                const userKeys = user?.keys || [];
                
                if (userKeys.length === 0) {
                    return await interaction.reply({
                        content: '❌ You don\'t have any keys!',
                        ephemeral: true
                    });
                }
                
                const embed = new EmbedBuilder()
                    .setColor('#0099FF')
                    .setTitle('📋 Your Keys')
                    .setTimestamp();
                
                for (let i = 0; i < userKeys.length; i++) {
                    const keyData = await Key.findOne({ key: userKeys[i] });
                    if (keyData) {
                        const status = keyData.active ? '🟢 Work' : '🔴 Inactive';
                        const expires = keyData.expiresAt 
                            ? keyData.expiresAt.toLocaleString()
                            : 'Lifetime';
                        
                        embed.addFields({
                            name: `Key #${i + 1}`,
                            value: `\`${userKeys[i]}\`\n${status} | Expires: ${expires}`,
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
                if (!interaction.member.permissions.has('Administrator')) {
                    return await interaction.reply({
                        content: '❌ Only admins can add keys',
                        ephemeral: true
                    });
                }

                let apiUrl = process.env.RAILWAY_STATIC_URL || `http://localhost:${PORT}`;
                apiUrl = apiUrl.replace(/\/+$/, '');

                await interaction.reply({
                    content: `➕ **Create keys via API:**\n\n**Bash / Linux / macOS**\n\`\`\`bash\ncurl -X POST ${apiUrl}/api/keys/create \\\n  -H "x-api-key: ${API_SECRET}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"duration": 30, "quantity": 1}'\n\`\`\`\n\n**Windows CMD**\n\`\`\`\ncurl -X POST "${apiUrl}/api/keys/create" -H "x-api-key: ${API_SECRET}" -H "Content-Type: application/json" -d "{\\"duration\\":30,\\"quantity\\":1}"\n\`\`\`\n\n**PowerShell**\n\`\`\`powershell\nInvoke-RestMethod -Method Post -Uri "${apiUrl}/api/keys/create" -Headers @{"x-api-key"="${API_SECRET}"; "Content-Type"="application/json"} -Body '{"duration":30,"quantity":1}'\n\`\`\``,
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
                    content: '🚫 Use API endpoint `/api/keys/blacklist` to blacklist keys.',
                    ephemeral: true
                });
                break;
        }
    } catch (error) {
        console.error('Interaction error:', error);
        await interaction.reply({
            content: '❌ An error occurred!',
            ephemeral: true
        }).catch(() => {});
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

app.get('/', (req, res) => {
    res.json({ 
        status: 'OK',
        bot: client.user ? client.user.tag : 'Not ready',
        uptime: Math.floor(process.uptime())
    });
});

app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
    });
});

// Create keys
app.post('/api/keys/create', authenticate, async (req, res) => {
    try {
        const { duration, quantity = 1 } = req.body;
        
        if (quantity > 100) {
            return res.status(400).json({ error: 'Maximum 100 keys per request' });
        }
        
        const createdKeys = [];
        
        for (let i = 0; i < quantity; i++) {
            const keyText = generateKey();
            const expiresAt = duration ? new Date(Date.now() + (duration * 24 * 60 * 60 * 1000)) : null;
            
            const key = new Key({
                key: keyText,
                expiresAt
            });
            
            await key.save();
            
            createdKeys.push({
                key: keyText,
                expires: expiresAt ? expiresAt.toISOString() : 'Never'
            });
        }
        
        console.log(`✅ Created ${quantity} key(s)`);
        
        res.json({
            success: true,
            count: quantity,
            keys: createdKeys
        });
    } catch (error) {
        console.error('Create key error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Check key
app.get('/api/keys/check/:key', authenticate, async (req, res) => {
    try {
        const keyData = await Key.findOne({ key: req.params.key });
        
        if (!keyData) {
            return res.status(404).json({ error: 'Key not found' });
        }
        
        res.json({
            key: keyData.key,
            userId: keyData.userId,
            active: keyData.active,
            expiresAt: keyData.expiresAt,
            isExpired: keyData.expiresAt && Date.now() > keyData.expiresAt.getTime()
        });
    } catch (error) {
        console.error('Check key error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Blacklist key
app.post('/api/keys/blacklist', authenticate, async (req, res) => {
    try {
        const { key } = req.body;
        
        if (!key) {
            return res.status(400).json({ error: 'Key is required' });
        }
        
        const keyData = await Key.findOne({ key });
        
        if (!keyData) {
            return res.status(404).json({ error: 'Key not found' });
        }
        
        keyData.active = false;
        await keyData.save();
        
        console.log(`🚫 Blacklisted key: ${key}`);
        
        res.json({
            success: true,
            message: 'Key blacklisted successfully',
            key
        });
    } catch (error) {
        console.error('Blacklist error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// List keys
app.get('/api/keys/list', authenticate, async (req, res) => {
    try {
        const keys = await Key.find();
        
        res.json({
            success: true,
            total: keys.length,
            keys: keys.map(k => ({
                key: k.key,
                userId: k.userId,
                active: k.active,
                expiresAt: k.expiresAt,
                createdAt: k.createdAt,
                isExpired: k.expiresAt && Date.now() > k.expiresAt.getTime()
            }))
        });
    } catch (error) {
        console.error('List keys error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Verify HWID (for Roblox script)
app.post('/api/verify', async (req, res) => {
    try {
        const { key, hwid } = req.body;
        
        if (!key || !hwid) {
            return res.status(400).json({ 
                success: false, 
                message: 'Key and HWID are required' 
            });
        }
        
        const keyData = await Key.findOne({ key });
        
        if (!keyData) {
            return res.json({ success: false, message: 'Invalid key' });
        }
        
        if (!keyData.active) {
            return res.json({ success: false, message: 'Key is blacklisted' });
        }
        
        if (keyData.expiresAt && Date.now() > keyData.expiresAt.getTime()) {
            return res.json({ success: false, message: 'Key has expired' });
        }
        
        if (!keyData.userId) {
            return res.json({ success: false, message: 'Key not redeemed yet' });
        }
        
        const user = await User.findOne({ userId: keyData.userId });
        
        if (!user) {
            return res.json({ success: false, message: 'User not found' });
        }
        
        if (!user.hwid) {
            user.hwid = hwid;
            await user.save();
            console.log(`🔐 HWID registered for user ${keyData.userId}`);
            return res.json({ success: true, message: 'HWID registered successfully' });
        }
        
        if (user.hwid === hwid) {
            return res.json({ success: true, message: 'Access granted' });
        }
        
        return res.json({ success: false, message: 'HWID mismatch' });
    } catch (error) {
        console.error('Verify error:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

// ==================== START ====================

app.listen(PORT, () => {
    console.log(`🚀 API Server running on port ${PORT}`);
});

if (!DISCORD_TOKEN) {
    console.error('❌ DISCORD_TOKEN not set!');
    console.error('Please add DISCORD_TOKEN to environment variables');
    process.exit(1);
}

client.login(DISCORD_TOKEN).catch(err => {
    console.error('❌ Cannot login to Discord:', err.message);
    process.exit(1);
});
