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
  res.send("🇩🇪 German B1 WhatsApp AI Bot is running!");
});

app.listen(PORT, () => {
  console.log("🌐 Server started on port " + PORT);
});

const sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));


// ============================================
// OPENAI
// ============================================

async function askAI(question) {

  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is missing in Render Environment Variables."
    );
  }

  console.log("🧠 Sending to OpenAI...");

  const response = await fetch(
    "https://api.openai.com/v1/responses",
    {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + apiKey
      },

      body: JSON.stringify({
        model: "gpt-5",

        instructions:
          "أنت مدرس لغة ألمانية داخل WhatsApp. " +
          "ساعد المستخدم على تعلم الألمانية من مستوى A1 إلى B1. " +
          "إذا كتب المستخدم بالألمانية، صحح أخطاءه واشرحها بالعربية باختصار. " +
          "إذا كتب بالعربية، ساعده بالترجمة والأمثلة الألمانية. " +
          "كن ودودًا ومختصرًا ومناسبًا لمحادثة WhatsApp.",

        input: question
      })
    }
  );

  const data = await response.json();

  if (!response.ok) {
    console.log("❌ OPENAI ERROR:");
    console.log(JSON.stringify(data, null, 2));

    throw new Error(
      data?.error?.message ||
      "OpenAI request failed."
    );
  }

  return (
    data.output_text ||
    "❌ لم أستطع إنشاء إجابة."
  );
}


// ============================================
// START WHATSAPP BOT
// ============================================

async function startBot() {

  try {

    const {
      state,
      saveCreds
    } = await useMultiFileAuthState("./auth_info");


    // ========================================
    // نفس إعداد الاتصال القديم
    // ========================================

    const sock = makeWASocket({

      auth: state,

      logger: pino({
        level: "silent"
      }),

      // لا نغير هذا
      browser: [
        "German B1 Bot",
        "Chrome",
        "1.0.0"
      ],

      markOnlineOnConnect: false,

      syncFullHistory: false
    });


    sock.ev.on(
      "creds.update",
      saveCreds
    );


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


        if (connection === "connecting") {

          console.log(
            "🔄 Connecting to WhatsApp..."
          );

        }


        if (connection === "open") {

          console.log("");
          console.log(
            "================================"
          );

          console.log(
            "✅ WHATSAPP CONNECTED!"
          );

          console.log(
            "🤖 AI BOT IS READY!"
          );

          console.log(
            "================================"
          );

          console.log("");

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


          if (
            code === DisconnectReason.loggedOut
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


      const cleanNumber =
        phoneNumber.replace(/\D/g, "");


      await sleep(3000);


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

        console.log(
          pairingCode
        );

        console.log(
          "================================"
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
    // RECEIVE MESSAGES
    // ========================================

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


          if (!jid) return;


          // ==================================
          // المجموعات فقط
          // ==================================

          if (!jid.endsWith("@g.us")) {
            return;
          }


          // ==================================
          // استخراج النص
          // ==================================

          const text =
            msg.message.conversation ||
            msg.message.extendedTextMessage?.text ||
            "";


          const cleanText =
            text.trim();


          if (!cleanText) return;


          console.log("");
          console.log(
            "📩 GROUP:",
            cleanText
          );


          // ==================================
          // TEST
          // ==================================

          if (
            cleanText.toLowerCase() ===
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
              "✅ Test reply sent."
            );

            return;
          }


          // ==================================
          // HELP
          // ==================================

          if (
            cleanText.toLowerCase() ===
            "!help"
          ) {

            await sock.sendMessage(
              jid,
              {
                text:
                  "🇩🇪🤖 German B1 AI Bot\n\n" +
                  "لطرح سؤال على الذكاء الاصطناعي:\n\n" +
                  "!ai سؤالك\n\n" +
                  "مثال:\n" +
                  "!ai ما معنى كلمة gehen؟"
              }
            );

            return;
          }


          // ==================================
          // AI
          // ==================================

          if (
            cleanText
              .toLowerCase()
              .startsWith("!ai")
          ) {

            const question =
              cleanText
                .substring(3)
                .trim();


            if (!question) {

              await sock.sendMessage(
                jid,
                {
                  text:
                    "🤖 اكتب سؤالك بعد !ai\n\n" +
                    "مثال:\n" +
                    "!ai كيف أقول أنا أتعلم الألمانية؟"
                }
              );

              return;
            }


            console.log(
              "🤖 QUESTION:",
              question
            );


            // رسالة انتظار
            await sock.sendMessage(
              jid,
              {
                text:
                  "🤖 لحظة، أفكر..."
              }
            );


            const answer =
              await askAI(question);


            console.log(
              "🤖 ANSWER:",
              answer
            );


            await sock.sendMessage(
              jid,
              {
                text:
                  "🇩🇪🤖 German B1 Bot\n\n" +
                  answer
              }
            );


            console.log(
              "✅ AI reply sent."
            );

            return;
          }

        } catch (error) {

          console.log("");
          console.log(
            "❌ MESSAGE ERROR:"
          );

          console.log(
            error.message
          );

          console.log("");

        }

      }
    );

  } catch (error) {

    console.log(
      "❌ BOT ERROR:",
      error.message
    );


    console.log(
      "🔄 Restarting in 10 seconds..."
    );


    setTimeout(
      startBot,
      10000
    );

  }

}


// ============================================
// START
// ============================================

console.log(
  "🚀 Starting German B1 WhatsApp Bot..."
);

startBot();
