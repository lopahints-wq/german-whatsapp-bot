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
// QUIZ / POINTS SYSTEM
// ==================================================

// النقاط محفوظة في الذاكرة فقط.
// لا علاقة لها باتصال WhatsApp.

const scores = {};


// السؤال الحالي لكل عضو في كل مجموعة
const activeQuizzes = {};


// ==================================================
// GET USER ID
// ==================================================

function getUserId(msg) {

  return (
    msg.key.participant ||
    msg.key.remoteJid
  );

}


// ==================================================
// GET USER NAME
// ==================================================

function getUserName(msg) {

  return (
    msg.pushName ||
    "عضو"
  );

}


// ==================================================
// GET LEVEL
// ==================================================

function getLevel(points) {

  if (points >= 600) {
    return "B1+ 🔥";
  }

  if (points >= 300) {
    return "B1 🟣";
  }

  if (points >= 100) {
    return "A2 🔵";
  }

  return "A1 🟢";

}


// ==================================================
// GET USER SCORE
// ==================================================

function getScore(userId) {

  if (!scores[userId]) {

    scores[userId] = {
      points: 0,
      correct: 0,
      wrong: 0,
      exercises: 0
    };

  }

  return scores[userId];

}


// ==================================================
// QUIZ QUESTIONS
// ==================================================

const quizQuestions = [

  {
    question: "ما معنى كلمة **laufen**؟",
    options: [
      "1️⃣ يأكل",
      "2️⃣ يجري / يمشي",
      "3️⃣ ينام",
      "4️⃣ يكتب"
    ],
    answer: 2,
    level: "A1"
  },

  {
    question: "اختر الجملة الصحيحة:",
    options: [
      "1️⃣ Ich bin gestern nach Berlin gefahren.",
      "2️⃣ Ich habe gestern nach Berlin gefahren.",
      "3️⃣ Ich gestern bin nach Berlin gefahren.",
      "4️⃣ Ich fahren gestern nach Berlin."
    ],
    answer: 1,
    level: "A2"
  },

  {
    question: "ما هو Artikel لكلمة **Tisch**؟",
    options: [
      "1️⃣ die",
      "2️⃣ das",
      "3️⃣ der",
      "4️⃣ den"
    ],
    answer: 3,
    level: "A1"
  },

  {
    question: "اختر التصريف الصحيح:",
    options: [
      "1️⃣ Er gehen zur Schule.",
      "2️⃣ Er geht zur Schule.",
      "3️⃣ Er gehst zur Schule.",
      "4️⃣ Er gegangen zur Schule."
    ],
    answer: 2,
    level: "A1"
  },

  {
    question: "ما هو Perfekt للجملة: **Ich esse Pizza**؟",
    options: [
      "1️⃣ Ich habe Pizza gegessen.",
      "2️⃣ Ich bin Pizza gegessen.",
      "3️⃣ Ich habe Pizza essen.",
      "4️⃣ Ich gegessen Pizza."
    ],
    answer: 1,
    level: "A2"
  },

  {
    question: "اختر الجملة الصحيحة:",
    options: [
      "1️⃣ Weil ich bin müde.",
      "2️⃣ Weil ich müde bin.",
      "3️⃣ Weil bin ich müde.",
      "4️⃣ Weil müde ich bin."
    ],
    answer: 2,
    level: "B1"
  },

  {
    question: "ما معنى **obwohl**؟",
    options: [
      "1️⃣ لأن",
      "2️⃣ إذا",
      "3️⃣ رغم أن / بالرغم من أن",
      "4️⃣ قبل أن"
    ],
    answer: 3,
    level: "B1"
  },

  {
    question: "اختر الجملة الصحيحة:",
    options: [
      "1️⃣ Wenn ich Zeit habe, gehe ich ins Kino.",
      "2️⃣ Wenn ich habe Zeit, gehe ich ins Kino.",
      "3️⃣ Wenn ich Zeit habe, ich gehe ins Kino.",
      "4️⃣ Wenn Zeit ich habe, gehe ins Kino ich."
    ],
    answer: 1,
    level: "B1"
  }

];


// ==================================================
// EXERCISES
// ==================================================

const exercises = [

  {
    question:
      "🇩🇪 أكمل الجملة:\n\n" +
      "Ich ___ jeden Morgen Kaffee.\n\n" +
      "1️⃣ trinke\n" +
      "2️⃣ trinkt\n" +
      "3️⃣ trinken\n" +
      "4️⃣ getrunken",

    answer: 1
  },

  {
    question:
      "🇩🇪 اختر الإجابة الصحيحة:\n\n" +
      "Gestern ___ ich Fußball gespielt.\n\n" +
      "1️⃣ bin\n" +
      "2️⃣ habe\n" +
      "3️⃣ ist\n" +
      "4️⃣ hat",

    answer: 2
  },

  {
    question:
      "🇩🇪 اختر الإجابة الصحيحة:\n\n" +
      "Ich gehe ___ Supermarkt.\n\n" +
      "1️⃣ im\n" +
      "2️⃣ in den\n" +
      "3️⃣ auf der\n" +
      "4️⃣ mit dem",

    answer: 2
  },

  {
    question:
      "🇩🇪 اختر الإجابة الصحيحة:\n\n" +
      "Er kann sehr gut Deutsch ___.\n\n" +
      "1️⃣ sprechen\n" +
      "2️⃣ spricht\n" +
      "3️⃣ gesprochen\n" +
      "4️⃣ sprichst",

    answer: 1
  }

];


