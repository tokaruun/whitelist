// bot.js - Discord Bot với API (Railway Version)
const { 
    Client, 
    GatewayIntentBits, 
    Partials,
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle 
} = require('discord.js');
const express = require('express');
const crypto = require('crypto');

const app = express();
app.use(express.json());

// ==================== FIX INTENTS DM HERE ====================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages   // 🔥 Quan trọng
    ],
    partials: [Partials.Channel]          // 🔥 Bắt buộc để nhận DM
});

// =============================================================

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const API_SECRET = process.env.API_SECRET || 'change-this-secret';
const PORT = process.env.PORT || 3000;

const keys = new Map();
const users = new Map();

// ==================== DISCORD BOT ====================

client.on('ready', () => {
    console.log(`✅ Bot online: ${client.user.tag}`);
    console.log(`🚀 API running on port ${PORT}`);
});

// =============================================================
// FIX LỚN: messageCreate phải đọc được DM
// =============================================================
client.on('messageCreate', async (message) => {

    if (message.author.bot) return;

    // Nếu là DM → return vì redeem xử lý ở interaction
    if (message.channel.type === 1) {
        return; 
    }

    if (message.content === '!whitelist') {
        const embed = new EmbedBuilder()
            .setColor('#FF1744')
            .setTitle('Whitelist Panel Emorima Rejoin')
            .setDescription('Use the buttons below to manage your keys.')
            .setThumbnail(client.user.displayAvatarURL())
            .setTimestamp();

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder().setCustomId('resethwid').setLabel('Resethwid').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('redeem_key').setLabel('Redeem Key').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('manage_key').setLabel('Manage Key').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('add_key').setLabel('Add Key').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('blacklist_key').setLabel('Blacklist Key').setStyle(ButtonStyle.Danger)
            );

        return message.channel.send({ embeds: [embed], components: [row] });
    }
});

// ==================== BUTTON HANDLER ====================

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;

    const userId = interaction.user.id;

    switch (interaction.customId) {

        // ==================== REDEEM KEY ====================
        case 'redeem_key':

            await interaction.reply({
                content: '🔑 Check DM để nhập key trong 60 giây!',
                ephemeral: true
            });

            try {
                const dm = await interaction.user.createDM();
                await dm.send("**Nhập key của bạn:**\n_(Bạn có 60 giây để nhập)_");

                const filter = m => m.author.id === userId;

                // 🔥 FIX awaitMessages
                const collected = await dm.awaitMessages({
                    filter,
                    max: 1,
                    time: 60000,
                    errors: ['time']
                }).catch(() => null);

                if (!collected) {
                    return dm.send("⏱️ **Hết thời gian!** Vui lòng thử lại.");
                }

                const key = collected.first().content.trim();
                const keyData = keys.get(key);

                if (!keyData)
                    return dm.send('❌ Key không tồn tại!');

                if (!keyData.active)
                    return dm.send('❌ Key đã bị blacklist!');

                if (keyData.userId)
                    return dm.send('❌ Key đã được sử dụng!');

                if (keyData.expiresAt && Date.now() > keyData.expiresAt)
                    return dm.send('❌ Key đã hết hạn!');

                // Thành công
                keyData.userId = userId;
                keyData.redeemedAt = Date.now();
                keys.set(key, keyData);

                const user = users.get(userId) || { keys: [], hwid: null };
                user.keys.push(key);
                users.set(userId, user);

                return dm.send(`✅ **Redeem thành công!**\n🔑 Key: \`${key}\``);

            } catch (err) {
                console.error(err);
                return interaction.followUp({
                    content: '❌ Bot không thể gửi DM! Vui lòng bật DM trong Settings.',
                    ephemeral: true
                });
            }

        break;

        // ==================== Reset HWID ====================
        case 'resethwid':
            const u = users.get(userId);
            if (!u || !u.hwid) {
                return interaction.reply({ content: '❌ Bạn chưa có HWID!', ephemeral: true });
            }
            u.hwid = null;
            users.set(userId, u);
            return interaction.reply({ content: '✅ HWID đã được reset!', ephemeral: true });

        // ==================== Manage Keys ====================
        case 'manage_key':
            const userKeys = users.get(userId)?.keys || [];
            if (userKeys.length === 0) {
                return interaction.reply({ content: '❌ Bạn chưa có key nào!', ephemeral: true });
            }
            const embed = new EmbedBuilder().setColor('#00AEEF').setTitle('📋 Keys của bạn');
            userKeys.forEach(k => {
                const d = keys.get(k);
                embed.addFields({
                    name: k,
                    value: `${d.active ? "🟢 Active" : "🔴 Inactive"}\nExpires: ${
                        d.expiresAt ? new Date(d.expiresAt).toLocaleString("vi-VN") : "Never"
                    }`
                });
            });
            return interaction.reply({ embeds: [embed], ephemeral: true });
    }
});

// ==================== API (Giữ nguyên do không lỗi) ====================

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

app.listen(PORT, () => {
    console.log(`🚀 API Server running on port ${PORT}`);
});

if (!DISCORD_TOKEN) {
    console.error("❌ Missing DISCORD_TOKEN");
    process.exit(1);
}

client.login(DISCORD_TOKEN);
