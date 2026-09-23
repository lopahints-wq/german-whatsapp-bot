const express = require("express");
const pino = require("pino");
const fs = require("fs");

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  Browsers,
  getAggregateVotesInPollMessage
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
// QUIZ DATA
// ==================================================

const DATA_FILE = "./german_quiz_users.json";

// المستخدمون والنقاط
let quizUsers = {};


// Polls الحالية
const quizPolls = new Map();


// التصويتات التي تم احتسابها
const answeredPolls = new Map();


// ==================================================
// LOAD QUIZ USERS
// ==================================================

try {

  if (fs.existsSync(DATA_FILE)) {

    quizUsers =
      JSON.parse(
        fs.readFileSync(
          DATA_FILE,
          "utf8"
        )
      );

    console.log(
      "✅ Quiz users loaded."
    );

  }

} catch (error) {

  console.log(
    "⚠️ Could not load quiz users:",
    error.message
  );

  quizUsers = {};
}


// ==================================================
// SAVE QUIZ USERS
// ==================================================

function saveQuizUsers() {

  try {

    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify(
        quizUsers,
        null,
        2
      )
    );

  } catch (error) {

    console.log(
      "❌ Could not save quiz users:",
      error.message
    );
  }
}


// ==================================================
// GET USER
// ==================================================

function getQuizUser(userJid) {

  if (!quizUsers[userJid]) {

    quizUsers[userJid] = {

      points: 0,

      correct: 0,

      wrong: 0,

      streak: 0,

      bestStreak: 0

    };
  }

  return quizUsers[userJid];
}


// ==================================================
// GET LEVEL
// ==================================================

function getLevel(points) {

  if (points >= 750) {
    return "🏆 C1";
  }

  if (points >= 500) {
    return "📕 B2";
  }

  if (points >= 300) {
    return "📙 B1";
  }

  if (points >= 150) {
    return "📘 A2";
  }

  if (points >= 50) {
    return "📗 A1";
  }

  return "🌱 A1 Beginner";
}


// ==================================================
// GROQ AI
// ==================================================