// ==================================================
// START QUIZ
// ==================================================

async function startQuiz(sock, jid, msg) {

  const userId = getUserId(msg);

  const userName = getUserName(msg);

  const randomIndex =
    Math.floor(
      Math.random() *
      quizQuestions.length
    );

  const quiz =
    quizQuestions[randomIndex];


  if (!activeQuizzes[jid]) {
    activeQuizzes[jid] = {};
  }


  activeQuizzes[jid][userId] = {

    answer: quiz.answer,

    level: quiz.level,

    type: "quiz"

  };


  await sock.sendMessage(
    jid,
    {
      text:
        "🎯🇩🇪 *German Quiz*\n\n" +

        `👤 ${userName}\n` +

        `📚 المستوى: ${quiz.level}\n\n` +

        quiz.question +

        "\n\n" +

        quiz.options.join("\n") +

        "\n\n" +

        "💡 أرسل رقم الإجابة فقط\n" +

        "مثال: `2`"

    }
  );

}


// ==================================================
// START EXERCISE
// ==================================================

async function startExercise(sock, jid, msg) {

  const userId = getUserId(msg);

  const randomIndex =
    Math.floor(
      Math.random() *
      exercises.length
    );

  const exercise =
    exercises[randomIndex];


  if (!activeQuizzes[jid]) {
    activeQuizzes[jid] = {};
  }


  activeQuizzes[jid][userId] = {

    answer: exercise.answer,

    type: "exercise"

  };


  await sock.sendMessage(
    jid,
    {
      text:
        "📝🇩🇪 *German Exercise*\n\n" +

        exercise.question +

        "\n\n" +

        "💡 أرسل رقم الإجابة فقط."

    }
  );

}


// ==================================================
// HANDLE QUIZ ANSWER
// ==================================================

async function handleQuizAnswer(
  sock,
  jid,
  msg,
  text
) {

  const userId =
    getUserId(msg);


  if (
    !activeQuizzes[jid] ||
    !activeQuizzes[jid][userId]
  ) {

    return false;

  }


  const quiz =
    activeQuizzes[jid][userId];


  // يجب أن يكون رقمًا
  if (!/^[1-4]$/.test(text)) {

    return false;

  }


  const selected =
    Number(text);


  const score =
    getScore(userId);


  // ------------------------------------------
  // CORRECT
  // ------------------------------------------

  if (
    selected === quiz.answer
  ) {

    score.points += 10;

    score.correct += 1;


    const level =
      getLevel(score.points);


    await sock.sendMessage(
      jid,
      {
        text:
          "✅ *إجابة صحيحة!* 🎉\n\n" +

          "⭐ +10 نقاط\n\n" +

          `⭐ نقاطك: ${score.points} XP\n` +

          `🎯 مستواك: ${level}\n\n` +

          "👏 أحسنت! استمر."

      }
    );

  }


  // ------------------------------------------
  // WRONG
  // ------------------------------------------

  else {

    score.wrong += 1;


    await sock.sendMessage(
      jid,
      {
        text:
          "❌ *إجابة خاطئة*\n\n" +

          `الإجابة الصحيحة: ${quiz.answer}️⃣\n\n` +

          `⭐ نقاطك: ${score.points} XP\n` +

          `🎯 مستواك: ${getLevel(score.points)}\n\n` +

          "💪 حاول مرة أخرى!"

      }
    );

  }


  delete activeQuizzes[jid][userId];


  return true;

}


// ==================================================
// POINTS MESSAGE
// ==================================================

async function sendPoints(sock, jid, msg) {

  const userId =
    getUserId(msg);

  const score =
    getScore(userId);

  const name =
    getUserName(msg);

  await sock.sendMessage(
    jid,
    {
      text:
        "⭐ *نقاطك في German B1 Bot*\n\n" +

        `👤 ${name}\n\n` +

        `⭐ XP: ${score.points}\n` +

        `🎯 المستوى: ${getLevel(score.points)}\n\n` +

        `✅ إجابات صحيحة: ${score.correct}\n` +

        `❌ إجابات خاطئة: ${score.wrong}\n\n` +

        `📝 التمارين: ${score.exercises}`

    }
  );

}


// ==================================================
// RANKING
// ==================================================

