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
  console.log(`🌐 Server running on port ${PORT}`);
});

async function startBot() {
  const { state, saveCreds } =
    await useMultiFileAuthState("auth_info");

  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: "silent" }),
    printQRInTerminal: false
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === "open") {
      console.log("✅ WHATSAPP CONNECTED!");
    }

    if (connection === "close") {
      const statusCode =
        lastDisconnect?.error instanceof Boom
          ? lastDisconnect.error.output.statusCode
          : null;

      const shouldReconnect =
        statusCode !== DisconnectReason.loggedOut;

      console.log("❌ WhatsApp disconnected.");

      if (shouldReconnect) {
        console.log("🔄 Reconnecting...");
        setTimeout(startBot, 5000);
      }
    }
  });

  // Pairing code
  if (!state.creds.registered) {
    const number = process.env.WHATSAPP_NUMBER;

    if (!number) {
      console.log(
        "⚠️ Add WHATSAPP_NUMBER in Render Environment Variables."
      );
      return;
    }

    try {
      const code = await sock.requestPairingCode(number);

      console.log("");
      console.log("================================");
      console.log("📱 WHATSAPP PAIRING CODE:");
      console.log(code);
      console.log("================================");
      console.log("");
    } catch (error) {
      console.log("❌ Pairing error:", error.message);
    }
  }

  // Receive messages
  sock.ev.on("messages.upsert", async ({ messages }) => {
    try {
      const message = messages[0];

      if (!message || !message.message) return;

      if (message.key.fromMe) return;

      const jid = message.key.remoteJid;

      // Only groups
      if (!jid || !jid.endsWith("@g.us")) return;

      const text =
        message.message.conversation ||
        message.message.extendedTextMessage?.text ||
        "";

      console.log("📩 Group message:", text);

      // Test command
      if (text.toLowerCase() === "!test") {
        await sock.sendMessage(jid, {
          text:
            "🇩🇪🤖 German B1 Bot يعمل!\n\n" +
            "البوت متصل بالمجموعة بنجاح."
        });
      }

    } catch (error) {
      console.log("Message error:", error);
    }
  });
}

startBot();
