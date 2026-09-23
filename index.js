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
// SETTINGS
// ==================================================

const ALLOWED_GROUPS = [
  "120363410722950290@g.us"
];

const EXERCISE_INTERVAL = 60 * 1000;


// ==================================================
// POINTS
// ==================================================

const scores = {};


// ==================================================
// ACTIVE POLLS
// ==================================================

const activePolls = {};


// ==================================================
// BOT SOCKET
// ==================================================

let globalSock = null;


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
// SCORE
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
// LEVEL
// ==================================================

function getLevel(points) {

  if (points >= 1000) {
    return "B2 🔥";
  }

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
// ALLOWED GROUP CHECK
// ==================================================

function isAllowedGroup(jid) {

  return ALLOWED_GROUPS.includes(jid);

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

        body:
          JSON.stringify({

            model:
              "openai/gpt-oss-20b",

            instructions: `
أنت مدرس لغة ألمانية متخصص في A1 إلى B1.

عند طلب إنشاء تمرين:

أنشئ سؤالاً واحداً فقط باللغة الألمانية.

يجب أن يكون السؤال مناسباً لتعلم اللغة الألمانية.

يجب أن يحتوي على 3 اختيارات فقط.

يجب أن تكون هناك إجابة صحيحة واحدة فقط.

مهم جداً:
لا تكتب شرحاً طويلاً.
لا تكتب الإجابة الصحيحة في النص.
لا تستخدم 4 اختيارات.

أعد النتيجة بهذا الشكل فقط:

QUESTION:
السؤال هنا

OPTION1:
الاختيار الأول

OPTION2:
الاختيار الثاني

OPTION3:
الاختيار الثالث

ANSWER:
1

أو ANSWER: 2
أو ANSWER: 3

غيّر نوع السؤال في كل مرة.

يمكن أن تكون الأسئلة عن:
- المفردات
- Artikel
- تصريف الأفعال
- Akkusativ
- Dativ
- Perfekt
- ترتيب الجملة
- حروف الجر
- الصفات
- قواعد A1/A2/B1

اجعل السؤال مناسباً لمجموعة WhatsApp.
`,

            input:
              question

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
    typeof data.output_text ===
    "string"
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

      if (answer) break;

    }

  }


  if (!answer) {

    throw new Error(
      "Groq returned an empty answer."
    );

  }


  return answer;

}


// ==================================================
// PARSE AI EXERCISE
// ==================================================

function parseExercise(text) {

  const questionMatch =
    text.match(
      /QUESTION:\s*([\s\S]*?)(?=\nOPTION1:)/i
    );

  const option1Match =
    text.match(
      /OPTION1:\s*([\s\S]*?)(?=\nOPTION2:)/i
    );

  const option2Match =
    text.match(
      /OPTION2:\s*([\s\S]*?)(?=\nOPTION3:)/i
    );

  const option3Match =
    text.match(
      /OPTION3:\s*([\s\S]*?)(?=\nANSWER:)/i
    );

  const answerMatch =
    text.match(
      /ANSWER:\s*([123])/i
    );


  if (
    !questionMatch ||
    !option1Match ||
    !option2Match ||
    !option3Match ||
    !answerMatch
  ) {

    console.log(
      "❌ Could not parse AI exercise:"
    );

    console.log(text);

    return null;

  }


  const question =
    questionMatch[1].trim();

  const options = [

    option1Match[1].trim(),

    option2Match[1].trim(),

    option3Match[1].trim()

  ];


  const answer =
    Number(
      answerMatch[1]
    );


  if (
    !question ||
    options.some(
      option => !option
    )
  ) {

    return null;

  }


  return {

    question,

    options,

    answer

  };

}


// ==================================================
// CREATE AI EXERCISE
// ==================================================

async function generateExercise() {

  const prompt = `
أنشئ تمريناً جديداً وعشوائياً لتعلم اللغة الألمانية.

اختر مستوى عشوائياً من A1 أو A2 أو B1.

استخدم 3 اختيارات فقط.

يجب أن تكون إجابة واحدة صحيحة.

لا تكرر السؤال السابق.
`;


  const aiResponse =
    await askAI(prompt);


  return parseExercise(
    aiResponse
  );

}


// ==================================================
// SEND EXERCISE POLL
// ==================================================

async function sendExercisePoll(
  sock,
  jid
) {

  if (
    !isAllowedGroup(jid)
  ) {

    return;

  }


  try {

    console.log(
      "🧠 Creating AI exercise..."
    );


    const exercise =
      await generateExercise();


    if (!exercise) {

      console.log(
        "❌ AI exercise generation failed."
      );

      return;

    }


    const pollMessage = {

      poll: {

        name:
          "🇩🇪📝 German Exercise\n\n" +
          exercise.question,

        values: [

          `1️⃣ ${exercise.options[0]}`,

          `2️⃣ ${exercise.options[1]}`,

          `3️⃣ ${exercise.options[2]}`

        ],

        selectableCount: 1

      }

    };


    const sent =
      await sock.sendMessage(
        jid,
        pollMessage
      );


    if (!sent?.key?.id) {

      console.log(
        "❌ Poll message ID missing."
      );

      return;

    }


    const messageId =
      sent.key.id;


    activePolls[messageId] = {

      jid,

      answer:
        exercise.answer,

      question:
        exercise.question,

      options:
        exercise.options,

      participants:
        {},

      createdAt:
        Date.now()

    };


    console.log(
      "✅ AI exercise poll sent."
    );


    console.log(
      "📝 Correct answer:",
      exercise.answer
    );

  }

  catch (error) {

    console.log(
      "❌ Exercise error:",
      error.message
    );

  }

}


// ==================================================
// HANDLE POLL UPDATE
// ==================================================

async function handlePollUpdate(
  sock,
  update
) {

  try {

    const pollUpdate =
      update;


    const messageId =
      pollUpdate.key?.id;


    if (!messageId) {
      return;
    }


    const poll =
      activePolls[messageId];


    if (!poll) {

      return;

    }


    const jid =
      poll.jid;


    if (
      !isAllowedGroup(jid)
    ) {

      return;

    }


    const voter =
      pollUpdate.key?.participant ||
      pollUpdate.key?.remoteJid;


    if (!voter) {

      return;

    }


    const userId =
      voter;


    // منع احتساب نفس الشخص مرتين
    if (
      poll.participants[userId]
    ) {

      return;

    }


    const selectedOptions =
      pollUpdate.vote?.selectedOptions ||
      [];


    if (
      !selectedOptions.length
    ) {

      return;

    }


    const selected =
      selectedOptions[0];


    let selectedNumber =
      0;


    if (
      selected.includes(
        "1️⃣"
      )
    ) {

      selectedNumber = 1;

    }

    else if (
      selected.includes(
        "2️⃣"
      )
    ) {

      selectedNumber = 2;

    }

    else if (
      selected.includes(
        "3️⃣"
      )
    ) {

      selectedNumber = 3;

    }


    if (
      !selectedNumber
    ) {

      return;

    }


    poll.participants[userId] = {

      selected:
        selectedNumber,

      time:
        Date.now()

    };


    const score =
      getScore(userId);


    score.exercises += 1;


    if (
      selectedNumber ===
      poll.answer
    ) {

      score.points += 10;

      score.correct += 1;


      console.log(
        "✅ Correct answer:",
        userId
      );

    }

    else {

      score.wrong += 1;


      console.log(
        "❌ Wrong answer:",
        userId
      );

    }


    // نرسل نتيجة خاصة للشخص
    try {

      await sock.sendMessage(
        userId,
        {
          text:
            selectedNumber ===
            poll.answer

              ? "✅ إجابتك صحيحة! 🎉\n\n" +
                "⭐ +10 XP\n" +
                `⭐ نقاطك: ${score.points}\n` +
                `🎯 مستواك: ${getLevel(score.points)}`

              : "❌ إجابتك غير صحيحة.\n\n" +
                "حاول في التمرين القادم!\n" +
                `⭐ نقاطك: ${score.points}\n` +
                `🎯 مستواك: ${getLevel(score.points)}`
        }
      );

    }

    catch (error) {

      console.log(
        "⚠️ Could not send private result:",
        error.message
      );

    }

  }

  catch (error) {

    console.log(
      "❌ Poll update error:",
      error.message
    );

  }

}


// ==================================================
// RANKING
// ==================================================

async function sendRanking(
  sock,
  jid
) {

  const users =
    Object.entries(
      scores
    );


  if (!users.length) {

    await sock.sendMessage(
      jid,
      {
        text:
          "🏆 لا توجد نقاط بعد."
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
    users.slice(
      0,
      10
    );


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
// USER POINTS
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
        "⭐ *نقاطك*\n\n" +

        `👤 ${name}\n\n` +

        `⭐ XP: ${score.points}\n` +

        `🎯 المستوى: ${getLevel(score.points)}\n\n` +

        `✅ صحيحة: ${score.correct}\n` +

        `❌ خاطئة: ${score.wrong}\n\n` +

        `📝 التمارين: ${score.exercises}`
    }
  );

}


// ==================================================
// TEXT EXTRACTION
// ==================================================

function getMessageText(msg) {

  if (
    msg.message?.conversation
  ) {

    return msg.message.conversation;

  }


  if (
    msg.message
      ?.extendedTextMessage
      ?.text
  ) {

    return (
      msg.message
        .extendedTextMessage
        .text
    );

  }


  if (
    msg.message
      ?.ephemeralMessage
      ?.message
      ?.conversation
  ) {

    return (
      msg.message
        .ephemeralMessage
        .message
        .conversation
    );

  }


  if (
    msg.message
      ?.ephemeralMessage
      ?.message
      ?.extendedTextMessage
      ?.text
  ) {

    return (
      msg.message
        .ephemeralMessage
        .message
        .extendedTextMessage
        .text
    );

  }


  return "";

}


// ==================================================
// START BOT
// ==================================================

async function startBot() {

  try {

    console.log(
      "🚀 Starting German B1 WhatsApp Bot..."
    );


    const {
      state,
      saveCreds
    } =
      await useMultiFileAuthState(
        "./auth_info"
      );


    const sock =
      makeWASocket({

        auth: state,

        logger:
          pino({
            level: "silent"
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


    globalSock =
      sock;


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
          connection ===
          "connecting"
        ) {

          console.log(
            "🔄 Connecting to WhatsApp..."
          );

        }


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
            "🤖 GERMAN AI BOT READY!"
          );

          console.log(
            "📝 AI POLL SYSTEM READY!"
          );

          console.log(
            "⏱️ Exercise every 1 minute"
          );

          console.log(
            "======================================"
          );

          console.log("");

        }


        if (
          connection ===
          "close"
        ) {

          let code = 0;


          try {

            if (
              lastDisconnect
                ?.error instanceof Boom
            ) {

              code =
                lastDisconnect
                  .error
                  .output
                  .statusCode;

            }

          }

          catch (error) {

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


      console.log(
        "📱 Preparing pairing..."
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
    // POLL VOTE UPDATES
    // ==================================================

    sock.ev.on(
      "messages.update",
      async (updates) => {

        for (
          const update of updates
        ) {

          if (
            update.update
              ?.pollUpdates
          ) {

            const pollUpdates =
              update.update.pollUpdates;


            for (
              const pollUpdate
              of pollUpdates
            ) {

              await handlePollUpdate(
                sock,
                pollUpdate
              );

            }

          }

        }

      }
    );


    // ==================================================
    // NORMAL MESSAGES
    // ==================================================

    sock.ev.on(
      "messages.upsert",
      async ({
        messages
      }) => {

        for (
          const msg
          of messages
        ) {

          try {

            if (!msg) continue;

            if (!msg.message) continue;

            if (msg.key.fromMe)
              continue;


            const jid =
              msg.key.remoteJid;


            if (!jid)
              continue;


            // المجموعات فقط
            if (
              !jid.endsWith(
                "@g.us"
              )
            ) {

              continue;

            }


            const text =
              getMessageText(
                msg
              ).trim();


            if (!text)
              continue;


            console.log(
              "📩 MESSAGE:",
              text
            );


            // ==================================================
            // !test
            // ==================================================

            if (
              text.toLowerCase() ===
              "!test"
            ) {

              await sock.sendMessage(
                jid,
                {
                  text:
                    "🇩🇪🤖 German B1 Bot\n\n" +
                    "✅ البوت يعمل.\n" +
                    "🧠 Groq AI متصل.\n" +
                    "📝 نظام التمارين يعمل."
                }
              );


              continue;

            }


            // ==================================================
            // !help
            // ==================================================

            if (
              text.toLowerCase() ===
              "!help"
            ) {

              await sock.sendMessage(
                jid,
                {
                  text:
                    "🇩🇪🤖 *German B1 Bot*\n\n" +

                    "📝 التمرين:\n" +
                    "يصل تلقائياً كل دقيقة.\n\n" +

                    "⭐ !points\n" +
                    "عرض نقاطك.\n\n" +

                    "🏆 !rank\n" +
                    "عرض ترتيب المجموعة.\n\n" +

                    "🤖 AI:\n" +
                    "اكتب السؤال بهذا الشكل:\n\n" +

                    "$Was bedeutet gehen?\n\n" +

                    "💡 الرسائل العادية لا يرد عليها البوت."
                }
              );


              continue;

            }


            // ==================================================
            // !rank
            // ==================================================

            if (
              text.toLowerCase() ===
              "!rank"
            ) {

              if (
                isAllowedGroup(jid)
              ) {

                await sendRanking(
                  sock,
                  jid
                );

              }

              continue;

            }


            // ==================================================
            // !ranking
            // ==================================================

            if (
              text.toLowerCase() ===
              "!ranking"
            ) {

              if (
                isAllowedGroup(jid)
              ) {

                await sendRanking(
                  sock,
                  jid
                );

              }

              continue;

            }


            // ==================================================
            // !points
            // ==================================================

            if (
              text.toLowerCase() ===
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
            // AI
            // ==================================================

            if (
              !text.startsWith("$")
            ) {

              console.log(
                "⏭️ Ignored."
              );

              continue;

            }


            const aiQuestion =
              text
                .slice(1)
                .trim();


            if (!aiQuestion)
              continue;


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


    // ==================================================
    // AUTOMATIC EXERCISES
    // ==================================================

    setInterval(
      async () => {

        if (!globalSock)
          return;


        for (
          const groupId
          of ALLOWED_GROUPS
        ) {

          try {

            await sendExercisePoll(
              globalSock,
              groupId
            );

          }

          catch (error) {

            console.log(
              "❌ Automatic exercise error:",
              error.message
            );

          }

        }

      },
      EXERCISE_INTERVAL
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
