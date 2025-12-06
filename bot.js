// ========================
//   IMPORT MODULES
// ========================
const express = require("express");
const mongoose = require("mongoose");
const crypto = require("crypto");
require("dotenv").config();

const { Client, GatewayIntentBits } = require("discord.js");

// ========================
//   CONFIG
// ========================
const PORT = process.env.PORT || 3000;
const SECRET_API_KEY = process.env.SECRET_API_KEY || "my-secret-api-key";

// ========================
//   MONGODB
// ========================
mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => console.log("MongoDB connected"))
.catch(err => console.log("MongoDB error:", err));

const KeySchema = new mongoose.Schema({
    key: String,
    expiresAt: Date,
    used: { type: Boolean, default: false }
});

const Key = mongoose.model("Key", KeySchema);

// ========================
//   EXPRESS API
// ========================
const app = express();
app.use(express.json());

// ===== Middleware check x-api-key =====
function checkApiKey(req, res, next) {
    if (req.headers["x-api-key"] !== SECRET_API_KEY)
        return res.status(403).json({ error: "Invalid API key" });
    next();
}

// ===== Route tạo key =====
app.post("/api/keys/create", checkApiKey, async (req, res) => {
    const { duration, quantity } = req.body;

    if (!duration || !quantity)
        return res.status(400).json({ error: "Missing duration or quantity" });

    const keys = [];

    for (let i = 0; i < quantity; i++) {
        const newKey = crypto.randomBytes(16).toString("hex").toUpperCase();
        await Key.create({
            key: newKey,
            expiresAt: new Date(Date.now() + duration * 60000)
        });
        keys.push(newKey);
    }

    return res.json({ created: keys });
});

// ===== Route verify key =====
app.post("/api/keys/verify", checkApiKey, async (req, res) => {
    const { key } = req.body;
    if (!key) return res.status(400).json({ error: "Missing key" });

    const found = await Key.findOne({ key });

    if (!found) return res.json({ valid: false, message: "Key không tồn tại" });
    if (found.used) return res.json({ valid: false, message: "Key đã được dùng" });
    if (found.expiresAt < new Date())
        return res.json({ valid: false, message: "Key đã hết hạn" });

    found.used = true;
    await found.save();

    return res.json({ valid: true, message: "OK" });
});

// Start server
app.listen(PORT, () => console.log("API running on port " + PORT));


// ========================
//   DISCORD BOT
// ========================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

let cooldown = new Map();

// ===== Lệnh !getkey =====
client.on("messageCreate", async msg => {
    if (msg.author.bot) return;
    if (!msg.content.startsWith("!getkey")) return;

    const userId = msg.author.id;

    // cooldown 60s
    if (cooldown.has(userId)) {
        let timeLeft = 60 - (Math.floor((Date.now() - cooldown.get(userId)) / 1000));
        return msg.reply(`⏳ Bạn cần đợi **${timeLeft}s** để dùng lại.`);
    }

    // tạo key 30 phút
    const newKey = crypto.randomBytes(16).toString("hex").toUpperCase();
    await Key.create({
        key: newKey,
        expiresAt: new Date(Date.now() + 30 * 60000)
    });

    msg.reply(`🔑 Key của bạn:\n\`\`\`${newKey}\`\`\`\n(Hiệu lực 30 phút)`);

    cooldown.set(userId, Date.now());
});

// Login bot
client.login(process.env.BOT_TOKEN);
