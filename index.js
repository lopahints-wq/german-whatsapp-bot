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
// POINTS SYSTEM
// ==================================================

const scores = {};


// ==================================================
// ACTIVE QUESTIONS
// ==================================================

const activeQuestions = {};


// ==================================================
// GROUPS
// ==================================================

let botGroups = [];


// ==================================================
// AUTO EXERCISE TIMER
// ==================================================

let exerciseTimer = null;


// ==================================================
// USER ID
// ==================================================

function getUserId(msg) {

  return (
    msg.key.participant ||
    msg.key.remoteJid
  );

}


// ==================================================
// USER NAME
// ==================================================

function getUserName(msg) {

  return (
    msg.pushName ||
    "عضو"
  );

}


// ==================================================
// SCORE
// ==================================================

function getScore(userId) {

  if (!scores[userId]) {

    scores[userId] = {
      points: 0,
      correct: 0,
      wrong: 0
    };

  }

  return scores[userId];

}


// ==================================================
// LEVEL
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
// GROQ AI
// ==================================================

async function askAI(question, instructions = "") {

  const apiKey =
    process.env.GROQ_API_KEY;

  if (!apiKey) {

    throw new Error(
      "GROQ_API_KEY is missing in Render."
    );

  }

  console.log("🧠 Sending to Groq...");

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

          instructions:
            instructions ||
            `
أنت مدرس لغة ألمانية داخل مجموعة WhatsApp.

ساعد الأعضاء على تعلم الألمانية من A1 إلى B1.

استخدم العربية للشرح والألمانية للأمثلة.

اجعل الإجابات قصيرة ومناسبة لـ WhatsApp.

كن واضحاً وودوداً.
`,

          input: question

        })
      }
    );


  const data =
    await response.json();


  console.log(
    "📦 Groq status:",
    response.status
  );


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

      if (answer) {
        break;
      }

    }

  }


  if (!answer) {

    throw new Error(
      "Groq returned an empty answer."
    );

  }


  console.log(
    "🤖 AI:",
    answer
  );


  return answer;

}


// ==================================================
// CREATE AI EXERCISE
// ==================================================

async function createAIExercise() {

  const prompt = `
أنشئ سؤالاً واحداً لتعلم اللغة الألمانية.

المستوى يكون عشوائياً بين A1 و A2 و B1.

يجب أن يكون السؤال اختياراً من 3 إجابات فقط.

أريد منك إخراج النتيجة بهذا الشكل بالضبط:

LEVEL: A1

QUESTION:
🇩🇪 اختر الإجابة الصحيحة:

Ich ___ jeden Tag Deutsch.

OPTIONS:
1️⃣ lerne
2️⃣ lernen
3️⃣ lernst

ANSWER:
1

EXPLANATION:
شرح قصير بالعربية.

قواعد مهمة:

- لا تستخدم 4 اختيارات.
- يجب أن تكون هناك 3 اختيارات فقط.
- ANSWER يجب أن يكون 1 أو 2 أو 3.
- السؤال يجب أن يكون جديداً ومختلفاً في كل مرة.
- يمكن أن يكون السؤال عن الكلمات أو القواعد أو ترتيب الجملة أو Artikel أو Perfekt أو Präpositionen.
- اجعل المستوى مناسباً لـ A1-B1.
- لا تضف أي نص خارج هذا التنسيق.
`;


  const result =
    await askAI(
      "أنشئ تمريناً جديداً الآن.",
      `
أنت مدرس ألمانية محترف.

مهمتك إنشاء تمارين ألمانية جديدة للمجموعة.

${prompt}
`
    );


  return parseExercise(result);

}


// ==================================================
// PARSE AI EXERCISE
// ==================================================

