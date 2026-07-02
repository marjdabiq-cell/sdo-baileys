/**
 * Baileys WhatsApp Bridge — Railway Edition
 * يربط واتساب الشخصي بالـ Backend عبر HTTP
 */
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys");
const { Boom } = require("@hapi/boom");
const axios = require("axios");
const pino = require("pino");
const qrcode = require("qrcode-terminal");
const http = require("http");
require("dotenv").config();

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";
const MY_NUMBER   = process.env.MY_WHATSAPP_NUMBER || "";
const AUTH_DIR    = process.env.AUTH_DIR || "/data/auth_info";
const PORT        = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", bridge: "sdo-baileys" }));
  } else {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("SDO Baileys Bridge is running.");
  }
});
server.listen(PORT, () => console.log(`[HTTP] مستمع على المنفذ ${PORT}`));

const logger = pino({ level: "silent" });

async function startBridge() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  const sock = makeWASocket({
    auth: state,
    logger,
    printQRInTerminal: false,
    browser: ["SDO Bridge", "Chrome", "1.0.0"],
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      console.log("\n=== امسح QR Code بواتساب (الإعدادات <- الأجهزة المرتبطة) ===\n");
      qrcode.generate(qr, { small: true });
    }
    if (connection === "close") {
      const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const shouldReconnect = reason !== DisconnectReason.loggedOut;
      console.log(`[Bridge] انقطع الاتصال (${reason}). إعادة الاتصال: ${shouldReconnect}`);
      if (shouldReconnect) setTimeout(startBridge, 5000);
      else console.log("[Bridge] تم تسجيل الخروج. احذف مجلد auth_info وأعد التشغيل.");
    }
    if (connection === "open") console.log("[Bridge] متصل بواتساب!");
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const msg of messages) {
      if (msg.key.fromMe) continue;
      const sender = msg.key.remoteJid?.replace("@s.whatsapp.net", "");
      if (MY_NUMBER && sender !== MY_NUMBER) continue;
      const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || "";
      if (!text.trim()) continue;
      console.log(`[Bridge] <- رسالة من ${sender}: ${text.substring(0,60)}`);
      try {
        const res = await axios.post(`${BACKEND_URL}/webhook`, {
          entry: [{ changes: [{ value: { messages: [{ from: sender, type: "text", text: { body: text }, id: msg.key.id }] } }] }]
        }, { timeout: 30000 });
        const reply = res.data?.reply;
        if (reply) {
          await sock.sendMessage(`${sender}@s.whatsapp.net`, { text: reply });
          console.log(`[Bridge] -> رد: ${reply.substring(0,60)}`);
        }
      } catch (err) { console.error(`[Bridge] خطأ: ${err.message}`); }
    }
  });
}

startBridge().catch(console.error);
