const express = require("express");
const pino = require("pino");

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestWaWebVersion
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

let reconnecting = false;

async function startBot() {
  try {
    const { state, saveCreds } =
      await useMultiFileAuthState("./auth_info");

    // جلب أحدث إصدار من WhatsApp Web
    let version;

    try {
      const latest = await fetchLatestWaWebVersion();

      version = latest.version;

      console.log(
        "📱 WhatsApp Web version:",
        version.join("."),
        "Latest:",
        latest.isLatest
      );
    } catch (error) {
      console.log(
        "⚠️ Could not fetch latest WhatsApp Web version."
      );
      console.log("⚠️ Using Baileys default version.");
    }

    const socketOptions = {
      auth: state,
      logger: pino({ level: "silent" }),
      browser: ["German B1 Bot", "Chrome", "1.0.0"],
      markOnlineOnConnect: false,
      syncFullHistory: false
    };

    if (version) {
      socketOptions.version = version;
    }

    const sock = makeWASocket(socketOptions);

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect } = update;

      if (connection === "connecting") {
        console.log("🔄 Connecting to WhatsApp...");
      }

      if (connection === "open") {
        reconnecting = false;

        console.log("================================");
        console.log("✅ WHATSAPP CONNECTED!");
        console.log("================================");
      }

      if (connection === "close") {
        const code =
          lastDisconnect?.error instanceof Boom
            ? lastDisconnect.error.output.statusCode
            : 0;

        console.log(
          "❌ WhatsApp disconnected. Code:",
          code
        );

        if (code === DisconnectReason.loggedOut) {
          console.log("⚠️ WhatsApp logged out.");
          console.log("⚠️ Delete auth_info and pair again.");
          return;
        }

        if (!reconnecting) {
          reconnecting = true;

          console.log(
            "🔄 Reconnecting in 5 seconds..."
          );

          setTimeout(() => {
            reconnecting = false;
            startBot();
          }, 5000);
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
        const cleanNumber =
          phoneNumber.replace(/\D/g, "");

        console.log(
          "📱 Requesting WhatsApp pairing code..."
        );

        const pairingCode =
          await sock.requestPairingCode(cleanNumber);

        console.log("");
        console.log("================================");
        console.log("📱 WHATSAPP PAIRING CODE");
        console.log(pairingCode);
        console.log("================================");
        console.log("");
        console.log(
          "📱 Enter this code in WhatsApp > Linked Devices."
        );
        console.log("");
      } catch (error) {
        console.log(
          "❌ Pairing error:",
          error.message
        );
      }
    }

    // استقبال رسائل المجموعات
    sock.ev.on(
      "messages.upsert",
      async ({ messages }) => {
        try {
          const msg = messages[0];

          if (!msg || !msg.message) return;
          if (msg.key.fromMe) return;

          const jid = msg.key.remoteJid;

          // المجموعات فقط
          if (!jid || !jid.endsWith("@g.us")) {
            return;
          }

          const text =
            msg.message.conversation ||
            msg.message.extendedTextMessage?.text ||
            "";

          console.log("📩 GROUP:", text);

          if (
            text.trim().toLowerCase() === "!test"
          ) {
            await sock.sendMessage(jid, {
              text:
                "🇩🇪🤖 German B1 Bot\n\n" +
                "✅ البوت متصل بالمجموعة بنجاح!"
            });
          }
        } catch (error) {
          console.log(
            "Message error:",
            error.message
          );
        }
      }
    );
  } catch (error) {
    console.log(
      "❌ Bot startup error:",
      error.message
    );

    if (!reconnecting) {
      reconnecting = true;

      console.log(
        "🔄 Restarting bot in 10 seconds..."
      );

      setTimeout(() => {
        reconnecting = false;
        startBot();
      }, 10000);
    }
  }
}

startBot();