async function askAI(question) {

  const apiKey =
    process.env.GROQ_API_KEY;

  if (!apiKey) {

    throw new Error(
      "GROQ_API_KEY is missing in Render."
    );
  }


  console.log(
    "🧠 Sending message to Groq..."
  );

  console.log(
    "❓ Question:",
    question
  );


  const response =
    await fetch(
      "https://api.groq.com/openai/v1/responses",
      {

        method: "POST",

        headers: {

          "Content-Type":
            "application/json",

          "Authorization":
            `Bearer ${apiKey}`

        },

        body: JSON.stringify({

          model:
            "openai/gpt-oss-20b",

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

          input:
            question

        })
      }
    );


  const data =
    await response.json();


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
      JSON.stringify(
        data,
        null,
        2
      )
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
    typeof data.output_text ===
    "string"
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
        Array.isArray(
          item.content
        )
      ) {

        for (
          const content of
          item.content
        ) {

          if (
            content?.type ===
              "output_text" &&
            typeof content.text ===
              "string"
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
      JSON.stringify(
        data,
        null,
        2
      )
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
// CREATE QUIZ WITH GROQ
// ==================================================

async function createQuiz() {

  const apiKey =
    process.env.GROQ_API_KEY;


  if (!apiKey) {

    throw new Error(
      "GROQ_API_KEY is missing."
    );
  }


  console.log(
    "📝 Creating German quiz..."
  );


  const response =
    await fetch(
      "https://api.groq.com/openai/v1/responses",
      {

        method: "POST",

        headers: {

          "Content-Type":
            "application/json",

          "Authorization":
            `Bearer ${apiKey}`

        },

        body: JSON.stringify({

          model:
            "openai/gpt-oss-20b",

          instructions: `
أنت مدرس لغة ألمانية.

أنشئ سؤال اختيار من متعدد في اللغة الألمانية.

استخدم مستوى A1 أو A2 أو B1.

أرجع JSON فقط بدون أي نص إضافي.

الصيغة:

{
  "level": "A2",
  "question": "Welche Antwort ist richtig?",
  "options": [
    "Ich bin gestern nach Berlin gefahren.",
    "Ich habe gestern nach Berlin gefahren.",
    "Ich bin gestern nach Berlin fahren.",
    "Ich habe gestern nach Berlin fahren."
  ],
  "correct": 0,
  "explanation": "Mit fahren verwenden wir hier sein: Ich bin gefahren."
}

القواعد:

- options يجب أن تحتوي 4 خيارات بالضبط.
- correct رقم من 0 إلى 3.
- سؤال واحد فقط.
- اجعل السؤال مناسباً لمتعلمي الألمانية.
- لا تجعل الإجابة الصحيحة دائماً في نفس المكان.
- لا تستخدم علامات Markdown.
- أرجع JSON فقط.
`,

          input:
            "Erstelle einen neuen Deutsch-Test."

        })
      }
    );


  const data =
    await response.json();


  if (!response.ok) {

    console.log(
      "❌ QUIZ GROQ ERROR:",
      JSON.stringify(
        data,
        null,
        2
      )
    );

    throw new Error(
      data?.error?.message ||
      "Quiz AI request failed."
    );
  }


  let answer =
    data.output_text?.trim() ||
    "";


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
        Array.isArray(
          item.content
        )
      ) {

        for (
          const content of
          item.content
        ) {

          if (
            content?.type ===
            "output_text"
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

    throw new Error(
      "Quiz AI returned empty answer."
    );
  }


  // ==================================================
  // CLEAN JSON
  // ==================================================

  answer =
    answer
      .replace(
        /^```json/i,
        ""
      )
      .replace(
        /^```/i,
        ""
      )
      .replace(
        /```$/i,
        ""
      )
      .trim();


  let quiz;


  try {

    quiz =
      JSON.parse(answer);

  } catch (error) {

    console.log(
      "❌ Invalid quiz JSON:",
      answer
    );

    throw new Error(
      "Groq returned invalid quiz JSON."
    );
  }


  // ==================================================
  // VALIDATE QUIZ
  // ==================================================

  if (
    !quiz.question ||
    !Array.isArray(
      quiz.options
    ) ||
    quiz.options.length !== 4 ||
    typeof quiz.correct !==
      "number" ||
    quiz.correct < 0 ||
    quiz.correct > 3
  ) {

    throw new Error(
      "Invalid quiz format."
    );
  }


  return quiz;
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
    } =
      await useMultiFileAuthState(
        "./auth_info"
      );


    // ==================================================
    // WHATSAPP CONNECTION
    // ==================================================

    const sock =
      makeWASocket({

        auth:
          state,

        logger:
          pino({
            level:
              "silent"
          }),

        browser:
          Browsers.macOS(
            "Chrome"
          ),

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


        // ----------------------------------------------
        // CONNECTING
        // ----------------------------------------------

        if (
          connection ===
          "connecting"
        ) {

          console.log(
            "🔄 Connecting to WhatsApp..."
          );
        }


        // ----------------------------------------------
        // CONNECTED
        // ----------------------------------------------

        if (
          connection ===
          "open"
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
            "📝 !quiz = German Quiz"
          );

          console.log(
            "👤 !me = Your Profile"
          );

          console.log(
            "🏆 !ranking = Ranking"
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
          connection ===
          "close"
        ) {

          let code = 0;


          try {

            if (
              lastDisconnect?.error
                instanceof Boom
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


          // --------------------------------------------
          // LOGGED OUT
          // --------------------------------------------

          if (
            code ===
            DisconnectReason.loggedOut
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

            if (!msg) {
              continue;
            }

            if (!msg.message) {
              continue;
            }

            // لا يرد على رسائله الخاصة
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
            // GET MESSAGE TEXT
            // ------------------------------------------

            let text = "";


            if (
              msg.message
                .conversation
            ) {

              text =
                msg.message
                  .conversation;

            }


            else if (
              msg.message
                .extendedTextMessage
                ?.text
            ) {

              text =
                msg.message
                  .extendedTextMessage
                  .text;

            }


            else if (
              msg.message
                .ephemeralMessage
                ?.message
                ?.conversation
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
              question.toLowerCase() ===
              "!test"
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
            // ==================================================

            if (
              question.toLowerCase() ===
              "!help"
            ) {

              await sock.sendMessage(
                jid,
                {

                  text:
                    "🇩🇪🤖 German B1 AI Bot\n\n" +

                    "📚 الأوامر:\n\n" +

                    "!quiz\n" +
                    "إنشاء تمرين ألماني مع Poll.\n\n" +

                    "!me\n" +
                    "عرض نقاطك ومستواك.\n\n" +

                    "!ranking\n" +
                    "عرض ترتيب أعضاء المجموعة.\n\n" +

                    "!test\n" +
                    "اختبار تشغيل البوت.\n\n" +

                    "💲 AI:\n" +
                    "اكتب سؤالك وأنهِ الرسالة بعلامة $.\n\n" +

                    "مثال:\n" +
                    "ما معنى gehen؟$"

                }
              );


              continue;
            }


            // ==================================================
            // QUIZ
            // ==================================================

            if (
              question.toLowerCase() ===
              "!quiz"
            ) {

              try {

                const quiz =
                  await createQuiz();


                const pollValues =
                  quiz.options.map(
                    (option, index) =>
                      `${String.fromCharCode(65 + index)}️⃣ ${option}`
                  );


                // ------------------------------------------
                // SEND POLL
                // ------------------------------------------

                const sent =
                  await sock.sendMessage(
                    jid,
                    {

                      poll: {

                        name:
                          `🇩🇪 Deutsch Quiz ${quiz.level ? `- ${quiz.level}` : ""}\n\n${quiz.question}`,

                        values:
                          pollValues,

                        selectableCount:
                          1

                      }

                    }
                  );


                // ------------------------------------------
                // SAVE ORIGINAL POLL MESSAGE
                // ------------------------------------------

                if (
                  sent?.key?.id
                ) {

                  quizPolls.set(
                    sent.key.id,
                    {

                      jid:
                        jid,

                      message:
                        sent,

                      question:
                        quiz.question,

                      options:
                        pollValues,

                      correct:
                        quiz.correct,

                      explanation:
                        quiz.explanation ||
                        "",

                      level:
                        quiz.level ||
                        "A2",

                      createdAt:
                        Date.now()

                    }
                  );


                  console.log(
                    "✅ Quiz poll saved:",
                    sent.key.id
                  );

                }

              } catch (error) {

                console.log(
                  "❌ Quiz error:",
                  error.message
                );


                await sock.sendMessage(
                  jid,
                  {

                    text:
                      "❌ لم أستطع إنشاء التمرين الآن.\n\nحاول مرة أخرى."

                  }
                );
              }


              continue;
            }


            // ==================================================
            // USER PROFILE
            // ==================================================

            if (
              question.toLowerCase() ===
              "!me"
            ) {

              const userJid =
                msg.key.participant ||
                msg.key.remoteJid;


              const user =
                getQuizUser(
                  userJid
                );


              await sock.sendMessage(
                jid,
                {

                  text:

                    "🇩🇪 *DEIN DEUTSCH PROFIL*\n\n" +

                    `⭐ Punkte: ${user.points}\n` +

                    `📚 Level: ${getLevel(user.points)}\n` +

                    `✅ Richtig: ${user.correct}\n` +

                    `❌ Falsch: ${user.wrong}\n` +

                    `🔥 Streak: ${user.streak}\n` +

                    `🏆 Best Streak: ${user.bestStreak}`

                }
              );


              continue;
            }


            // ==================================================
            // RANKING
            // ==================================================

            if (
              question.toLowerCase() ===
              "!ranking"
            ) {

              const ranking =
                Object.entries(
                  quizUsers
                )
                  .sort(
                    (a, b) =>
                      b[1].points -
                      a[1].points
                  )
                  .slice(
                    0,
                    10
                  );


              if (
                !ranking.length
              ) {

                await sock.sendMessage(
                  jid,
                  {

                    text:
                      "🏆 لا توجد نتائج حتى الآن.\n\nابدأ بـ !quiz"

                  }
                );

                continue;
              }


              let rankingText =
                "🏆 *GERMAN QUIZ RANKING*\n\n";


              ranking.forEach(
                ([userJid, user], index) => {

                  const medals = [
                    "🥇",
                    "🥈",
                    "🥉"
                  ];


                  const medal =
                    medals[index] ||
                    `${index + 1}.`;


                  rankingText +=
                    `${medal} ${userJid.split("@")[0]}\n` +
                    `   ⭐ ${user.points} Punkte — ${getLevel(user.points)}\n\n`;

                }
              );


              await sock.sendMessage(
                jid,
                {
                  text:
                    rankingText
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
            // REMOVE $
            // ==================================================

            const aiQuestion =
              question
                .slice(
                  0,
                  -1
                )
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


    // ==================================================
    // POLL ANSWERS
    // ==================================================

    sock.ev.on(
      "messages.update",
      async (updates) => {

        for (
          const item of updates
        ) {

          try {

            const key =
              item.key;

            const update =
              item.update;


            if (!key?.id) {
              continue;
            }


            if (
              !update?.pollUpdates
            ) {

              continue;
            }


            const pollId =
              key.id;


            const quiz =
              quizPolls.get(
                pollId
              );


            if (!quiz) {

              continue;
            }


            console.log(
              "🗳️ Poll vote received:",
              pollId
            );


            // ==================================================
            // GET AGGREGATED VOTES
            // ==================================================

            const results =
              getAggregateVotesInPollMessage(
                {

                  message:
                    quiz.message.message,

                  pollUpdates:
                    update.pollUpdates

                }
              );


            if (!results) {
              continue;
            }


            // ==================================================
            // PROCESS RESULTS
            // ==================================================

            for (
              const result of results
            ) {

              if (
                !result?.voters ||
                !result.voters.length
              ) {

                continue;
              }


              const selectedOption =
                result.name;


              const selectedIndex =
                quiz.options.indexOf(
                  selectedOption
                );


              if (
                selectedIndex ===
                -1
              ) {

                continue;
              }


              // --------------------------------------------
              // EVERY VOTER
              // --------------------------------------------

              for (
                const voter of
                result.voters
              ) {

                const answerKey =
                  `${pollId}_${voter}`;


                // منع التكرار
                if (
                  answeredPolls.has(
                    answerKey
                  )
                ) {

                  continue;
                }


                answeredPolls.set(
                  answerKey,
                  true
                );


                const user =
                  getQuizUser(
                    voter
                  );


                // ==================================================
                // CORRECT ANSWER
                // ==================================================

                if (
                  selectedIndex ===
                  quiz.correct
                ) {

                  user.correct +=
                    1;


                  user.streak +=
                    1;


                  let points =
                    10;


                  // Streak bonus
                  if (
                    user.streak >= 3
                  ) {

                    points +=
                      2;
                  }


                  if (
                    user.streak >= 5
                  ) {

                    points +=
                      3;
                  }


                  if (
                    user.streak >= 10
                  ) {

                    points +=
                      5;
                  }


                  user.points +=
                    points;


                  if (
                    user.streak >
                    user.bestStreak
                  ) {

                    user.bestStreak =
                      user.streak;
                  }


                  saveQuizUsers();


                  await sock.sendMessage(
                    quiz.jid,
                    {

                      text:

                        "✅ *Richtig!*\n\n" +

                        `🎉 +${points} Punkte\n` +

                        `⭐ مجموعك: ${user.points}\n` +

                        `📚 Level: ${getLevel(user.points)}\n` +

                        `🔥 Streak: ${user.streak}`

                    }
                  );


                  console.log(
                    `✅ ${voter} +${points} points`
                  );

                }


                // ==================================================
                // WRONG ANSWER
                // ==================================================

                else {

                  user.wrong +=
                    1;


                  user.streak =
                    0;


                  saveQuizUsers();


                  const correctLetter =
                    String.fromCharCode(
                      65 +
                      quiz.correct
                    );


                  await sock.sendMessage(
                    quiz.jid,
                    {

                      text:

                        "❌ *Leider falsch!*\n\n" +

                        `✅ الإجابة الصحيحة: ${correctLetter}️⃣ ${quiz.options[quiz.correct]}\n\n` +

                        `💡 ${quiz.explanation || ""}\n\n` +

                        `⭐ مجموعك: ${user.points}\n` +

                        `📚 Level: ${getLevel(user.points)}`

                    }
                  );


                  console.log(
                    `❌ ${voter} wrong answer`
                  );

                }

              }

            }

          } catch (error) {

            console.log(
              "❌ Poll processing error:",
              error.message
            );

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
