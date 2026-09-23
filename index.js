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
// GROQ API
// ==================================================

async function groqRequest(instructions, input) {

  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey) {
    throw new Error("GROQ_API_KEY is missing in Render.");
  }

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
        instructions,
        input
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

  // الطريقة الرسمية
  if (
    typeof data.output_text === "string"
  ) {
    answer = data.output_text.trim();
  }

  // احتياط
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

      if (answer) break;
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

  return answer;
}


// ==================================================
// NORMAL AI
// ==================================================

async function askAI(question) {

  console.log(
    "🧠 Sending question to Groq..."
  );

  console.log(
    "❓ Question:",
    question
  );

  const instructions = `
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
`;

  const answer =
    await groqRequest(
      instructions,
      question
    );

  console.log(
    "🤖 ANSWER:",
    answer
  );

  return answer;
}


// ==================================================
// CREATE QUIZ
// ==================================================

async function createQuiz(level) {

  console.log(
    `🧠 Creating ${level} quiz...`
  );

  const instructions = `
أنت مدرس لغة ألمانية وخبير في إعداد اختبارات اللغة.

أنشئ سؤال اختيار من متعدد واحد فقط.

المستوى:
${level}

الشروط:

- السؤال باللغة الألمانية.
- مناسب تماماً للمستوى ${level}.
- 4 خيارات فقط.
- إجابة واحدة صحيحة.
- الخيارات باللغة الألمانية.
- لا تضع A أو B أو C أو D داخل الخيارات.
- لا تستخدم Markdown.
- أرسل JSON فقط.
- لا تضف أي كلام قبل أو بعد JSON.

يجب أن يكون الشكل:

{
  "question": "السؤال بالألمانية",
  "options": [
    "الخيار الأول",
    "الخيار الثاني",
    "الخيار الثالث",
    "الخيار الرابع"
  ],
  "correct": 0,
  "explanation": "شرح مختصر بالعربية"
}

correct يجب أن يكون:
0 للخيار الأول
1 للخيار الثاني
2 للخيار الثالث
3 للخيار الرابع.
`;

  const raw =
    await groqRequest(
      instructions,
      `أنشئ سؤال ${level} جديداً الآن.`
    );

  console.log(
    "📦 RAW QUIZ:",
    raw
  );

  // تنظيف Markdown إذا أضافه AI
  let clean =
    raw
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .trim();

  let quiz;

  try {

    quiz =
      JSON.parse(clean);

  } catch (error) {

    console.log(
      "❌ Quiz JSON error:",
      clean
    );

    throw new Error(
      "AI returned invalid quiz JSON."
    );
  }

  // ==================================================
  // VALIDATION
  // ==================================================

  if (
    !quiz.question ||
    !Array.isArray(quiz.options) ||
    quiz.options.length !== 4 ||
    typeof quiz.correct !== "number"
  ) {

    throw new Error(
      "Invalid quiz format."
    );
  }

  if (
    quiz.correct < 0 ||
    quiz.correct > 3
  ) {

    throw new Error(
      "Invalid correct answer."
    );
  }

  return quiz;
}


