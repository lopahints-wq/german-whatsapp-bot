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
// DATA
// ==================================================

const scores = {};

// التمرين الحالي لكل مجموعة
const groupExercises = {};

// لمنع تشغيل أكثر من مؤقت
let exerciseInterval = null;

// لمنع تشغيل أكثر من Bot في نفس الوقت
let starting = false;


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
// GROQ REQUEST
// ==================================================

async function groqRequest(instructions, input) {

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
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },

        body: JSON.stringify({

          model:
            "openai/gpt-oss-20b",

          instructions,

          input

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


  // الطريقة الرسمية
  if (
    typeof data.output_text === "string"
  ) {

    answer =
      data.output_text.trim();

  }


  // احتياط
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

    console.log(
      "❌ Groq returned no text."
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


  return answer;

}


// ==================================================
// NORMAL AI
// ==================================================

async function askAI(question) {

  console.log(
    "🧠 Sending message to Groq..."
  );

  console.log(
    "❓ Question:",
    question
  );


  const answer =
    await groqRequest(

      `
أنت مدرس لغة ألمانية داخل مجموعة WhatsApp.

مهمتك مساعدة الأعضاء على تعلم اللغة الألمانية من A1 إلى B1.

القواعد:

1. إذا كتب المستخدم جملة بالألمانية:
صححها ثم اشرح الخطأ بالعربية باختصار.

2. إذا كتب المستخدم كلمة ألمانية:
اشرح معناها بالعربية وأعط مثالاً بالألمانية مع الترجمة.

3. إذا كتب المستخدم بالعربية:
إذا كان يريد ترجمة، أعطه ترجمة ألمانية طبيعية.

4. إذا سأل عن قاعدة ألمانية:
اشرحها بطريقة بسيطة مع أمثلة.

5. إذا طلب تمريناً:
يمكنك إنشاء تمرين مناسب لمستواه.

6. إذا كتب "اختبرني":
ابدأ معه اختباراً قصيراً.

7. استخدم العربية للشرح والألمانية للأمثلة.

8. اجعل الإجابات مناسبة لـ WhatsApp وليست طويلة جداً.

9. كن ودوداً وواضحاً.

لا تستخدم مقدمات طويلة.
      `,

      question

    );


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

  console.log("");
  console.log(
    "======================================"
  );

  console.log(
    "🧠 Creating AI exercise..."
  );


  const levels = [
    "A1",
    "A2",
    "B1"
  ];


  const level =
    levels[
      Math.floor(
        Math.random() *
        levels.length
      )
    ];


  console.log(
    "📚 AI exercise level:",
    level
  );


  const prompt = `

أنشئ تمريناً واحداً في اللغة الألمانية.

المستوى:
${level}

يجب أن يكون التمرين اختياراً من متعدد.

مهم جداً:
- 3 اختيارات فقط.
- اختيار واحد صحيح فقط.
- لا تجعل أكثر من اختيار صحيح.
- السؤال مناسب للمستوى ${level}.
- يمكن أن يكون عن القواعد أو المفردات أو ترتيب الجملة.
- لا تستخدم سؤالاً معقداً جداً.
- أضف شرحاً قصيراً بالعربية.

أرسل النتيجة بهذا الشكل EXACTLY:

LEVEL: ${level}

QUESTION:
اكتب السؤال هنا

OPTIONS:
1. الاختيار الأول
2. الاختيار الثاني
3. الاختيار الثالث

ANSWER:
1

EXPLANATION:
شرح قصير بالعربية

لا تضف أي شيء آخر.
`;


  const raw =
    await groqRequest(

      `
أنت مولد تمارين للغة الألمانية.

أنشئ تمارين تعليمية دقيقة.

يجب الالتزام حرفياً بالتنسيق المطلوب.
      `,

      prompt

    );


  console.log(
    "🤖 RAW EXERCISE:"
  );

  console.log(raw);


  const exercise =
    parseAIExercise(raw);


  if (!exercise) {

    throw new Error(
      "Could not parse AI exercise."
    );

  }


  console.log(
    "📚 Exercise level:",
    exercise.level
  );

  console.log(
    "❓ QUESTION:"
  );

  console.log(
    exercise.question
  );

  console.log(
    "🔢 OPTIONS:"
  );

  console.log(
    exercise.options
  );

  console.log(
    "✅ ANSWER:",
    exercise.answer
  );

  console.log(
    "💡 EXPLANATION:",
    exercise.explanation
  );


  console.log(
    "======================================"
  );


  return exercise;

}


// ==================================================
// PARSE AI EXERCISE
// ==================================================

function parseAIExercise(raw) {

  if (!raw) {
    return null;
  }


  let text =
    raw
      .replace(/```/g, "")
      .trim();


  // LEVEL
  const levelMatch =
    text.match(
      /LEVEL\s*:\s*([A-C][1-2]\+?)/i
    );


  const level =
    levelMatch
      ? levelMatch[1].toUpperCase()
      : "A2";


  // QUESTION
  const questionMatch =
    text.match(
      /QUESTION\s*:\s*([\s\S]*?)\s*OPTIONS\s*:/i
    );


  if (!questionMatch) {
    return null;
  }


  const question =
    questionMatch[1].trim();


  // OPTIONS
  const optionsMatch =
    text.match(
      /OPTIONS\s*:\s*([\s\S]*?)\s*ANSWER\s*:/i
    );


  if (!optionsMatch) {
    return null;
  }


  const optionsText =
    optionsMatch[1].trim();


  const optionMatches =
    optionsText.match(
      /^\s*[1-3][.)]\s*(.+)$/gmi
    );


  if (
    !optionMatches ||
    optionMatches.length !== 3
  ) {

    console.log(
      "❌ Could not find exactly 3 options."
    );

    return null;

  }


  const options =
    optionMatches.map(
      line =>
        line
          .replace(
            /^\s*[1-3][.)]\s*/,
            ""
          )
          .trim()
    );


  // ANSWER
  const answerMatch =
    text.match(
      /ANSWER\s*:\s*([1-3])/i
    );


  if (!answerMatch) {
    return null;
  }


  const answer =
    Number(
      answerMatch[1]
    );


  // EXPLANATION
  const explanationMatch =
    text.match(
      /EXPLANATION\s*:\s*([\s\S]*)$/i
    );


  const explanation =
    explanationMatch
      ? explanationMatch[1].trim()
      : "أحسنت!";


  return {

    level,

    question,

    options,

    answer,

    explanation

  };

}


// ==================================================
// FORMAT EXERCISE
// ==================================================

function formatExercise(exercise) {

  return (

    "📝🇩🇪 *German AI Exercise*\n\n" +

    `📚 المستوى: ${exercise.level}\n\n` +

    "🇩🇪 *اختر الإجابة الصحيحة:*\n\n" +

    exercise.question +

    "\n\n" +

    `1️⃣ ${exercise.options[0]}\n` +

    `2️⃣ ${exercise.options[1]}\n` +

    `3️⃣ ${exercise.options[2]}\n\n` +

    "💡 أرسل رقم الإجابة فقط:\n" +

    "1 أو 2 أو 3"

  );

}


// ==================================================
// SEND AI EXERCISE TO GROUP
// ==================================================

async function sendAIExercise(
  sock,
  jid
) {

  try {

    console.log(
      `🧠 Creating exercise for ${jid}`
    );


    const exercise =
      await createAIExercise();


    // حفظ التمرين الحالي للمجموعة
    groupExercises[jid] = {

      question:
        exercise.question,

      options:
        exercise.options,

      answer:
        exercise.answer,

      explanation:
        exercise.explanation,

      level:
        exercise.level,

      createdAt:
        Date.now()

    };


    await sock.sendMessage(
      jid,
      {
        text:
          formatExercise(
            exercise
          )
      }
    );


    console.log(
      `✅ Exercise sent to: ${jid}`
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
// HANDLE AI EXERCISE ANSWER
// ==================================================

async function handleExerciseAnswer(
  sock,
  jid,
  msg,
  text
) {

  // لا يوجد تمرين حالي في المجموعة
  if (!groupExercises[jid]) {

    return false;

  }


  // الإجابة يجب أن تكون 1 أو 2 أو 3
  if (!/^[1-3]$/.test(text)) {

    return false;

  }


  const exercise =
    groupExercises[jid];


  const selected =
    Number(text);


  const userId =
    getUserId(msg);


  const userName =
    getUserName(msg);


  const score =
    getScore(userId);


  score.exercises += 1;


  console.log("");
  console.log(
    "======================================"
  );

  console.log(
    "📝 EXERCISE ANSWER"
  );

  console.log(
    "👤 User:",
    userName
  );

  console.log(
    "🔢 Selected:",
    selected
  );

  console.log(
    "✅ Correct:",
    exercise.answer
  );


  // ==================================================
  // CORRECT
  // ==================================================

  if (
    selected ===
    exercise.answer
  ) {

    score.points += 10;

    score.correct += 1;


    await sock.sendMessage(
      jid,
      {
        text:

          "✅ *إجابة صحيحة!* 🎉\n\n" +

          `👤 ${userName}\n\n` +

          "⭐ +10 XP\n" +

          `⭐ نقاطك: ${score.points} XP\n` +

          `🎯 مستواك: ${getLevel(score.points)}\n\n` +

          `💡 ${exercise.explanation}`

      }
    );


    console.log(
      "✅ Correct answer."
    );

  }

  // ==================================================
  // WRONG
  // ==================================================

  else {

    score.wrong += 1;


    await sock.sendMessage(
      jid,
      {
        text:

          "❌ *إجابة خاطئة*\n\n" +

          `👤 ${userName}\n\n` +

          `الإجابة الصحيحة: ${exercise.answer}️⃣\n\n` +

          `⭐ نقاطك: ${score.points} XP\n` +

          `🎯 مستواك: ${getLevel(score.points)}\n\n` +

          `💡 ${exercise.explanation}`

      }
    );


    console.log(
      "❌ Wrong answer."
    );

  }


  console.log(
    "======================================"
  );


  // مهم:
  // لا نحذف التمرين بعد إجابة شخص واحد.
  // حتى يستطيع باقي أعضاء المجموعة الإجابة أيضاً.

  return true;

}


// ==================================================
// SEND POINTS
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

        `✅ إجابات صحيحة: ${score.correct}\n` +

        `❌ إجابات خاطئة: ${score.wrong}\n\n` +

        `📝 التمارين: ${score.exercises}`

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
          "🏆 لا توجد نقاط بعد.\n\n" +
          "ابدأ بحل التمارين."
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

        `⭐ ${score.points} XP — ${getLevel(score.points)}\n\n`;

    }
  );


  await sock.sendMessage(
    jid,
    {
      text:
        message
    }
  );

}


// ==================================================
// HELP
// ==================================================

async function sendHelp(
  sock,
  jid
) {

  await sock.sendMessage(
    jid,
    {

      text:

        "🇩🇪🤖 *German B1 AI Bot*\n\n" +

        "🧠 الذكاء الاصطناعي:\n" +

        "اكتب $ قبل السؤال.\n" +

        "مثال:\n" +

        "$Was bedeutet gehen?\n\n" +

        "📝 التمارين:\n" +

        "!exercise\n" +

        "إنشاء تمرين فوراً.\n\n" +

        "⭐ النقاط:\n" +

        "!points\n\n" +

        "🏆 الترتيب:\n" +

        "!rank\n\n" +

        "💡 التمارين التلقائية يتم إرسالها كل 5 دقائق."

    }
  );

}


// ==================================================
// START AUTOMATIC EXERCISES
// ==================================================

function startAutomaticExercises(
  sock,
  groupJids
) {

  // إذا كان هناك مؤقت قديم
  if (exerciseInterval) {

    clearInterval(
      exerciseInterval
    );

  }


  console.log("");
  console.log(
    "⏰ Automatic exercises started."
  );

  console.log(
    "⏰ Interval: every 5 minutes."
  );

  console.log(
    `👥 Groups: ${groupJids.length}`
  );


  // لا نرسل مباشرة عند التشغيل
  // أول تمرين بعد 5 دقائق

  exerciseInterval =
    setInterval(
      async () => {

        console.log("");
        console.log(
          "⏰ 5 minutes passed."
        );

        console.log(
          "🧠 Creating automatic exercises..."
        );


        for (
          const jid of groupJids
        ) {

          try {

            await sendAIExercise(
              sock,
              jid
            );

          }

          catch (error) {

            console.log(
              "❌ Automatic exercise error:",
              error.message
            );

          }


          // تأخير صغير بين المجموعات
          await new Promise(
            resolve =>
              setTimeout(
                resolve,
                3000
              )
          );

        }

      },

      5 * 60 * 1000

    );

}


// ==================================================
// GET GROUPS
// ==================================================

async function getGroups(
  sock
) {

  try {

    const groups =
      await sock.groupFetchAllParticipating();


    const groupList =
      Object.values(groups);


    console.log("");
    console.log(
      "======================================"
    );

    console.log(
      `📦 GROUPS FOUND: ${groupList.length}`
    );


    for (
      const group of groupList
    ) {

      console.log(
        `👥 ${group.subject}`
      );

      console.log(
        `🆔 ${group.id}`
      );

    }


    console.log(
      "======================================"
    );


    return groupList.map(
      group =>
        group.id
    );

  }

  catch (error) {

    console.log(
      "❌ Could not get groups:",
      error.message
    );


    return [];

  }

}


// ==================================================
// START BOT
// ==================================================

async function startBot() {

  if (starting) {

    console.log(
      "⚠️ Bot is already starting."
    );

    return;

  }


  starting = true;


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
    } =
      await useMultiFileAuthState(
        "./auth_info"
      );


    // ==================================================
    // WHATSAPP
    // ==================================================

    const sock =
      makeWASocket({

        auth:
          state,

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


    starting = false;


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


        // CONNECTING
        if (
          connection ===
          "connecting"
        ) {

          console.log(
            "🔄 Connecting to WhatsApp..."
          );

        }


        // CONNECTED
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
            "🧠 AI EXERCISES ENABLED!"
          );

          console.log(
            "⏰ AUTO EXERCISE EVERY 5 MINUTES!"
          );

          console.log(
            "🏆 RANK AVAILABLE WITH !rank"
          );

          console.log(
            "💲 AI RESPONDS ONLY TO $"
          );

          console.log(
            "======================================"
          );


          // الحصول على المجموعات
          const groupJids =
            await getGroups(
              sock
            );


          if (
            groupJids.length === 0
          ) {

            console.log(
              "⚠️ No groups found."
            );

          }

          else {

            // تشغيل المؤقت
            startAutomaticExercises(
              sock,
              groupJids
            );

          }

        }


        // DISCONNECTED
        if (
          connection ===
          "close"
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


          console.log("");
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
              "⚠️ Pair WhatsApp again."
            );


            if (
              exerciseInterval
            ) {

              clearInterval(
                exerciseInterval
              );

              exerciseInterval =
                null;

            }


            return;

          }


          // إعادة الاتصال
          console.log(
            "🔄 Reconnecting in 5 seconds..."
          );


          if (
            exerciseInterval
          ) {

            clearInterval(
              exerciseInterval
            );

            exerciseInterval =
              null;

          }


          setTimeout(
            () => {

              startBot();

            },

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

            // BASIC
            if (!msg) continue;

            if (!msg.message) continue;

            if (
              msg.key.fromMe
            ) continue;


            const jid =
              msg.key.remoteJid;


            if (!jid) continue;


            // GROUPS ONLY
            if (
              !jid.endsWith(
                "@g.us"
              )
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


            console.log("");
            console.log(
              "📩 GROUP MESSAGE:",
              question
            );


            // ==================================================
            // !TEST
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

                    "✅ البوت يعمل!\n" +

                    "🧠 Groq AI متصل.\n" +

                    "📝 AI Exercises تعمل.\n" +

                    "⭐ نظام النقاط يعمل."

                }
              );


              continue;

            }


            // ==================================================
            // !HELP
            // ==================================================

            if (
              question.toLowerCase() ===
              "!help"
            ) {

              await sendHelp(
                sock,
                jid
              );


              continue;

            }


            // ==================================================
            // !EXERCISE
            // ==================================================

            if (
              question.toLowerCase() ===
              "!exercise"
            ) {

              console.log(
                "🧠 Manual AI exercise requested."
              );


              await sendAIExercise(
                sock,
                jid
              );


              continue;

            }


            // ==================================================
            // !POINTS
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
            // !RANK
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
            // AI EXERCISE ANSWER
            // ==================================================

            if (
              /^[1-3]$/.test(
                question
              )
            ) {

              const handled =
                await handleExerciseAnswer(
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


            // إزالة $
            const aiQuestion =
              question
                .slice(1)
                .trim();


            if (!aiQuestion) {

              console.log(
                "⏭️ Empty AI question."
              );

              continue;

            }


            // ==================================================
            // ASK AI
            // ==================================================

            console.log(
              "🤖 Sending to Groq..."
            );


            const answer =
              await askAI(
                aiQuestion
              );


            // ==================================================
            // SEND AI ANSWER
            // ==================================================

            await sock.sendMessage(
              jid,
              {

                text:

                  "🇩🇪🤖 *German B1 Bot*\n\n" +

                  answer

              }
            );


            console.log(
              "✅ AI reply sent."
            );

          }


          catch (error) {

            console.log("");
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

            }

            catch (sendError) {

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


  catch (error) {

    starting = false;


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


// ==================================================
// START
// ==================================================

startBot();
