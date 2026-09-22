const express = require("express");
const pino = require("pino");

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  Browsers
} = require("@whiskeysockets/baileys");

const { Boom } = require("@hapi/boom");

const app = express();

const PORT = process.env.PORT || 10000;


// ==========================================
// SERVER
// ==========================================

app.get("/", (req, res) => {
  res.send("🇩🇪 German B1 WhatsApp AI Bot is running!");
});

app.listen(PORT, () => {
  console.log("🌐 Server started on port " + PORT);
});


// ==========================================
// OPENAI
// ==========================================

async function askAI(question) {
async function askAI(question) {

  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey) {
    throw new Error("GROQ_API_KEY is missing.");
  }

  console.log("🧠 Sending message to Groq...");
  console.log("❓ Question:", question);

  const response = await fetch(
    "https://api.groq.com/openai/v1/responses",
    {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + apiKey
      },

      body: JSON.stringify({

        model: "openai/gpt-oss-20b",

        instructions:
          "أنت مساعد ذكاء اصطناعي داخل WhatsApp. " +
          "أنت مدرس لغة ألمانية من مستوى A1 إلى B1، " +
          "لكن يمكنك الإجابة عن أي سؤال يطرحه المستخدم. " +
          "إذا كان السؤال متعلقًا بالألمانية، ساعد المستخدم على التعلم. " +
          "إذا كتب المستخدم بالألمانية، صحح أخطاءه واشرحها بالعربية باختصار. " +
          "إذا كتب بالعربية، أعطه الألمانية المناسبة مع أمثلة عند الحاجة. " +
          "أجب بشكل واضح ومختصر ومناسب لرسائل WhatsApp.",

        input: question
      })
    }
  );

  const data = await response.json();

  if (!response.ok) {

    console.log("❌ GROQ ERROR:");
    console.log(JSON.stringify(data, null, 2));

    throw new Error(
      data?.error?.message ||
      "Groq request failed."
    );
  }

  return (
    data.output_text ||
    "❌ لم أستطع إنشاء إجابة."
  );
}

  return answer;
}


// ==========================================
// START WHATSAPP
// ==========================================

async function startBot() {

  try {

    const {
      state,
      saveCreds
    } = await useMultiFileAuthState("./auth_info");


    // ========================================
    // WHATSAPP
    // ========================================

    const sock = makeWASocket({

      auth: state,

      logger: pino({
        level: "silent"
      }),

      // ======================================
      // CHROME - macOS
      // ======================================

      browser: Browsers.macOS("Chrome"),

      markOnlineOnConnect: false,

      syncFullHistory: false
    });


    // ========================================
    // SAVE AUTH
    // ========================================

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
            "========================================"
          );

          console.log(
            "✅ WHATSAPP CONNECTED!"
          );

          console.log(
            "🤖 GERMAN B1 AI BOT IS READY!"
          );

          console.log(
            "🌐 Browser: macOS Chrome"
          );

          console.log(
            "========================================"
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
          "❌ WHATSAPP_NUMBER is missing!"
        );

        return;
      }


      const cleanNumber =
        phoneNumber.replace(/\D/g, "");


      console.log("");
      console.log(
        "📱 Preparing WhatsApp pairing..."
      );


      await new Promise(
        resolve => setTimeout(resolve, 3000)
      );


      try {

        const pairingCode =
          await sock.requestPairingCode(
            cleanNumber
          );


        console.log("");
        console.log(
          "========================================"
        );

        console.log(
          "📱 WHATSAPP PAIRING CODE"
        );

        console.log(
          pairingCode
        );

        console.log(
          "========================================"
        );

        console.log("");

        console.log(
          "WhatsApp → Settings → Linked Devices"
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
    // RECEIVE MESSAGES
    // ========================================

    sock.ev.on(
      "messages.upsert",
      async ({ messages }) => {

        for (const msg of messages) {

          try {

            if (!msg) continue;

            if (!msg.message) continue;

            // لا يرد على نفسه
            if (msg.key.fromMe) continue;


            const jid =
              msg.key.remoteJid;


            if (!jid) continue;


            // ==================================
            // GROUPS ONLY
            // ==================================

            if (!jid.endsWith("@g.us")) {

              continue;

            }


            // ==================================
            // GET TEXT
            // ==================================

            const text =
              msg.message.conversation ||
              msg.message.extendedTextMessage?.text ||
              msg.message.ephemeralMessage?.message?.conversation ||
              msg.message.ephemeralMessage?.message?.extendedTextMessage?.text ||
              "";


            const cleanText =
              text.trim();


            if (!cleanText) continue;


            console.log("");
            console.log(
              "📩 GROUP MESSAGE:",
              cleanText
            );


            // ==================================
            // TEST
            // ==================================

            if (
              cleanText.toLowerCase() === "!test"
            ) {

              await sock.sendMessage(
                jid,
                {
                  text:
                    "🇩🇪🤖 German B1 Bot\n\n" +
                    "✅ البوت متصل بالمجموعة بنجاح!\n" +
                    "🧠 الذكاء الاصطناعي جاهز."
                }
              );

              console.log(
                "✅ Test message sent."
              );

              continue;
            }


            // ==================================
            // HELP
            // ==================================

            if (
              cleanText.toLowerCase() === "!help"
            ) {

              await sock.sendMessage(
                jid,
                {
                  text:
                    "🇩🇪🤖 German B1 AI Bot\n\n" +
                    "يمكنك الآن كتابة أي سؤال مباشرة.\n\n" +
                    "مثال:\n" +
                    "ما معنى كلمة gehen؟\n\n" +
                    "أو:\n" +
                    "Hallo, wie geht es dir?"
                }
              );

              continue;
            }


            // ==================================
            // AI - ANY MESSAGE
            // ==================================

            console.log(
              "🤖 Sending to AI..."
            );


            // رسالة انتظار
            await sock.sendMessage(
              jid,
              {
                text: "🤖 لحظة، أفكر..."
              }
            );


            // إرسال السؤال إلى OpenAI
            const answer =
              await askAI(cleanText);


            console.log(
              "🤖 ANSWER:",
              answer
            );


            // ==================================
            // SEND AI ANSWER
            // ==================================

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


          } catch (error) {

            console.log(
              "❌ Message error:",
              error.message
            );


            try {

              await sock.sendMessage(
                msg.key.remoteJid,
                {
                  text:
                    "❌ حدث خطأ أثناء معالجة السؤال.\n\n" +
                    "تحقق من OPENAI_API_KEY ثم راجع Logs."
                }
              );

            } catch (sendError) {

              console.log(
                "❌ Could not send error message:",
                sendError.message
              );

            }

          }

        }

      }
    );


  } catch (error) {

    console.log(
      "❌ BOT START ERROR:",
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


// ==========================================
// START
// ==========================================

console.log(
  "🚀 Starting German B1 WhatsApp Bot..."
);

startBot();
