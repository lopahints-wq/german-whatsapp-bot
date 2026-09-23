const express = require("express");
const pino = require("pino");

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  Browsers
} = require("@whiskeysockets/baileys");

const { Boom } = require("@hapi/boom");


// ============================================================
// SERVER
// ============================================================

const app = express();

const PORT = process.env.PORT || 10000;

app.get("/", (req, res) => {
  res.send("🇩🇪 German WhatsApp AI Bot is running!");
});

app.listen(PORT, () => {
  console.log(`🌐 Server started on port ${PORT}`);
});


// ============================================================
// CONFIGURATION
// ============================================================

// تمرين كل دقيقة
const EXERCISE_INTERVAL = 60 * 1000;

// المجموعتان المسموح لهما باستقبال التمارين
const ALLOWED_GROUPS = [
  "120363410722950290@g.us",
  "120363423888719176@g.us"
];


// ============================================================
// GLOBAL STATE
// ============================================================

// نقاط الأعضاء
const scores = {};

// التمرين الحالي لكل مجموعة
const activeExercises = {};

// منع إعطاء نفس العضو نقاطاً عدة مرات على نفس السؤال
const answeredUsers = {};

// منع تشغيل أكثر من مؤقت
let exerciseTimer = null;

// منع إنشاء أكثر من Socket
let sock = null;

// منع تشغيل أكثر من اتصال في نفس الوقت
let startingBot = false;

// لمنع إنشاء تمرين جديد إذا كان التمرين السابق ما زال قيد الإنشاء
const exerciseGenerating = {};


// ============================================================
// USER ID
// ============================================================

function getUserId(msg) {

  return (
    msg.key.participant ||
    msg.key.remoteJid
  );

}


// ============================================================
// USER NAME
// ============================================================

function getUserName(msg) {

  return (
    msg.pushName ||
    "عضو"
  );

}


// ============================================================
// LEVEL
// ============================================================

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


// ============================================================
// SCORE
// ============================================================

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


// ============================================================
// AI REQUEST
// ============================================================

