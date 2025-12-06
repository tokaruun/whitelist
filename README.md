# Discord Whitelist Bot

Bot Discord với hệ thống whitelist key và API quản lý.

## Setup
1. Thêm environment variables:
   - DISCORD_TOKEN
   - API_SECRET
   - PORT

2. Deploy lên Railway

## Commands
- `!whitelist` - Hiển thị panel quản lý key
- `!stats` - Xem thống kê bot
```

---

## ✅ Cấu trúc thư mục đúng phải như này:
```
whitelist/
├── bot.js          ← FILE QUAN TRỌNG NHẤT (code chính)
├── package.json    ← Đã có ✅
├── .gitignore      ← Nên có
└── README.md       ← Optional
```

---

## 🚀 Sau khi có đủ file:

1. Quay lại **Railway** → Click **"GitHub Repository"**
2. Chọn repo `tokaruun/whitelist`
3. Railway sẽ tự động deploy
4. Sau đó vào **Variables** tab thêm:
```
   DISCORD_TOKEN=your_bot_token
   API_SECRET=your_secret_key
   PORT=3000