function parseExercise(text) {

  const levelMatch =
    text.match(
      /LEVEL:\s*(A1|A2|B1)/i
    );

  const answerMatch =
    text.match(
      /ANSWER:\s*([123])/i
    );


  if (!answerMatch) {

    throw new Error(
      "AI exercise has no valid answer."
    );

  }


  const level =
    levelMatch
      ? levelMatch[1].toUpperCase()
      : "A1";


  const answer =
    Number(answerMatch[1]);


  return {

    text,

    level,

    answer

  };

}


// ==================================================
// SEND AUTO EXERCISE
// ==================================================

async function sendAutoExercise(sock) {

  if (!botGroups.length) {

    console.log(
      "⚠️ No groups available for exercise."
    );

    return;

  }


  try {

    console.log("");
    console.log(
      "======================================"
    );

    console.log(
      "🧠 Creating AI exercise..."
    );


    const exercise =
      await createAIExercise();


    console.log(
      "📚 Exercise level:",
      exercise.level
    );

    console.log(
      "✅ Correct answer:",
      exercise.answer
    );


    for (
      const jid of botGroups
    ) {

      try {

        // ------------------------------------------
        // SAVE ACTIVE QUESTION
        // ------------------------------------------

        activeQuestions[jid] = {

          answer:
            exercise.answer,

          level:
            exercise.level,

          createdAt:
            Date.now()

        };


        // ------------------------------------------
        // SEND QUESTION
        // ------------------------------------------

        const message =
          "🇩🇪🧠 *German AI Exercise*\n\n" +

          `📚 المستوى: ${exercise.level}\n\n` +

          exercise.text
            .replace(
              /LEVEL:\s*(A1|A2|B1)\s*/i,
              ""
            )
            .replace(
              /ANSWER:\s*[123][\s\S]*/i,
              ""
            )
            .trim() +

          "\n\n" +

          "💡 أرسل رقم الإجابة فقط:\n" +
          "1️⃣ أو 2️⃣ أو 3️⃣";


        await sock.sendMessage(
          jid,
          {
            text: message
          }
        );


        console.log(
          "✅ Exercise sent to:",
          jid
        );


      }

      catch (error) {

        console.log(
          "❌ Could not send exercise:",
          error.message
        );

      }

    }


    console.log(
      "======================================"
    );

  }

  catch (error) {

    console.log(
      "❌ AI exercise error:",
      error.message
    );

  }

}


// ==================================================
// FIND GROUPS
// ==================================================

async function loadGroups(sock) {

  try {

    const groups =
      await sock.groupFetchAllParticipating();


    botGroups =
      Object.keys(groups);


    console.log("");
    console.log(
      "======================================"
    );

    console.log(
      "📋 GROUPS FOUND:",
      botGroups.length
    );


    for (
      const jid of botGroups
    ) {

      console.log(
        "👥",
        groups[jid].subject
      );

      console.log(
        "🆔",
        jid
      );

    }


    console.log(
      "======================================"
    );


    if (!botGroups.length) {

      console.log(
        "⚠️ No WhatsApp groups found."
      );

    }

  }

  catch (error) {

    console.log(
      "❌ Could not load groups:",
      error.message
    );

  }

}


// ==================================================
// POINTS
// ==================================================

async function sendPoints(
  sock,
  jid,
  msg
) {

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

        `✅ صحيحة: ${score.correct}\n` +

        `❌ خاطئة: ${score.wrong}\n`
    }
  );

}


// ==================================================
// RANKING
// ==================================================

