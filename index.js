const express = require("express");
const pino = require("pino");

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  Browsers
} = require("@whiskeysockets/baileys");

const { Boom } = require("@hapi/boom");


// ==========================================
// SERVER
// ==========================================

const app = express();

const PORT = process.env.PORT || 10000;

app.get("/", (req, res) => {
  res.send("🇩🇪 German B1 WhatsApp AI Bot is running!");
});

app.listen(PORT, () => {
  console.log("🌐 Server started on port " + PORT);
});


// ==========================================
// GROQ AI
// ==========================================

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
          "أنت مساعد ذكاء اصطناعي داخل مجموعة WhatsApp لتعلم اللغة الألمانية. " +

          "أنت مدرس لغة ألمانية من مستوى A1 إلى B1. " +

          "إذا كتب المستخدم جملة بالألمانية، صحح أخطاءه واشرح الخطأ بالعربية باختصار. " +

          "إذا كتب المستخدم بالعربية ويريد ترجمتها، أعطه ترجمة ألمانية طبيعية ومناسبة لمستواه. " +

          "إذا سأل عن كلمة ألمانية، اشرح معناها بالعربية وأعط مثالًا ألمانيًا مع الترجمة. " +

          "إذا سأل عن قاعدة ألمانية، اشرحها بطريقة سهلة مع أمثلة. " +

          "يمكنك الإجابة عن الأسئلة العامة أيضًا إذا كانت مناسبة. " +

          "استخدم العربية في الشرح والألمانية في الأمثلة. " +

          "اجعل الإجابات واضحة ومختصرة ومناسبة لـ WhatsApp. " +

          "لا تستخدم إجابات طويلة جدًا.",

        input: question
      })
    }
  );


  // ==========================================
  // READ RESPONSE
  // ==========================================

  const data = await response.json();


  console.log(
    "📦 Groq response received."
  );


  // ==========================================
  // GROQ ERROR
  // ==========================================

  if (!response.ok) {

    console.log("❌ GROQ ERROR:");

    console.log(
      JSON.stringify(data, null, 2)
    );

    throw new Error(
      data?.error?.message ||
      "Groq request failed."
    );
  }


  // ==========================================
  // GET ANSWER
  // ==========================================

  let answer = "";


  // الطريقة الأولى
  if (
    typeof data.output_text === "string" &&
    data.output_text.trim()
  ) {

    answer = data.output_text.trim();

  }


  // الطريقة الثانية
  if (
    !answer &&
    Array.isArray(data.output)
  ) {

    for (const item of data.output) {

      if (
        item &&
        item.type === "message" &&
        Array.isArray(item.content)
      ) {

        for (const content of item.content) {

          if (
            content &&
            content.type === "output_text" &&
            typeof content.text === "string"
          ) {

            answer = content.text.trim();

            break;
          }

        }
      }

      if (answer) {
        break;
      }
    }
  }


  // ==========================================
  // FALLBACK
  // ==========================================

  if (!answer) {

    console.log(
      "❌ Groq returned no readable text."
    );

    console.log(
      JSON.stringify(data, null, 2)
    );

    throw new Error(
      "Groq returned no text."
    );
  }


  console.log(
    "✅ AI answer received."
  );


  return answer;
}


// ==========================================
// START WHATSAPP BOT
// ==========================================

