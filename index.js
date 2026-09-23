const express = require("express");
const pino = require("pino");

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  Browsers
} = require("@whiskeysockets/baileys");

const { Boom } = require("@hapi/boom");


// ==================================================
// SERVER
// ==================================================

const app = express();

const PORT = process.env.PORT || 10000;

app.get("/", (req, res) => {
  res.send("🇩🇪 German WhatsApp AI Bot is running!");
});

app.listen(PORT, () => {
  console.log(`🌐 Server started on port ${PORT}`);
});


// ==================================================
// GROQ AI
// ==================================================

async function askAI(question) {

  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey) {
    throw new Error("GROQ_API_KEY is missing in Render.");
  }

  console.log("🧠 Sending message to Groq...");
  console.log("❓ Question:", question);

  const response = await fetch(
    "https://api.groq.com/openai/v1/responses",
    {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },

      body: JSON.stringify({
        model: "openai/gpt-oss-20b",

        instructions: `
أنت مدرس لغة ألمانية داخل مجموعة WhatsApp.

مهمتك الأساسية مساعدة الأعضاء على تعلم اللغة الألمانية من A1 إلى B1.

القواعد:

1. إذا كتب المستخدم جملة بالألمانية:
صححها، ثم اشرح الخطأ بالعربية باختصار.

2. إذا كتب المستخدم كلمة ألمانية:
اشرح معناها بالعربية وأعط مثالاً بالألمانية مع الترجمة.

3. إذا كتب المستخدم بالعربية:
إذا كان يريد ترجمة، أعطه ترجمة ألمانية طبيعية.

4. إذا سأل عن قاعدة ألمانية:
اشرحها بطريقة بسيطة مع مثالين.

5. إذا طلب تمريناً:
أنشئ تمريناً مناسباً لمستواه.

6. إذا كتب "اختبرني":
ابدأ معه اختباراً قصيراً في الألمانية.

7. إذا كان السؤال عاماً:
أجب عنه بشكل طبيعي.

استخدم العربية للشرح والألمانية للأمثلة.

اجعل الإجابات مناسبة لـ WhatsApp وليست طويلة جداً.

كن ودوداً وواضحاً.
`,

        input: question
      })
    }
  );

  const data = await response.json();

  console.log(
    "📦 Groq response status:",
    response.status
  );


  // ==================================================
  // GROQ ERROR
  // ==================================================

  if (!response.ok) {

    console.log(
      "❌ GROQ ERROR:",
      JSON.stringify(data, null, 2)
    );

    throw new Error(
      data?.error?.message ||
      "Groq API request failed."
    );
  }


  // ==================================================
  // GET ANSWER
  // ==================================================

  let answer = "";


  if (
    typeof data.output_text === "string"
  ) {

    answer =
      data.output_text.trim();
  }


  // ==================================================
  // FALLBACK
  // ==================================================

  if (
    !answer &&
    Array.isArray(data.output)
  ) {

    for (
      const item of data.output
    ) {

      if (
        item?.type === "message" &&
        Array.isArray(item.content)
      ) {

        for (
          const content of item.content
        ) {

          if (
            content?.type === "output_text" &&
            typeof content.text === "string"
          ) {

            answer =
              content.text.trim();

            break;
          }
        }
      }

      if (answer) {
        break;
      }
    }
  }


  // ==================================================
  // NO ANSWER
  // ==================================================

  if (!answer) {

    console.log(
      "❌ No text returned from Groq."
    );

    console.log(
      JSON.stringify(data, null, 2)
    );

    throw new Error(
      "Groq returned an empty answer."
    );
  }


  console.log(
    "🤖 ANSWER:",
    answer
  );

  return answer;
}


// ==================================================
// START WHATSAPP BOT
// ==================================================