async function sendRanking(
  sock,
  jid
) {

  const users =
    Object.entries(scores);


  if (!users.length) {

    await sock.sendMessage(
      jid,
      {
        text:
          "🏆 لا توجد نقاط حتى الآن."
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

        `⭐ ${score.points} XP\n` +

        `🎯 ${getLevel(score.points)}\n\n`;

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
// HANDLE ANSWER
// ==================================================

async function handleAnswer(
  sock,
  jid,
  msg,
  text
) {

  if (
    !/^[1-3]$/.test(text)
  ) {

    return false;

  }


  if (
    !activeQuestions[jid]
  ) {

    return false;

  }


  const question =
    activeQuestions[jid];


  const selected =
    Number(text);


  const userId =
    getUserId(msg);


  const name =
    getUserName(msg);


  const score =
    getScore(userId);


  if (
    selected ===
    question.answer
  ) {

    score.points += 10;

    score.correct += 1;


    await sock.sendMessage(
      jid,
      {
        text:

          "✅ *إجابة صحيحة!* 🎉\n\n" +

          `👤 ${name}\n` +

          "⭐ +10 XP\n\n" +

          `⭐ مجموع نقاطك: ${score.points} XP\n` +

          `🎯 مستواك: ${getLevel(score.points)}\n\n` +

          "👏 Sehr gut! 🇩🇪"
      }
    );

  }

  else {

    score.wrong += 1;


    await sock.sendMessage(
      jid,
      {
        text:

          "❌ *إجابة خاطئة*\n\n" +

          `👤 ${name}\n\n` +

          `⭐ نقاطك: ${score.points} XP\n` +

          `🎯 مستواك: ${getLevel(score.points)}\n\n` +

          "💪 حاول في التمرين القادم!"
      }
    );

  }


  return true;

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
    // SAVE CREDENTIALS
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
            "🧠 AI EXERCISES ENABLED!"
          );

          console.log(
            "⏰ AUTO EXERCISE EVERY 5 MINUTES!"
          );

          console.log(
            "🏆 RANKING AVAILABLE WITH !rank"
          );

          console.log(
            "======================================"
          );

          console.log("");


          // ------------------------------------------
          // LOAD GROUPS
          // ------------------------------------------

          await loadGroups(sock);


          // ------------------------------------------
          // START TIMER
          // ------------------------------------------

          if (!exerciseTimer) {

            exerciseTimer =
              setInterval(
                () => {

                  sendAutoExercise(
                    sock
                  );

                },
                5 * 60 * 1000
              );

          }

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
                lastDisconnect
                  .error
                  .output
                  .statusCode;

            }

          }

          catch (e) {

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

      }

      catch (error) {

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

            if (!msg) continue;

            if (!msg.message) continue;

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
            // TEXT
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


            console.log(
              "📩 GROUP MESSAGE:",
              question
            );


            // ==================================================
            // TEST
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
                    "✅ البوت يعمل.\n" +
                    "🧠 Groq AI متصل.\n" +
                    "⏰ التمارين التلقائية تعمل كل 5 دقائق."
                }
              );

              continue;

            }


            // ==================================================
            // HELP
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

                    "⏰ كل 5 دقائق ينزل تمرين AI تلقائياً.\n\n" +

                    "⭐ !points\n" +
                    "عرض نقاطك ومستواك.\n\n" +

                    "🏆 !rank\n" +
                    "عرض الترتيب.\n\n" +

                    "💲 $السؤال\n" +
                    "اسأل الذكاء الاصطناعي.\n\n" +

                    "مثال:\n" +
                    "$Was bedeutet gehen?"
                }
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
            // RANK
            // ==================================================

            if (
              question.toLowerCase() ===
              "!rank"
            ) {

              await sendRanking(
                sock,
                jid
              );

              continue;

            }


            // ==================================================
            // ANSWER 1 / 2 / 3
            // ==================================================

            if (
              /^[1-3]$/.test(question)
            ) {

              const handled =
                await handleAnswer(
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
            // AI ONLY WITH $
            // ==================================================

            if (
              !question.startsWith("$")
            ) {

              console.log(
                "⏭️ Ignored - no $"
              );

              continue;

            }


            const aiQuestion =
              question
                .slice(1)
                .trim();


            if (!aiQuestion) {

              continue;

            }


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

          }


          catch (error) {

            console.log(
              "❌ Message error:",
              error.message
            );

          }

        }

      }
    );

  }


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