async function askAI(question) {

  const apiKey =
    process.env.GROQ_API_KEY;

  if (!apiKey) {

    throw new Error(
      "GROQ_API_KEY is missing in Render."
    );

  }

  console.log("🧠 Sending request to Groq...");

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

          model: "openai/gpt-oss-20b",

          instructions: `
أنت مدرس لغة ألمانية محترف داخل مجموعة WhatsApp.

مهمتك مساعدة الأعضاء في تعلم الألمانية من A1 إلى B1.

إذا كان المطلوب تمريناً، يجب أن تعيد JSON فقط بهذا الشكل:

{
  "level": "A1",
  "question": "🇩🇪 اختر الإجابة الصحيحة:\\n\\nIch ___ Deutsch.",
  "options": [
    "spreche",
    "sprichst",
    "sprechen"
  ],
  "answer": 1,
  "explanation": "مع ich نستخدم spreche."
}

القواعد الخاصة بالتمارين:

- يجب أن يكون هناك 3 اختيارات فقط.
- answer يجب أن يكون 1 أو 2 أو 3.
- السؤال يجب أن يكون صحيحاً لغوياً.
- اختر مستوى A1 أو A2 أو B1.
- لا تجعل الإجابة الصحيحة دائماً رقم 1.
- غيّر موضع الإجابة الصحيحة عشوائياً.
- اجعل السؤال مناسباً للمستوى.
- استخدم الألمانية في السؤال والاختيارات.
- استخدم العربية في الشرح.
- لا تستخدم Markdown خارج JSON.
- لا تضف أي كلام قبل أو بعد JSON.

إذا كان السؤال عادياً وليس تمريناً:
أجب بشكل طبيعي.
استخدم العربية للشرح والألمانية للأمثلة.
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


  return answer;

}


// ============================================================
// CREATE AI EXERCISE
// ============================================================

async function createAIExercise() {

  console.log("");
  console.log("======================================");
  console.log("🧠 Creating AI exercise...");
  console.log("======================================");

  const raw =
    await askAI(
      "أنشئ تمريناً جديداً في اللغة الألمانية."
    );


  console.log("🤖 AI RAW:");
  console.log(raw);


  let clean =
    raw
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .trim();


  let exercise;


  try {

    exercise =
      JSON.parse(clean);

  }

  catch (error) {

    console.log(
      "⚠️ AI JSON parsing failed."
    );

    // محاولة استخراج JSON
    const start =
      clean.indexOf("{");

    const end =
      clean.lastIndexOf("}");

    if (
      start !== -1 &&
      end !== -1
    ) {

      const jsonText =
        clean.slice(
          start,
          end + 1
        );

      exercise =
        JSON.parse(jsonText);

    }

    else {

      throw new Error(
        "AI returned invalid exercise JSON."
      );

    }

  }


  // ==========================================================
  // VALIDATION
  // ==========================================================

  if (
    !exercise.level ||
    !exercise.question ||
    !Array.isArray(exercise.options) ||
    exercise.options.length !== 3 ||
    ![1, 2, 3].includes(
      Number(exercise.answer)
    )
  ) {

    throw new Error(
      "AI exercise format is invalid."
    );

  }


  exercise.answer =
    Number(exercise.answer);


  console.log(
    "📚 LEVEL:",
    exercise.level
  );

  console.log(
    "❓ QUESTION:",
    exercise.question
  );

  console.log(
    "1️⃣",
    exercise.options[0]
  );

  console.log(
    "2️⃣",
    exercise.options[1]
  );

  console.log(
    "3️⃣",
    exercise.options[2]
  );

  console.log(
    "✅ ANSWER:",
    exercise.answer
  );

  return exercise;

}


// ============================================================
// FORMAT EXERCISE
// ============================================================

function formatExercise(exercise) {

  return (
    "📝🇩🇪 *German AI Exercise*\n\n" +

    `📚 المستوى: *${exercise.level}*\n\n` +

    `${exercise.question}\n\n` +

    `1️⃣ ${exercise.options[0]}\n` +
    `2️⃣ ${exercise.options[1]}\n` +
    `3️⃣ ${exercise.options[2]}\n\n` +

    "💡 أرسل رقم الإجابة فقط\n" +
    "مثال: 2"
  );

}


// ============================================================
// SEND AI EXERCISE TO GROUP
// ============================================================

async function sendAIExercise(jid) {

  if (!sock) return;


  if (
    exerciseGenerating[jid]
  ) {

    console.log(
      "⏭️ Exercise already generating:",
      jid
    );

    return;

  }


  exerciseGenerating[jid] = true;


  try {

    console.log(
      `📚 Creating exercise for ${jid}`
    );


    const exercise =
      await createAIExercise();


    // حفظ السؤال للمجموعة
    activeExercises[jid] = {

      answer:
        exercise.answer,

      level:
        exercise.level,

      explanation:
        exercise.explanation ||
        "أحسنت! حاول فهم سبب صحة الإجابة.",

      createdAt:
        Date.now()

    };


    // قائمة الأعضاء الذين أجابوا
    answeredUsers[jid] =
      new Set();


    await sock.sendMessage(
      jid,
      {
        text:
          formatExercise(exercise)
      }
    );


    console.log(
      `✅ Exercise sent to: ${jid}`
    );

  }

  catch (error) {

    console.log(
      `❌ Exercise error for ${jid}:`,
      error.message
    );

  }

  finally {

    exerciseGenerating[jid] = false;

  }

}


// ============================================================
// SEND EXERCISES TO ALL GROUPS
// ============================================================

async function sendExercisesToAllGroups() {

  if (!sock) {

    console.log(
      "⏭️ Cannot send exercises - WhatsApp not connected."
    );

    return;

  }


  console.log("");
  console.log(
    "⏰ Automatic exercise cycle..."
  );


  for (
    const jid of ALLOWED_GROUPS
  ) {

    await sendAIExercise(jid);

  }

}


// ============================================================
// START AUTOMATIC EXERCISES
// ============================================================

function startExerciseTimer() {

  if (exerciseTimer) {

    console.log(
      "⏭️ Exercise timer already running."
    );

    return;

  }


  console.log("");
  console.log(
    "⏰ Automatic exercises started."
  );

  console.log(
    "⏰ Interval: every 1 minute."
  );


  exerciseTimer =
    setInterval(
      async () => {

        await sendExercisesToAllGroups();

      },
      EXERCISE_INTERVAL
    );

}


// ============================================================
// ANSWER EXERCISE
// ============================================================

async function handleExerciseAnswer(
  jid,
  msg,
  text
) {

  if (
    !activeExercises[jid]
  ) {

    return false;

  }


  if (
    !/^[1-3]$/.test(text)
  ) {

    return false;

  }


  const userId =
    getUserId(msg);

  const userName =
    getUserName(msg);


  if (
    !answeredUsers[jid]
  ) {

    answeredUsers[jid] =
      new Set();

  }


  // الشخص أجاب مسبقاً
  if (
    answeredUsers[jid].has(userId)
  ) {

    await sock.sendMessage(
      jid,
      {
        text:
          `ℹ️ ${userName}، لقد أجبت على هذا التمرين بالفعل.`
      }
    );

    return true;

  }


  answeredUsers[jid].add(userId);


  const selected =
    Number(text);

  const exercise =
    activeExercises[jid];

  const score =
    getScore(userId);


  score.exercises += 1;


  if (
    selected === exercise.answer
  ) {

    score.points += 10;
    score.correct += 1;


    await sock.sendMessage(
      jid,
      {
        text:
          "✅ *إجابة صحيحة!* 🎉\n\n" +

          "⭐ +10 XP\n\n" +

          `👤 ${userName}\n` +

          `⭐ نقاطك: ${score.points} XP\n` +

          `🎯 مستواك: ${getLevel(score.points)}\n\n` +

          `📚 ${exercise.explanation}`
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

          `👤 ${userName}\n\n` +

          `الإجابة الصحيحة هي: *${exercise.answer}*️⃣\n\n` +

          `⭐ نقاطك: ${score.points} XP\n` +

          `🎯 مستواك: ${getLevel(score.points)}\n\n` +

          `📚 ${exercise.explanation}`
      }
    );

  }


  return true;

}


// ============================================================
// POINTS
// ============================================================

async function sendPoints(
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
        "⭐ *German B1 Bot - نقاطك*\n\n" +

        `👤 ${name}\n\n` +

        `⭐ XP: ${score.points}\n` +

        `🎯 المستوى: ${getLevel(score.points)}\n\n` +

        `✅ صحيحة: ${score.correct}\n` +

        `❌ خاطئة: ${score.wrong}\n\n` +

        `📝 التمارين: ${score.exercises}`
    }
  );

}


// ============================================================
// RANKING
// ============================================================

async function sendRanking(jid) {

  const users =
    Object.entries(scores);


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
          : `${index + 1}.`;


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


// ============================================================
// HELP
// ============================================================

async function sendHelp(jid) {

  await sock.sendMessage(
    jid,
    {
      text:
        "🇩🇪🤖 *German B1 AI Bot*\n\n" +

        "🧠 الذكاء الاصطناعي:\n" +
        "اكتب `$` قبل السؤال.\n\n" +

        "مثال:\n" +
        "$Was bedeutet laufen?\n\n" +

        "📝 الأوامر:\n\n" +

        "!exercise\n" +
        "طلب تمرين AI فوراً.\n\n" +

        "!points\n" +
        "عرض نقاطك ومستواك.\n\n" +

        "!rank\n" +
        "عرض ترتيب الأعضاء.\n\n" +

        "!help\n" +
        "عرض المساعدة.\n\n" +

        "⏰ يتم إرسال تمرين تلقائياً كل دقيقة.\n\n" +

        "💡 الرسائل العادية بدون $ لا يتم الرد عليها."
    }
  );

}


// ============================================================
// MESSAGE TEXT
// ============================================================

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


// ============================================================
// HANDLE MESSAGE
// ============================================================

async function handleMessage(msg) {

  if (!msg) return;

  if (!msg.message) return;

  if (msg.key.fromMe) return;


  const jid =
    msg.key.remoteJid;


  if (!jid) return;


  // مجموعات فقط
  if (
    !jid.endsWith("@g.us")
  ) {

    return;

  }


  // فقط المجموعتان
  if (
    !ALLOWED_GROUPS.includes(jid)
  ) {

    return;

  }


  const text =
    getMessageText(msg)
      .trim();


  if (!text) return;


  console.log("");
  console.log(
    "📩 GROUP MESSAGE:",
    text
  );


  const lower =
    text.toLowerCase();


  // ==========================================================
  // COMMANDS
  // ==========================================================

  if (
    lower === "!help"
  ) {

    await sendHelp(jid);

    return;

  }


  if (
    lower === "!points"
  ) {

    await sendPoints(
      jid,
      msg
    );

    return;

  }


  if (
    lower === "!rank"
  ) {

    await sendRanking(jid);

    return;

  }


  // ==========================================================
  // MANUAL AI EXERCISE
  // ==========================================================

  if (
    lower === "!exercise"
  ) {

    await sendAIExercise(jid);

    return;

  }


  // ==========================================================
  // EXERCISE ANSWER
  // ==========================================================

  if (
    /^[1-3]$/.test(text)
  ) {

    const handled =
      await handleExerciseAnswer(
        jid,
        msg,
        text
      );


    if (handled) {

      return;

    }

  }


  // ==========================================================
  // AI ONLY WITH $
  // ==========================================================

  if (
    !text.startsWith("$")
  ) {

    console.log(
      "⏭️ Ignored - no $"
    );

    return;

  }


  const question =
    text
      .slice(1)
      .trim();


  if (!question) {

    return;

  }


  console.log(
    "🤖 Sending to AI:",
    question
  );


  try {

    const answer =
      await askAI(question);


    await sock.sendMessage(
      jid,
      {
        text:
          "🇩🇪🤖 *German B1 AI*\n\n" +
          answer
      }
    );


    console.log(
      "✅ AI reply sent."
    );

  }

  catch (error) {

    console.log(
      "❌ AI ERROR:",
      error.message
    );


    await sock.sendMessage(
      jid,
      {
        text:
          "❌ حدث خطأ في الذكاء الاصطناعي.\nحاول مرة أخرى."
      }
    );

  }

}


// ============================================================
// START WHATSAPP
// ============================================================

async function startBot() {

  // منع تشغيل startBot مرتين
  if (startingBot) {

    console.log(
      "⏭️ Bot is already starting."
    );

    return;

  }


  startingBot = true;


  try {

    console.log("");
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


    sock =
      makeWASocket({

        auth: state,

        logger:
          pino({
            level: "silent"
          }),

        browser:
          Browsers.macOS("Chrome"),

        markOnlineOnConnect:
          false,

        syncFullHistory:
          false

      });


    // حفظ بيانات الجلسة
    sock.ev.on(
      "creds.update",
      saveCreds
    );


    // ========================================================
    // CONNECTION
    // ========================================================

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

          startingBot = false;


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
            "⏰ AUTO EXERCISE EVERY 1 MINUTE!"
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


          console.log("");
          console.log(
            "👥 GROUPS ALLOWED:",
            ALLOWED_GROUPS.length
          );


          for (
            const group of ALLOWED_GROUPS
          ) {

            console.log(
              "👥",
              group
            );

          }


          // تشغيل مؤقت واحد فقط
          startExerciseTimer();

        }


        if (
          connection === "close"
        ) {

          startingBot = false;


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

            else {

              code =
                lastDisconnect
                  ?.error
                  ?.output
                  ?.statusCode ||
                0;

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


          // ====================================================
          // REAL LOGOUT
          // ====================================================

          if (
            code ===
            DisconnectReason.loggedOut
          ) {

            console.log("");
            console.log(
              "🚨 WhatsApp logged out."
            );

            console.log(
              "🚨 Pair WhatsApp again."
            );

            sock = null;

            return;

          }


          // ====================================================
          // OTHER DISCONNECTS
          // ====================================================

          console.log(
            "🔄 Reconnecting in 5 seconds..."
          );


          // إغلاق الـ socket القديم
          try {

            if (sock) {

              sock.ev.removeAllListeners();

            }

          }

          catch (e) {

            console.log(
              "⚠️ Could not clean old socket."
            );

          }


          sock = null;


          setTimeout(
            () => {

              startBot();

            },
            5000
          );

        }

      }
    );


    // ========================================================
    // MESSAGES
    // ========================================================

    sock.ev.on(
      "messages.upsert",
      async ({ messages }) => {

        for (
          const msg of messages
        ) {

          try {

            await handleMessage(msg);

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


    // ========================================================
    // PAIRING
    // ========================================================

    if (
      !state.creds.registered
    ) {

      const phoneNumber =
        process.env.WHATSAPP_NUMBER;


      if (!phoneNumber) {

        console.log(
          "❌ WHATSAPP_NUMBER is missing in Render."
        );

        startingBot = false;

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

      }

      catch (error) {

        console.log(
          "❌ Pairing error:",
          error.message
        );

      }

    }

  }

  catch (error) {

    startingBot = false;

    console.log(
      "❌ BOT START ERROR:",
      error.message
    );


    sock = null;


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


// ============================================================
// START
// ============================================================

startBot();
