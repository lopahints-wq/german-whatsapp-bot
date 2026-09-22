const express = require("express");
const pino = require("pino");
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason
} = require("@whiskeysockets/baileys");
const { Boom } = require("@hapi/boom");

const app = express();
const PORT = process.env.PORT || 10000;

app.get("/", (req, res) => {
  res.send("🇩🇪 German B1 WhatsApp Bot is running!");
});

app.listen(PORT, () => {
  console.log("🌐 Server started on port " + PORT);
});

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("./auth_info");

  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: "silent" }),
    browser: ["German B1 Bot", "Chrome", "1.0.0"],
    markOnlineOnConnect: false,
    syncFullHistory: false
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === "connecting") {
      console.log("🔄 Connecting to WhatsApp...");
    }

    if (connection === "open") {
      console.log("================================");
      console.log("✅ WHATSAPP CONNECTED!");
      console.log("================================");
    }

    if (connection === "close") {
      const code =
        lastDisconnect?.error instanceof Boom
          ? lastDisconnect.error.output.statusCode
          : 0;

      console.log("❌ WhatsApp disconnected. Code:", code);

      if (code !== DisconnectReason.loggedOut) {
        console.log("🔄 Reconnecting in 5 seconds...");
        setTimeout(startBot, 5000);
      } else {
        console.log("⚠️ WhatsApp logged out.");
      }
    }
  });

  // إنشاء كود الربط
  if (!state.creds.registered) {
    const phoneNumber = process.env.WHATSAPP_NUMBER;

    if (!phoneNumber) {
      console.log("❌ WHATSAPP_NUMBER is missing.");
      return;
    }

    await sleep(3000);

    try {
      const pairingCode = await sock.requestPairingCode(
        phoneNumber.replace(/\D/g, "")
      );

      console.log("");
      console.log("================================");
      console.log("📱 WHATSAPP PAIRING CODE");
      console.log(pairingCode);
      console.log("================================");
      console.log("");
    } catch (error) {
      console.log("❌ Pairing error:", error.message);
    }
  }

  // استقبال رسائل المجموعات
  sock.ev.on("messages.upsert", async ({ messages }) => {
    try {
      const msg = messages[0];

      if (!msg || !msg.message) return;
      if (msg.key.fromMe) return;

      const jid = msg.key.remoteJid;

      // المجموعات فقط
      if (!jid || !jid.endsWith("@g.us")) return;

      const text =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        "";

      console.log("📩 GROUP:", text);

      if (text.trim().toLowerCase() === "!test") {
        await sock.sendMessage(jid, {
          text:
            "🇩🇪🤖 German B1 Bot\n\n" +
            "✅ البوت متصل بالمجموعة بنجاح!"
        });
      }

    } catch (error) {
      console.log("Message error:", error.message);
    }
  });
}

startBot();
