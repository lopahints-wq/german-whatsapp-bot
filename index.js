const express = require("express");
const pino = require("pino");
const OpenAI = require("openai");

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason
} = require("@whiskeysockets/baileys");

const { Boom } = require("@hapi/boom");

// ========================================
// SERVER
// ========================================

const app = express();

const PORT = process.env.PORT || 10000;

app.get("/", (req, res) => {
  res.send("🇩🇪 German B1 WhatsApp Bot is running!");
});

app.listen(PORT, () => {
  console.log("🌐 Server started on port " + PORT);
});

// ========================================
// OPENAI
// ========================================

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// ========================================
// WHATSAPP BOT
// ========================================

async function startBot() {

  const { state, saveCreds } =
    await useMultiFileAuthState("./auth_info");

  const sock = makeWASocket({
    auth: state,

    logger: pino({
      level: "silent"
    }),

    browser: [
      "German B1 Bot",
      "Chrome",
      "1.0.0"
    ],

    markOnlineOnConnect: false,

    syncFullHistory: false
  });

  // حفظ بيانات تسجيل الدخول
  sock.ev.on("creds.update", saveCreds);

  // ========================================
  // CONNECTION
  // ========================================

  sock.ev.on(
    "connection.update",
    async (update) => {

      const {
        connection,
        lastDisconnect
      } = update;

      // -------------------------
      // Connecting
      // -------------------------

      if (connection === "connecting") {

        console.log(
          "🔄 Connecting to WhatsApp..."
        );
      }

      // -------------------------
      // Connected
      // -------------------------

      if (connection === "open") {

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

      // -------------------------
      // Disconnected
      // -------------------------

      if (connection === "close") {

        const code =
          lastDisconnect?.error instanceof Boom
            ? lastDisconnect.error.output.statusCode
            : 0;

        console.log(
          "❌ WhatsApp disconnected. Code:",
          code
        );

        // إذا لم يتم تسجيل الخروج
        if (
          code !== DisconnectReason.loggedOut
        ) {

          console.log(
            "🔄 Reconnecting in 5 seconds..."
          );

          setTimeout(
            startBot,
            5000
          );

        } else {

          console.log(
            "⚠️ WhatsApp logged out."
          );

          console.log(
            "⚠️ A new pairing is required."
          );
        }
      }
    }
  );

  // ========================================
  // PAIRING CODE
  // ========================================

  if (!state.creds.registered) {

    const phoneNumber =
      process.env.WHATSAPP_NUMBER;

    if (!phoneNumber) {

      console.log(
        "❌ WHATSAPP_NUMBER is missing."
      );

      return;
    }

    try {

      console.log(
        "📱 Requesting WhatsApp pairing code..."
      );

      // انتظار بسيط حتى يبدأ الاتصال
      await new Promise(
        resolve => setTimeout(resolve, 5000)
      );

      const pairingCode =
        await sock.requestPairingCode(
          phoneNumber.replace(/\D/g, "")
        );

      console.log("");

      console.log(
        "================================"
      );

      console.log(
        "📱 WHATSAPP PAIRING CODE"
      );

      console.log(
        pairingCode
      );

      console.log(
        "================================"
      );

      console.log("");

      console.log(
        "📱 WhatsApp → Linked Devices"
      );

      console.log(
        "→ Link a device"
      );

      console.log(
        "→ Link with phone number"
      );

      console.log("");

    } catch (error) {

      console.log(
        "❌ Pairing error:",
        error.message
      );
    }
  }

  // ========================================
  // MESSAGES
  // ========================================

  sock.ev.on(
    "messages.upsert",
    async ({ messages }) => {

      try {

        const msg = messages[0];

        // لا توجد رسالة
        if (!msg) return;

        // لا توجد بيانات
        if (!msg.message) return;

        // تجاهل رسائل البوت نفسه
        if (msg.key.fromMe) return;

        const jid =
          msg.key.remoteJid;

        // ====================================
        // GROUPS ONLY
        // ====================================

        if (
          !jid ||
          !jid.endsWith("@g.us")
        ) {
          return;
        }

        // ====================================
        // GET TEXT
        // ====================================

        const text =
          msg.message.conversation ||
          msg.message.extendedTextMessage?.text ||
          "";

        if (!text.trim()) return;

        console.log("");
        console.log(
          "📩 GROUP:",
          text
        );

        // ====================================
        // TEST COMMAND
        // ====================================

        if (
          text.trim().toLowerCase() ===
          "!test"
        ) {

          await sock.sendMessage(
            jid,
            {
              text:
                "🇩🇪🤖 German B1 Bot\n\n" +
                "✅ البوت متصل بالمجموعة بنجاح!"
            }
          );

          console.log(
            "✅ Test response sent."
          );

          return;
        }

        // ====================================
        // HELP COMMAND
        // ====================================

        if (
          text.trim().toLowerCase() ===
          "!help"
        ) {

          await sock.sendMessage(
            jid,
            {
              text:
                "🇩🇪🤖 German B1 Bot\n\n" +
                "أنا مدرس ألمانية بالذكاء الاصطناعي.\n\n" +
                "أرسل أي جملة أو سؤال.\n\n" +
                "مثال:\n" +
                "Hallo, ich möchte Deutsch lernen."
            }
          );

          return;
        }

        // ====================================
        // CHECK OPENAI KEY
        // ====================================

        if (!process.env.OPENAI_API_KEY) {

          console.log(
            "❌ OPENAI_API_KEY is missing."
          );

          await sock.sendMessage(
            jid,
            {
              text:
                "❌ لم يتم إعداد OPENAI_API_KEY في Render."
            }
          );

          return;
        }

        // ====================================
        // SEND TO AI
        // ====================================

        console.log(
          "🤖 Sending message to OpenAI..."
        );

        const response =
          await openai.responses.create({

            model: "gpt-5.6-luna",

            instructions:
              `
أنت مدرس لغة ألمانية داخل مجموعة واتساب.

مهمتك مساعدة الطلاب على تعلم اللغة الألمانية.

المستوى الأساسي A1 إلى B1.

إذا كتب الطالب بالألمانية:
1. افهم قصده.
2. صحح الأخطاء إن وجدت.
3. اكتب الجملة الصحيحة.
4. اشرح الخطأ بالعربية بطريقة بسيطة.
5. أعطه مثالاً إضافياً بالألمانية.

إذا كتب الطالب بالعربية:
أجب بالعربية وأعطه أمثلة باللغة الألمانية.

إذا سأل عن كلمة ألمانية:
اشرح معناها بالعربية وأعطه مثالاً.

اجعل إجاباتك قصيرة وواضحة ومناسبة لواتساب.

لا تستخدم إجابات طويلة جداً.

كن ودوداً ومشجعاً.
`,

            input: text,

            max_output_tokens: 500
          });

        // ====================================
        // GET AI ANSWER
        // ====================================

        const answer =
          response.output_text ||
          "عذراً، لم أستطع إنشاء إجابة الآن.";

        console.log(
          "🤖 AI:",
          answer
        );

        // ====================================
        // SEND ANSWER TO WHATSAPP
        // ====================================

        await sock.sendMessage(
          jid,
          {
            text:
              "🇩🇪🤖 German B1 Bot\n\n" +
              answer
          }
        );

        console.log(
          "✅ AI response sent to group."
        );

      } catch (error) {

        console.log(
          "❌ Message error:",
          error.message
        );

        console.log(
          error
        );
      }
    }
  );
}

// ========================================
// START
// ========================================

console.log(
  "🚀 Starting German B1 WhatsApp Bot..."
);

startBot();