async function startBot() {

  try {

    console.log(
      "🚀 Starting German B1 WhatsApp Bot..."
    );


    // ========================================
    // AUTH
    // ========================================

    const {
      state,
      saveCreds
    } = await useMultiFileAuthState(
      "./auth_info"
    );


    // ========================================
    // WHATSAPP SOCKET
    // ========================================

    const sock = makeWASocket({

      auth: state,

      logger: pino({
        level: "silent"
      }),

      browser: Browsers.macOS("Chrome"),

      markOnlineOnConnect: false,

      syncFullHistory: false

    });


    // ========================================
    // SAVE CREDENTIALS
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


        if (
          connection === "connecting"
        ) {

          console.log(
            "🔄 Connecting to WhatsApp..."
          );

        }


        if (
          connection === "open"
        ) {

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
            "========================================"
          );

          console.log("");

        }


        if (
          connection === "close"
        ) {

          let code = 0;


          try {

            if (
              lastDisconnect?.error instanceof Boom
            ) {

              code =
                lastDisconnect.error.output.statusCode;

            }

          } catch (e) {

            console.log(
              "⚠️ Could not read disconnect code."
            );

          }


          console.log(
            "❌ WhatsApp disconnected. Code:",
            code
          );


          // ====================================
          // LOGGED OUT
          // ====================================

          if (
            code === DisconnectReason.loggedOut
          ) {

            console.log(
              "⚠️ WhatsApp logged out."
            );

            console.log(
              "⚠️ You need to pair WhatsApp again."
            );

            return;
          }


          // ====================================
          // RECONNECT
          // ====================================

          console.log(
            "🔄 Reconnecting in 5 seconds..."
          );


          setTimeout(
            () => {
              startBot();
            },
            5000
          );

        }

      }
    );


    // ========================================
    // PAIRING CODE
    // ========================================

    if (
      !state.creds.registered
    ) {

      const phoneNumber =
        process.env.WHATSAPP_NUMBER;


      if (!phoneNumber) {

        console.log(
          "❌ WHATSAPP_NUMBER is missing!"
        );

        return;
      }


      const cleanNumber =
        phoneNumber.replace(
          /\D/g,
          ""
        );


      console.log(
        "📱 Preparing WhatsApp pairing..."
      );


      await new Promise(
        resolve => setTimeout(
          resolve,
          3000
        )
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

        for (
          const msg of messages
        ) {

          try {

            // ==================================
            // BASIC CHECKS
            // ==================================

            if (!msg) {
              continue;
            }


            if (!msg.message) {
              continue;
            }


            // لا يرد على نفسه
            if (msg.key.fromMe) {
              continue;
            }


            const jid =
              msg.key.remoteJid;


            if (!jid) {
              continue;
            }


            // ==================================
            // GROUPS ONLY
            // ==================================

            if (
              !jid.endsWith("@g.us")
            ) {

              continue;
            }


            // ==================================
            // GET MESSAGE TEXT
            // ==================================

            let text = "";


            if (
              msg.message.conversation
            ) {

              text =
                msg.message.conversation;

            } else if (
              msg.message.extendedTextMessage?.text
            ) {

              text =
                msg.message.extendedTextMessage.text;

            } else if (
              msg.message.ephemeralMessage?.message?.conversation
            ) {

              text =
                msg.message.ephemeralMessage.message.conversation;

            } else if (
              msg.message.ephemeralMessage?.message?.extendedTextMessage?.text
            ) {

              text =
                msg.message.ephemeralMessage.message.extendedTextMessage.text;

            }


            const cleanText =
              text.trim();


            if (!cleanText) {
              continue;
            }


            // ==================================
            // LOG MESSAGE
            // ==================================

            console.log("");

            console.log(
              "📩 GROUP MESSAGE:",
              cleanText
            );


            // ==================================
            // !TEST
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
            // !HELP
            // ==================================

            if (
              cleanText.toLowerCase() === "!help"
            ) {

              await sock.sendMessage(
                jid,
                {
                  text:
                    "🇩🇪🤖 German B1 AI Bot\n\n" +

                    "اكتب أي سؤال مباشرة.\n\n" +

                    "مثال:\n" +
                    "ما معنى gehen؟\n\n" +

                    "أو:\n" +
                    "Hallo, wie geht es dir?\n\n" +

                    "أو:\n" +
                    "صحح:\n" +
                    "Ich habe gestern nach Berlin gefahren."
                }
              );


              continue;
            }


            // ==================================
            // SEND TO AI
            // ==================================

            console.log(
              "🤖 Sending to AI..."
            );


            // ==================================
            // ASK AI
            // ==================================

            const answer =
              await askAI(
                cleanText
              );


            console.log(
              "🤖 ANSWER:",
              answer
            );


            // ==================================
            // SEND ANSWER TO WHATSAPP
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

            // ==================================
            // MESSAGE ERROR
            // ==================================

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
                    "راجع Logs في Render."
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
      () => {
        startBot();
      },
      10000
    );

  }

}


// ==========================================
// START
// ==========================================

startBot();