async function sendRanking(sock, jid) {

  const users =
    Object.entries(scores);


  if (!users.length) {

    await sock.sendMessage(
      jid,
      {
        text:
          "🏆 لا توجد نقاط بعد.\n\n" +
          "ابدأ بـ !quiz"
      }
    );

    return;

  }


  users.sort(
    (a, b) =>
      b[1].points -
      a[1].points
  );


  const top =
    users.slice(0, 10);


  let message =
    "🏆🇩🇪 *German B1 Ranking*\n\n";


  top.forEach(
    ([userId, score], index) => {

      const medal =
        index === 0
          ? "🥇"
          : index === 1
          ? "🥈"
          : index === 2
          ? "🥉"
          : `${index + 1}️⃣`;


      message +=
        `${medal} ${userId.split("@")[0]}\n` +
        `⭐ ${score.points} XP — ${getLevel(score.points)}\n\n`;

    }
  );


  await sock.sendMessage(
    jid,
    {
      text: message
    }
  );

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
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
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

          input: question

        })
      }
    );


  const data =
    await response.json();


  console.log(
    "📦 Groq response status:",
    response.status
  );


  // ----------------------------------------------
  // GROQ ERROR
  // ----------------------------------------------

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


  // ----------------------------------------------
  // GET ANSWER
  // ----------------------------------------------

  let answer = "";


  if (
    typeof data.output_text === "string"
  ) {

    answer =
      data.output_text.trim();

  }


  // ----------------------------------------------
  // FALLBACK
  // ----------------------------------------------

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


  // ----------------------------------------------
  // NO ANSWER
  // ----------------------------------------------

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
// WHATSAPP
// ==================================================

async function startBot() {

  try {

    console.log(
      "🚀 Starting German B1 WhatsApp Bot..."
    );


    // ----------------------------------------------
    // AUTH
    // ----------------------------------------------

    const {
      state,
      saveCreds
    } =
      await useMultiFileAuthState(
        "./auth_info"
      );


    // ----------------------------------------------
    // CREATE WHATSAPP CONNECTION
    // ----------------------------------------------

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


    // ----------------------------------------------
    // SAVE CREDENTIALS
    // ----------------------------------------------

    sock.ev.on(
      "creds.update",
      saveCreds
    );


    // ----------------------------------------------
    // CONNECTION UPDATE
    // ----------------------------------------------

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
            "🎯 QUIZ SYSTEM IS READY!"
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

            // ------------------------------------------
            // BASIC CHECK
            // ------------------------------------------

            if (!msg) continue;

            if (!msg.message) continue;


            // لا يرد على رسائله الخاصة

            if (
              msg.key.fromMe
            ) continue;


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


            if (!question) continue;


            // ------------------------------------------
            // LOG
            // ------------------------------------------

            console.log("");

            console.log(
              "📩 GROUP MESSAGE:",
              question
            );


            // ==================================================
            // CHECK ACTIVE QUIZ ANSWER
            // ==================================================

            if (
              /^[1-4]$/.test(question)
            ) {

              const handled =
                await handleQuizAnswer(
                  sock,
                  jid,
                  msg,
                  question
                );


              if (handled) {

                continue;

              }

            }


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

                    "🎯 نظام المسابقات يعمل.\n\n" +

                    "اكتب !quiz للبدء."

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
                    "🇩🇪🤖 *German B1 AI Bot*\n\n" +

                    "🎯 *أوامر التعلم:*\n\n" +

                    "🎯 !quiz\n" +
                    "ابدأ سؤالًا واحصل على نقاط.\n\n" +

                    "📝 !exercise\n" +
                    "ابدأ تمرينًا.\n\n" +

                    "⭐ !points\n" +
                    "شاهد نقاطك ومستواك.\n\n" +

                    "🏆 !ranking\n" +
                    "شاهد ترتيب الأعضاء.\n\n" +

                    "💡 ويمكنك أيضًا طرح أي سؤال للألمانية مباشرة."

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

              await startQuiz(
                sock,
                jid,
                msg
              );


              continue;

            }


            // ==================================================
            // EXERCISE
            // ==================================================

            if (
              question.toLowerCase() ===
              "!exercise"
            ) {

              await startExercise(
                sock,
                jid,
                msg
              );


              continue;

            }


            // ==================================================
            // POINTS
            // ==================================================

            if (
              question.toLowerCase() ===
              "!points"
            ) {

              await sendPoints(
                sock,
                jid,
                msg
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

              await sendRanking(
                sock,
                jid
              );


              continue;

            }


            // ==================================================
            // SEND TO AI
            // ==================================================

            console.log(
              "🤖 Sending to AI..."
            );


            // ------------------------------------------
            // ASK AI
            // ------------------------------------------

            const answer =
              await askAI(
                question
              );


            // ------------------------------------------
            // SEND ANSWER
            // ------------------------------------------

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