// ==================================================
// WHATSAPP
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
    } =
      await useMultiFileAuthState(
        "./auth_info"
      );


    // ==================================================
    // CREATE WHATSAPP CONNECTION
    // ==================================================

    const sock =
      makeWASocket({

        auth: state,

        logger: pino({
          level: "silent"
        }),

        // نفس Browser الذي كان يعمل عندك
        browser:
          Browsers.macOS("Chrome"),

        markOnlineOnConnect:
          false,

        syncFullHistory:
          false
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


        // CONNECTING
        if (
          connection === "connecting"
        ) {

          console.log(
            "🔄 Connecting to WhatsApp..."
          );
        }


        // CONNECTED
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
            "💲 AI requires $"
          );

          console.log(
            "📊 $quiz creates WhatsApp Poll"
          );

          console.log(
            "======================================"
          );

          console.log("");
        }


        // DISCONNECTED
        if (
          connection === "close"
        ) {

          let code = 0;

          try {

            if (
              lastDisconnect?.error instanceof Boom
            ) {

              code =
                lastDisconnect
                  .error
                  .output
                  .statusCode;
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


          // LOGGED OUT
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


          // RECONNECT
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

            // ==================================================
            // BASIC CHECK
            // ==================================================

            if (!msg)
              continue;

            if (!msg.message)
              continue;

            // لا يرد على نفسه
            if (msg.key.fromMe)
              continue;


            const jid =
              msg.key.remoteJid;


            if (!jid)
              continue;


            // ==================================================
            // GROUPS ONLY
            // ==================================================

            if (
              !jid.endsWith("@g.us")
            ) {

              continue;
            }


            // ==================================================
            // GET TEXT
            // ==================================================

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
              msg.message
                .ephemeralMessage
                ?.message
                ?.extendedTextMessage
                ?.text
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


            if (!question)
              continue;


            // ==================================================
            // LOG
            // ==================================================

            console.log("");
            console.log(
              "📩 GROUP MESSAGE:",
              question
            );


            // ==================================================
            // TEST
            // ==================================================

            if (
              question.toLowerCase()
              === "!test"
            ) {

              await sock.sendMessage(
                jid,
                {
                  text:
                    "🇩🇪🤖 German B1 Bot\n\n" +
                    "✅ البوت يعمل بشكل صحيح!\n" +
                    "🧠 Groq AI متصل.\n" +
                    "📊 Quiz متاح عبر:\n\n" +
                    "$quiz"
                }
              );

              continue;
            }


            // ==================================================
            // HELP
            // ==================================================

            if (
              question.toLowerCase()
              === "!help"
            ) {

              await sock.sendMessage(
                jid,
                {
                  text:
                    "🇩🇪🤖 German B1 AI Bot\n\n" +

                    "💬 سؤال للذكاء الاصطناعي:\n" +
                    "Was bedeutet gehen?$\n\n" +

                    "📊 اختبار A1:\n" +
                    "$quiz A1\n\n" +

                    "📊 اختبار A2:\n" +
                    "$quiz A2\n\n" +

                    "📊 اختبار B1:\n" +
                    "$quiz B1\n\n" +

                    "⚠️ أي رسالة لا تنتهي بـ $ لن يرد عليها البوت."
                }
              );

              continue;
            }


            // ==================================================
            // QUIZ
            // ==================================================

            const lowerQuestion =
              question.toLowerCase();


            const isQuiz =
              lowerQuestion === "$quiz" ||
              lowerQuestion === "$quiz a1" ||
              lowerQuestion === "$quiz a2" ||
              lowerQuestion === "$quiz b1";


            if (isQuiz) {

              let level = "A2";


              if (
                lowerQuestion === "$quiz a1"
              ) {

                level = "A1";
              }


              if (
                lowerQuestion === "$quiz a2"
              ) {

                level = "A2";
              }


              if (
                lowerQuestion === "$quiz b1"
              ) {

                level = "B1";
              }


              console.log(
                `📊 Quiz requested: ${level}`
              );


              // ----------------------------------------------
              // اطلاع المجموعة
              // ----------------------------------------------

              await sock.sendMessage(
                jid,
                {
                  text:
                    `🇩🇪🔥 German ${level} Challenge\n\n` +
                    "🧠 جاري إعداد السؤال..."
                }
              );


              // ----------------------------------------------
              // CREATE QUIZ
              // ----------------------------------------------

              const quiz =
                await createQuiz(
                  level
                );


              console.log(
                "📝 Question:",
                quiz.question
              );

              console.log(
                "🔢 Options:",
                quiz.options
              );

              console.log(
                "✅ Correct option:",
                quiz.correct
              );


              // ----------------------------------------------
              // SEND REAL WHATSAPP POLL
              // ----------------------------------------------

              await sock.sendMessage(
                jid,
                {
                  poll: {

                    name:
                      `🇩🇪 ${level} Challenge\n\n${quiz.question}`,

                    values:
                      quiz.options,

                    selectableCount:
                      1
                  }
                }
              );


              console.log(
                "✅ WhatsApp Poll sent!"
              );


              // ----------------------------------------------
              // SEND EXPLANATION
              // ----------------------------------------------

              await sock.sendMessage(
                jid,
                {
                  text:
                    "🗳️ صوتوا على الإجابة الصحيحة!\n\n" +
                    "💡 بعد التصويت يمكننا لاحقاً إضافة نظام النقاط والنتائج."
                }
              );


              // ----------------------------------------------
              // SAVE LAST QUIZ
              // ----------------------------------------------

              global.lastQuiz = {

                jid:
                  jid,

                question:
                  quiz.question,

                options:
                  quiz.options,

                correct:
                  quiz.correct,

                explanation:
                  quiz.explanation,

                level:
                  level,

                createdAt:
                  Date.now()

              };


              continue;
            }


            // ==================================================
            // AI ONLY WHEN MESSAGE ENDS WITH $
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
            // REMOVE $
            // ==================================================

            const aiQuestion =
              question
                .slice(0, -1)
                .trim();


            if (!aiQuestion)
              continue;


            // ==================================================
            // ASK AI
            // ==================================================

            console.log(
              "🤖 Sending to AI..."
            );


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
                    "❌ حدث خطأ أثناء معالجة الطلب.\n\n" +
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
  // START ERROR
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
