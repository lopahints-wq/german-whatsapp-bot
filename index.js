const express = require("express");
const pino = require("pino");

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestWaWebVersion,
  Browsers
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

const sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

let starting = false;

async function startBot() {
  if (starting) return;

  starting = true;

  try {
    const { state, saveCreds } =
      await useMultiFileAuthState("./auth_info");

    let version;

    try {
      const latest = await fetchLatestWaWebVersion({});

      version = latest.version;

      console.log(
        "📱 WhatsApp Web version:",
        version.join("."),
        "Latest:",
        latest.isLatest
      );
    } catch (error) {
      console.log(
        "⚠️ Could not get latest WhatsApp Web version."
      );
    }

    const options = {
      auth: state,

      logger: pino({
        level: "silent"
      }),

      browser: Browsers.macOS("Chrome"),

      markOnlineOnConnect: false,

      syncFullHistory: false,

      connectTimeoutMs: 60000
    };

    if (version) {
      options.version = version;
    }

    const sock = makeWASocket(options);

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on(
      "connection.update",
      async (update) => {
        const {
          connection,
          lastDisconnect
        } = update;

        if (connection === "connecting") {
          console.log(
            "🔄 Connecting to WhatsApp..."
          );
        }

        if (connection === "open") {
          starting = false;

          console.log("");
          console.log(
            "================================"
          );
          console.log(
            "✅ WHATSAPP CONNECTED!"
          );
          console.log(
            "================================"
          );
          console.log("");
        }

        if (connection === "close") {
          starting = false;

          const code =
            lastDisconnect?.error instanceof Boom
              ? lastDisconnect.error.output
                  .statusCode
              : 0;

          console.log(
            "❌ WhatsApp disconnected. Code:",
            code
          );

          if (
            code ===
            DisconnectReason.loggedOut
          ) {
            console.log(
              "⚠️ WhatsApp logged out."
            );

            console.log(
              "⚠️ A new pairing is required."
            );

            return;
          }

          console.log(
            "🔄 Reconnecting in 5 seconds..."
          );

          setTimeout(() => {
            startBot();
          }, 5000);
        }
      }
    );

    /*
     * WHATSAPP PAIRING CODE
     */

    if (!state.creds.registered) {
      const phoneNumber =
        process.env.WHATSAPP_NUMBER;

      if (!phoneNumber) {
        console.log(
          "❌ WHATSAPP_NUMBER is missing."
        );

        starting = false;
        return;
      }

      const cleanNumber =
        phoneNumber.replace(/\D/g, "");

      await sleep(5000);

      try {
        console.log("");
        console.log(
          "📱 Requesting WhatsApp pairing code..."
        );

        const pairingCode =
          await sock.requestPairingCode(
            cleanNumber
          );

        console.log("");
        console.log(
          "================================"
        );
        console.log(
          "📱 WHATSAPP PAIRING CODE"
        );
        console.log(pairingCode);
        console.log(
          "================================"
        );
        console.log("");

        console.log(
          "📱 WhatsApp → Linked Devices → Link a device → Link with phone number"
        );

        console.log("");
      } catch (error) {
        console.log(
          "❌ Pairing error:",
          error.message
        );
      }
    }

    /*
     * استقبال رسائل المجموعات
     */

    sock.ev.on(
      "messages.upsert",
      async ({ messages }) => {
        try {
          const msg = messages[0];

          if (!msg) return;

          if (!msg.message) return;

          if (msg.key.fromMe) return;

          const jid =
            msg.key.remoteJid;

          // المجموعات فقط
          if (
            !jid ||
            !jid.endsWith("@g.us")
          ) {
            return;
          }

          const text =
            msg.message.conversation ||
            msg.message.extendedTextMessage
              ?.text ||
            "";

          console.log(
            "📩 GROUP:",
            text
          );

          /*
           * اختبار البوت
           */

          if (
            text
              .trim()
              .toLowerCase() === "!test"
          ) {
            await sock.sendMessage(
              jid,
              {
                text:
                  "🇩🇪🤖 German B1 Bot\n\n" +
                  "✅ البوت متصل بالمجموعة بنجاح!"
              }
            );
          }
        } catch (error) {
          console.log(
            "❌ Message error:",
            error.message
          );
        }
      }
    );
  } catch (error) {
    starting = false;

    console.log(
      "❌ Bot startup error:",
      error.message
    );

    console.log(
      "🔄 Restarting in 10 seconds..."
    );

    setTimeout(() => {
      startBot();
    }, 10000);
  }
}

startBot();
