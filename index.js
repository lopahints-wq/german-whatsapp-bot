const express = require("express");
const pino = require("pino");

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  Browsers,
  fetchLatestWaWebVersion
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
أنت مدرس لغة ألمانية ذكي داخل مجموعة WhatsApp.

مهمتك مساعدة أعضاء المجموعة على تعلم اللغة الألمانية من A1 إلى B1.

القواعد:

1. إذا كتب المستخدم جملة بالألمانية:
صحح الجملة واشرح الخطأ بالعربية باختصار.

2. إذا كتب كلمة ألمانية:
اشرح معناها بالعربية وأعط مثالاً بالألمانية مع الترجمة.

3. إذا كتب بالعربية وطلب ترجمة:
أعطه ترجمة ألمانية طبيعية.

4. إذا سأل عن قاعدة ألمانية:
اشرحها بطريقة بسيطة مع أمثلة.

5. إذا طلب تمريناً:
أنشئ تمريناً مناسباً لمستواه.

6. إذا كتب "اختبرني":
ابدأ اختباراً قصيراً.

7. إذا كان السؤال عاماً:
أجب بشكل طبيعي.

استخدم العربية في الشرح والألمانية في الأمثلة.

اجعل الإجابات مناسبة لـ WhatsApp.
لا تكن طويلاً جداً إلا إذا كان السؤال يحتاج شرحاً.

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

  let answer = "";

  // الطريقة الأولى
  if (
    typeof data.output_text === "string"
  ) {

    answer =
      data.output_text.trim();
  }

  // الطريقة الاحتياطية
  if (
    !answer &&
    Array.isArray(data.output)
  ) {

    for (const item of data.output) {

      if (
        item?.type === "message" &&
        Array.isArray(item.content)
      ) {

        for (const content of item.content) {

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
// START WHATSAPP
// ==================================================

async function startBot() {

  try {

    console.log("");
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
    // GET CURRENT WHATSAPP WEB VERSION
    // ==================================================

    let waVersion;

    try {

      console.log(
        "🌐 Getting latest WhatsApp Web version..."
      );

      const latest =
        await fetchLatestWaWebVersion({});

      waVersion =
        latest.version;

      console.log(
        "✅ WhatsApp Web version:",
        waVersion.join(".")
      );

    } catch (error) {

      console.log(
        "⚠️ Could not get latest WhatsApp Web version."
      );

      console.log(
        error.message
      );
    }


    // ==================================================
    // CREATE SOCKET
    // ==================================================

    const socketOptions = {

      auth: state,

      logger: pino({
        level: "silent"
      }),

      // لا نحتاج Chrome فعلي.
      // Baileys يتصل مباشرة عبر WebSocket.
      browser:
        Browsers.macOS("Chrome"),

      markOnlineOnConnect: false,

      syncFullHistory: false,

      printQRInTerminal: false,

      connectTimeoutMs: 60000,

      defaultQueryTimeoutMs: 60000
    };


    // إضافة النسخة فقط إذا تم الحصول عليها
    if (waVersion) {

      socketOptions.version =
        waVersion;
    }


    const sock =
      makeWASocket(socketOptions);


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
          lastDisconnect,
          qr
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
        // QR EVENT
        // ----------------------------------------------

        if (qr) {

          console.log(
            "📷 WhatsApp QR generated."
          );
        }


        // ----------------------------------------------
        // OPEN
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
            "📊 Poll system enabled."
          );

          console.log(
            "======================================"
          );

          console.log("");
        }


        // ----------------------------------------------
        // CLOSE
        // ----------------------------------------------

        if (
          connection === "close"
        ) {

          let code = 0;

          try {

            if (
              lastDisconnect?.error
            ) {

              const boom =
                lastDisconnect.error instanceof Boom
                  ? lastDisconnect.error
                  : new Boom(
                      lastDisconnect.error
                    );

              code =
                boom.output?.statusCode || 0;
            }

          } catch (error) {

            console.log(
              "⚠️ Could not read disconnect code:",
              error.message
            );
          }


          console.log(
            "❌ WhatsApp disconnected."
          );

          console.log(
            "📛 Disconnect code:",
            code
          );


          // ------------------------------------------
          // LOGGED OUT
          // ------------------------------------------

          if (
            code === DisconnectReason.loggedOut
          ) {

            console.log("");
            console.log(
              "⚠️ WhatsApp logged out."
            );

            console.log(
              "⚠️ Delete auth_info and pair again."
            );

            return;
          }


          // ------------------------------------------
          // RESTART REQUIRED
          // ------------------------------------------

          if (
            code === DisconnectReason.restartRequired
          ) {

            console.log(
              "🔄 WhatsApp requires restart."
            );

            setTimeout(
              startBot,
              3000
            );

            return;
          }


          // ------------------------------------------
          // NORMAL RECONNECT
          // ------------------------------------------

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
    // PAIRING CODE
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


      // ----------------------------------------------
      // CLEAN NUMBER
      // ----------------------------------------------

      const cleanNumber =
        phoneNumber.replace(
          /\D/g,
          ""
        );


      console.log("");
      console.log(
        "📱 WhatsApp number:",
        cleanNumber
      );

      console.log(
        "📱 Preparing pairing..."
      );


      // ----------------------------------------------
      // WAIT FOR CONNECTION
      // ----------------------------------------------

      await new Promise(
        resolve =>
          setTimeout(
            resolve,
            5000
          )
      );


      try {

        console.log(
          "📱 Requesting WhatsApp pairing code..."
        );


        const pairingCode =
          await sock.requestPairingCode(
            cleanNumber
          );


        console.log("");
        console.log(
          "======================================"
        );

        console.log(
          "📱 WHATSAPP PAIRING CODE"
        );

        console.log(
          pairingCode
        );

        console.log(
          "======================================"
        );

        console.log("");

        console.log(
          "📲 On WhatsApp:"
        );

        console.log(
          "Settings → Linked Devices → Link a Device"
        );

        console.log(
          "→ Link with phone number"
        );

        console.log(
          "→ Enter the code above"
        );

        console.log("");

      } catch (error) {

        console.log("");
        console.log(
          "❌ PAIRING ERROR"
        );

        console.log(
          error.message
        );

        console.log(
          JSON.stringify(
            error,
            null,
            2
          )
        );

        console.log("");
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
            // BASIC CHECK
            // ------------------------------------------

            if (!msg) {
              continue;
            }

            if (!msg.message) {
              continue;
            }

            if (msg.key.fromMe) {
              continue;
            }


            const jid =
              msg.key.remoteJid;


            if (!jid) {
              continue;
            }


            // ------------------------------------------
            // GROUPS ONLY
            // ------------------------------------------

            if (
              !jid.endsWith("@g.us")
            ) {

              continue;
            }


            // ------------------------------------------
            // GET TEXT
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
                msg.message
                  .ephemeralMessage
                  .message
                  .conversation;

            }


            else if (
              msg.message.ephemeralMessage?.message?.extendedTextMessage?.text
            ) {

              text =
                msg.message
                  .ephemeralMessage
                  .message
                  .extendedTextMessage
                  .text;

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
            // ==================================================

            if (
              question.toLowerCase() === "!test"
            ) {

              await sock.sendMessage(
                jid,
                {
                  text:
                    "🇩🇪🤖 German B1 Bot\n\n" +
                    "✅ البوت يعمل.\n" +
                    "🧠 Groq متصل.\n" +
                    "📊 Poll system يعمل.\n" +
                    "💲 AI trigger: $"
                }
              );

              continue;
            }


            // ==================================================
            // HELP
            // ==================================================

            if (
              question.toLowerCase() === "!help"
            ) {

              await sock.sendMessage(
                jid,
                {
                  text:
                    "🇩🇪🤖 German B1 AI Bot\n\n" +

                    "💡 الذكاء الاصطناعي يرد فقط عندما تنتهي الرسالة بـ $.\n\n" +

                    "مثال:\n" +
                    "Hallo\n" +
                    "❌ لا يوجد رد\n\n" +

                    "Hallo$\n" +
                    "✅ البوت يرد\n\n" +

                    "📊 إنشاء استفتاء:\n" +
                    "!poll$ سؤال | خيار 1 | خيار 2\n\n" +

                    "مثال:\n" +
                    "!poll$ Was möchtest du lernen? | Grammatik | Sprechen | Wortschatz"
                }
              );

              continue;
            }


            // ==================================================
            // POLL SYSTEM
            // ==================================================
            //
            // الصيغة:
            //
            // !poll$ السؤال | الخيار 1 | الخيار 2
            //
            // مثال:
            //
            // !poll$ Was lernst du heute? | Grammatik | Sprechen
            //
            // ==================================================

            if (
              question.toLowerCase().startsWith("!poll$")
            ) {

              const pollContent =
                question
                  .slice(6)
                  .trim();


              if (!pollContent) {

                await sock.sendMessage(
                  jid,
                  {
                    text:
                      "❌ اكتب الاستفتاء بهذا الشكل:\n\n" +
                      "!poll$ السؤال | الخيار 1 | الخيار 2"
                  }
                );

                continue;
              }


              const parts =
                pollContent
                  .split("|")
                  .map(
                    item => item.trim()
                  )
                  .filter(Boolean);


              if (
                parts.length < 3
              ) {

                await sock.sendMessage(
                  jid,
                  {
                    text:
                      "❌ الاستفتاء يحتاج سؤالاً وخيارين على الأقل.\n\n" +
                      "مثال:\n" +
                      "!poll$ Was lernst du? | Grammatik | Sprechen"
                  }
                );

                continue;
              }


              const pollQuestion =
                parts[0];


              const options =
                parts
                  .slice(1)
                  .slice(0, 12);


              if (
                options.length < 2
              ) {

                await sock.sendMessage(
                  jid,
                  {
                    text:
                      "❌ يجب أن يكون هناك خياران على الأقل."
                  }
                );

                continue;
              }


              console.log(
                "📊 Creating poll:",
                pollQuestion
              );


              await sock.sendMessage(
                jid,
                {
                  poll: {

                    name:
                      pollQuestion,

                    values:
                      options,

                    selectableCount:
                      1

                  }
                }
              );


              console.log(
                "✅ Poll sent."
              );


              continue;
            }


            // ==================================================
            // AI ONLY WHEN MESSAGE ENDS WITH $
            // ==================================================

            if (
              !question.endsWith("$")
            ) {

              console.log(
                "⏭️ No $ at end. Ignoring."
              );

              continue;
            }


            // ==================================================
            // REMOVE $
            // ==================================================

            const aiQuestion =
              question
                .slice(0, -1)
                .trim();


            if (!aiQuestion) {
              continue;
            }


            console.log(
              "💲 AI TRIGGER DETECTED"
            );

            console.log(
              "🤖 Sending to AI:",
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
                    "❌ حدث خطأ أثناء معالجة الرسالة.\n\n" +
                    "حاول مرة أخرى."
                }
              );

            } catch (sendError) {

              console.log(
                "❌ Could not send error:",
                sendError.message
              );
            }
          }
        }
      }
    );

  }


  // ==================================================
  // START ERROR
  // ==================================================

  catch (error) {

    console.log("");
    console.log(
      "❌ BOT START ERROR:"
    );

    console.log(
      error.message
    );

    console.log("");

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
// START
// ==================================================

startBot();