async function startBot() {

  try {

    console.log(
      "🚀 Starting German B1 WhatsApp Bot..."
    );


    // ==================================================
    // AUTH
    // ==================================================

    const {
      state,
      saveCreds
    } = await useMultiFileAuthState(
      "./auth_info"
    );


    // ==================================================
    // WHATSAPP CONNECTION
    // ==================================================

    const sock = makeWASocket({

      auth: state,

      logger: pino({
        level: "silent"
      }),

      browser: Browsers.macOS("Chrome"),

      markOnlineOnConnect: false,

      syncFullHistory: false
    });


    // ==================================================
    // SAVE CREDENTIALS
    // ==================================================

    sock.ev.on(
      "creds.update",
      saveCreds
    );


    // ==================================================
    // CONNECTION UPDATE
    // ==================================================

    sock.ev.on(
      "connection.update",
      async (update) => {

        const {
          connection,
          lastDisconnect
        } = update;


        // ----------------------------------------------
        // CONNECTING
        // ----------------------------------------------

        if (
          connection === "connecting"
        ) {

          console.log(
            "🔄 Connecting to WhatsApp..."
          );
        }


        // ----------------------------------------------
        // CONNECTED
        // ----------------------------------------------

        if (
          connection === "open"
        ) {

          console.log("");
          console.log(
            "======================================"
          );

          console.log(
            "✅ WHATSAPP CONNECTED!"
          );

          console.log(
            "🤖 GERMAN AI BOT IS READY!"
          );

          console.log(
            "💲 AI responds only to messages ending with $"
          );

          console.log(
            "======================================"
          );

          console.log("");
        }


        // ----------------------------------------------
        // DISCONNECTED
        // ----------------------------------------------

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


          // --------------------------------------------
          // LOGGED OUT
          // --------------------------------------------

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


          // --------------------------------------------
          // RECONNECT
          // --------------------------------------------

          console.log(
            "🔄 Reconnecting in 5 seconds..."
          );


          setTimeout(
            startBot,
            5000
          );
        }

      }
    );


    // ==================================================
    // PAIRING
    // ==================================================

    if (
      !state.creds.registered
    ) {

      const phoneNumber =
        process.env.WHATSAPP_NUMBER;


      if (!phoneNumber) {

        console.log(
          "❌ WHATSAPP_NUMBER is missing in Render."
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
        resolve =>
          setTimeout(
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
          "======================================"
        );

        console.log(
          "📱 WHATSAPP PAIRING CODE:"
        );

        console.log(
          pairingCode
        );

        console.log(
          "======================================"
        );

        console.log("");

      } catch (error) {

        console.log(
          "❌ Pairing error:",
          error.message
        );
      }
    }


    // ==================================================
    // RECEIVE MESSAGES
    // ==================================================

    sock.ev.on(
      "messages.upsert",
      async ({ messages }) => {

        for (
          const msg of messages
        ) {

          try {

            // ------------------------------------------
            // BASIC CHECKS
            // ------------------------------------------

            if (!msg) continue;

            if (!msg.message) continue;

            // لا يرد على رسائله الخاصة
            if (msg.key.fromMe) continue;


            const jid =
              msg.key.remoteJid;


            if (!jid) continue;


            // ------------------------------------------
            // GROUPS ONLY
            // ------------------------------------------

            if (
              !jid.endsWith("@g.us")
            ) {

              continue;
            }


            // ------------------------------------------
            // GET MESSAGE TEXT
            // ------------------------------------------

            let text = "";


            if (
              msg.message.conversation
            ) {

              text =
                msg.message.conversation;

            }


            else if (
              msg.message.extendedTextMessage?.text
            ) {

              text =
                msg.message.extendedTextMessage.text;

            }


            else if (
              msg.message.ephemeralMessage?.message?.conversation
            ) {

              text =
                msg.message.ephemeralMessage.message.conversation;

            }


            else if (
              msg.message.ephemeralMessage?.message?.extendedTextMessage?.text
            ) {

              text =
                msg.message.ephemeralMessage.message.extendedTextMessage.text;
            }


            const question =
              text.trim();


            if (!question) {
              continue;
            }


            // ==================================================
            // LOG MESSAGE
            // ==================================================

            console.log("");
            console.log(
              "📩 GROUP MESSAGE:",
              question
            );


            // ==================================================
            // TEST COMMAND
            // !test يعمل بدون $
            // ==================================================

            if (
              question.toLowerCase() === "!test"
            ) {

              await sock.sendMessage(
                jid,
                {
                  text:
                    "🇩🇪🤖 German B1 Bot\n\n" +
                    "✅ البوت يعمل بشكل صحيح!\n" +
                    "🧠 Groq AI متصل.\n\n" +
                    "💲 الذكاء الاصطناعي يجيب فقط عندما تنتهي الرسالة بـ $"
                }
              );


              console.log(
                "✅ Test message sent."
              );


              continue;
            }


            // ==================================================
            // HELP COMMAND
            // !help يعمل بدون $
            // ==================================================

            if (
              question.toLowerCase() === "!help"
            ) {

              await sock.sendMessage(
                jid,
                {
                  text:
                    "🇩🇪🤖 German B1 AI Bot\n\n" +

                    "اكتب سؤالك وأنهِ الرسالة بعلامة $.\n\n" +

                    "أمثلة:\n\n" +

                    "ما معنى gehen؟$\n\n" +

                    "صحح:\n" +
                    "Ich habe gestern nach Berlin gefahren.$\n\n" +

                    "اشرح لي Akkusativ$\n\n" +

                    "اختبرني في A2$"
                }
              );


              continue;
            }


            // ==================================================
            // ONLY AI MESSAGES ENDING WITH $
            // ==================================================

            if (
              !question.endsWith("$")
            ) {

              console.log(
                "⏭️ Message ignored - no $"
              );

              continue;
            }


            // ==================================================
            // REMOVE $ FROM QUESTION
            // ==================================================

            const aiQuestion =
              question
                .slice(0, -1)
                .trim();


            if (!aiQuestion) {

              console.log(
                "⏭️ Empty AI question."
              );

              continue;
            }


            // ==================================================
            // SEND TO AI
            // ==================================================

            console.log(
              "🤖 Sending to AI..."
            );

            console.log(
              "❓ AI Question:",
              aiQuestion
            );


            // ==================================================
            // ASK AI
            // ==================================================

            const answer =
              await askAI(
                aiQuestion
              );


            // ==================================================
            // SEND ANSWER
            // ==================================================

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

          }


          // ==================================================
          // MESSAGE ERROR
          // ==================================================

          catch (error) {

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
                    "حاول مرة أخرى."
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

  }


  // ==================================================
  // BOT START ERROR
  // ==================================================

  catch (error) {

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


// ==================================================
// START BOT
// ==================================================

startBot();
