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
// GROQ - NORMAL AI
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

مهمتك مساعدة الأعضاء على تعلم الألمانية من A1 إلى B1.

إذا كانت الجملة ألمانية:
صححها واشرح الخطأ بالعربية باختصار.

إذا كانت كلمة ألمانية:
اشرح معناها بالعربية وأعط مثالاً بالألمانية مع الترجمة.

إذا كان المستخدم يريد ترجمة:
أعطه ترجمة ألمانية طبيعية.

إذا سأل عن قاعدة:
اشرحها ببساطة مع أمثلة.

إذا طلب تمريناً:
أنشئ تمريناً مناسباً.

استخدم العربية للشرح والألمانية للأمثلة.

اجعل الإجابة قصيرة ومناسبة لـ WhatsApp.
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


  if (
    typeof data.output_text === "string"
  ) {

    answer =
      data.output_text.trim();
  }


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

      if (answer) break;
    }
  }


  if (!answer) {

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
// GROQ - CREATE QUIZ
// ==================================================

async function createQuiz(level = "A2") {

  const apiKey =
    process.env.GROQ_API_KEY;

  if (!apiKey) {
    throw new Error(
      "GROQ_API_KEY is missing in Render."
    );
  }


  console.log(
    `🧠 Creating ${level} German quiz...`
  );


  const response = await fetch(
    "https://api.groq.com/openai/v1/responses",
    {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },

      body: JSON.stringify({

        model:
          "openai/gpt-oss-20b",

        instructions: `
أنت خبير في تعليم اللغة الألمانية.

أنشئ سؤال Quiz واحد فقط لمتعلمي اللغة الألمانية.

المستوى:
${level}

يجب أن يكون السؤال مناسباً للمستوى.

القواعد المهمة جداً:

- السؤال باللغة الألمانية.
- أنشئ 4 خيارات فقط.
- يوجد خيار صحيح واحد فقط.
- الخيارات باللغة الألمانية.
- لا تجعل الخيارات متشابهة بشكل مربك.
- لا تستخدم ترقيم A/B/C داخل الخيارات.
- أرسل JSON فقط.
- لا تضف Markdown.
- لا تضف أي شرح خارج JSON.

الشكل المطلوب بالضبط:

{
  "question": "السؤال هنا",
  "options": [
    "الخيار الأول",
    "الخيار الثاني",
    "الخيار الثالث",
    "الخيار الرابع"
  ],
  "correct": 0,
  "explanation": "شرح قصير بالعربية يوضح لماذا الإجابة صحيحة."
}

مهم:
correct هو رقم الخيار الصحيح ويبدأ من 0.

مثال:
إذا كانت الإجابة الصحيحة هي الخيار الأول:
"correct": 0

إذا كانت الثانية:
"correct": 1

إذا كانت الثالثة:
"correct": 2

إذا كانت الرابعة:
"correct": 3
`,

        input:
          `أنشئ اختباراً جديداً لمستوى ${level}.`

      })
    }
  );


  const data =
    await response.json();


  console.log(
    "📦 Quiz API status:",
    response.status
  );


  if (!response.ok) {

    console.log(
      "❌ QUIZ ERROR:",
      JSON.stringify(
        data,
        null,
        2
      )
    );

    throw new Error(
      data?.error?.message ||
      "Quiz creation failed."
    );
  }


  let text = "";


  if (
    typeof data.output_text === "string"
  ) {

    text =
      data.output_text.trim();
  }


  if (
    !text &&
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

            text =
              content.text.trim();

            break;
          }
        }
      }

      if (text) break;
    }
  }


  if (!text) {

    throw new Error(
      "AI returned empty quiz."
    );
  }


  console.log(
    "🧠 RAW QUIZ:",
    text
  );


  // ==================================================
  // CLEAN JSON
  // ==================================================

  text =
    text
      .replace(/^```json/i, "")
      .replace(/^```/i, "")
      .replace(/```$/i, "")
      .trim();


  let quiz;


  try {

    quiz =
      JSON.parse(text);

  } catch (error) {

    console.log(
      "❌ JSON PARSE ERROR:",
      text
    );

    throw new Error(
      "AI returned invalid quiz JSON."
    );
  }


  // ==================================================
  // VALIDATE QUIZ
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
// START BOT
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
    // WHATSAPP
    // ==================================================

    const sock =
      makeWASocket({

        auth: state,

        logger: pino({
          level: "silent"
        }),

        browser:
          Browsers.macOS("Chrome"),

        markOnlineOnConnect:
          false,

        syncFullHistory:
          false
      });


    // ==================================================
    // SAVE CREDS
    // ==================================================

    sock.ev.on(
      "creds.update",
      saveCreds
    );


    // ==================================================
    // CONNECTION
    // ==================================================

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
            "======================================"
          );

          console.log(
            "✅ WHATSAPP CONNECTED!"
          );

          console.log(
            "🤖 GERMAN AI BOT IS READY!"
          );

          console.log(
            "💲 AI questions require $"
          );

          console.log(
            "📊 $quiz creates WhatsApp Poll"
          );

          console.log(
            "======================================"
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


          if (
            code ===
            DisconnectReason.loggedOut
          ) {

            console.log(
              "⚠️ WhatsApp logged out."
            );

            console.log(
              "⚠️ Pair WhatsApp again."
            );

            return;
          }


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
          "❌ WHATSAPP_NUMBER is missing."
        );

        return;
      }


      const cleanNumber =
        phoneNumber.replace(
          /\D/g,
          ""
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
    // MESSAGES
    // ==================================================

    sock.ev.on(
      "messages.upsert",
      async ({
        messages
      }) => {

        for (
          const msg of messages
        ) {

          try {

            if (!msg) continue;

            if (!msg.message)
              continue;


            // لا يرد على نفسه
            if (
              msg.key.fromMe
            )
              continue;


            const jid =
              msg.key.remoteJid;


            if (!jid)
              continue;


            // GROUPS ONLY
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


            if (!question)
              continue;


            console.log("");
            console.log(
              "📩 GROUP MESSAGE:",
              question
            );


            // ==================================================
            // !TEST
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
                    "✅ البوت يعمل!\n" +
                    "🧠 Groq متصل.\n" +
                    "📊 Poll Quiz متاح عبر:\n\n" +
                    "$quiz"
                }
              );

              continue;
            }


            // ==================================================
            // !HELP
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

                    "📚 سؤال للـAI:\n" +
                    "ما معنى gehen؟$\n\n" +

                    "📊 إنشاء Quiz:\n" +
                    "$quiz\n\n" +

                    "📊 Quiz بمستوى A1:\n" +
                    "$quiz A1\n\n" +

                    "📊 Quiz بمستوى A2:\n" +
                    "$quiz A2\n\n" +

                    "📊 Quiz بمستوى B1:\n" +
                    "$quiz B1"
                }
              );

              continue;
            }


            // ==================================================
            // QUIZ
            // ==================================================

            const lower =
              question.toLowerCase();


            if (
              lower === "$quiz" ||
              lower === "$quiz a1" ||
              lower === "$quiz a2" ||
              lower === "$quiz b1"
            ) {

              let level =
                "A2";


              if (
                lower === "$quiz a1"
              ) {

                level = "A1";
              }


              if (
                lower === "$quiz a2"
              ) {

                level = "A2";
              }


              if (
                lower === "$quiz b1"
              ) {

                level = "B1";
              }


              console.log(
                `📊 Creating ${level} quiz...`
              );


              // ------------------------------------------
              // اطلاع المجموعة
              // ------------------------------------------

              await sock.sendMessage(
                jid,
                {
                  text:
                    `🇩🇪🔥 German Challenge\n\n` +
                    `🧠 جاري إنشاء سؤال ${level}...\n` +
                    `استعدوا!`
                }
              );


              // ------------------------------------------
              // CREATE QUIZ
              // ------------------------------------------

              const quiz =
                await createQuiz(
                  level
                );


              console.log(
                "📝 Quiz:",
                quiz.question
              );

              console.log(
                "🔢 Options:",
                quiz.options
              );

              console.log(
                "✅ Correct:",
                quiz.correct
              );


              // ------------------------------------------
              // SEND REAL WHATSAPP POLL
              // ------------------------------------------

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
                "📊 WhatsApp Poll sent!"
              );


              // ------------------------------------------
              // SEND EXPLANATION
              // ------------------------------------------

              await sock.sendMessage(
                jid,
                {
                  text:
                    "💡 سيتم شرح الإجابة الصحيحة بعد انتهاء التصويت.\n\n" +
                    "🤫 لا تكتبوا الإجابة في المجموعة قبل التصويت!"
                }
              );


              // ------------------------------------------
              // LOG CORRECT ANSWER
              // ------------------------------------------

              console.log(
                "🔐 Correct answer:",
                quiz.options[
                  quiz.correct
                ]
              );


              // ------------------------------------------
              // SAVE QUIZ TEMPORARILY
              // ------------------------------------------

              global.lastQuiz = {

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

                jid:
                  jid,

                createdAt:
                  Date.now()

              };


              continue;
            }


            // ==================================================
            // AI QUESTION
            // ONLY WHEN ENDS WITH $
            // ==================================================

            if (
              !question.endsWith("$")
            ) {

              console.log(
                "⏭️ Message ignored - no $"
              );

              continue;
            }


            const aiQuestion =
              question
                .slice(0, -1)
                .trim();


            if (!aiQuestion)
              continue;


            console.log(
              "🤖 Sending to AI..."
            );


            const answer =
              await askAI(
                aiQuestion
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

          }


          // ==================================================
          // ERROR
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
// START
// ==================================================

startBot();
