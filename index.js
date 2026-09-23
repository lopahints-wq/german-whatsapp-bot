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
// SETTINGS
// ============================================================

// المجموعتان اللتان تريد البوت أن يعمل فيهما فقط
const ALLOWED_GROUPS = [
  "120363410722950290@g.us",
  "120363423888719176@g.us"
];

// كل كم دقيقة يرسل تمريناً تلقائياً
const EXERCISE_INTERVAL = 5 * 60 * 1000;


// ============================================================
// GLOBAL STATE
// ============================================================

const scores = {};
const activeExercises = {};

let sock = null;
let reconnectTimer = null;
let reconnecting = false;
let autoExerciseStarted = false;


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
// GROQ AI
// ============================================================

async function askAI(question) {

  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey) {
    throw new Error(
      "GROQ_API_KEY is missing in Render."
    );
  }

  console.log("🧠 Sending to Groq...");
  console.log("❓", question);

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
أنت مدرس لغة ألمانية محترف داخل مجموعة WhatsApp.

مهمتك مساعدة المستخدمين على تعلم الألمانية من A1 إلى B1.

القواعد:

- إذا كتب المستخدم جملة ألمانية:
صحح الجملة واشرح الخطأ بالعربية.

- إذا كتب كلمة ألمانية:
اشرح معناها وأعط مثالاً بالألمانية مع الترجمة.

- إذا كتب بالعربية وطلب ترجمة:
أعطه ترجمة ألمانية طبيعية.

- إذا سأل عن قاعدة:
اشرحها بالعربية بشكل بسيط مع أمثلة ألمانية.

- إذا طلب تمريناً:
أنشئ تمريناً مناسباً لمستواه.

- إذا طلب اختباراً:
أنشئ سؤالاً مناسباً.

- إذا كان السؤال عاماً:
أجب بشكل طبيعي.

استخدم العربية للشرح والألمانية للأمثلة.

لا تكن طويلاً جداً.

كن واضحاً وودوداً.
`,

        input: question

      })
    }
  );

  const data = await response.json();

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


// ============================================================
// CREATE AI EXERCISE
// ============================================================

async function createAIExercise() {

  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey) {
    throw new Error(
      "GROQ_API_KEY is missing."
    );
  }

  console.log("");
  console.log("======================================");
  console.log("🧠 Creating AI exercise...");
  console.log("======================================");

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
أنت مدرس لغة ألمانية.

أنشئ تمريناً واحداً في اللغة الألمانية.

المستوى يمكن أن يكون A1 أو A2 أو B1.

مهم جداً:

يجب أن يكون السؤال اختيار من متعدد.

يجب أن يحتوي على 3 اختيارات فقط.

يجب أن تكون إجابة واحدة صحيحة فقط.

يجب أن يكون السؤال مفيداً لتعلم الألمانية.

اكتب النتيجة بهذا الشكل EXACTLY:

LEVEL: A1

QUESTION:
🇩🇪 اختر الإجابة الصحيحة:

Das Auto ___ schnell.

OPTIONS:
1|fährt
2|fahren
3|fährst

ANSWER:
1

EXPLANATION:
شرح قصير بالعربية.

لا تضف أي شيء آخر.
`,

        input:
          "أنشئ تمريناً جديداً ومختلفاً."
      })
    }
  );

  const data = await response.json();

  console.log(
    "📦 Groq status:",
    response.status
  );

  if (!response.ok) {

    console.log(
      JSON.stringify(data, null, 2)
    );

    throw new Error(
      data?.error?.message ||
      "Groq exercise request failed."
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
      "AI exercise is empty."
    );
  }

  return parseExercise(text);
}


// ============================================================
// PARSE AI EXERCISE
// ============================================================

function parseExercise(text) {

  console.log("🤖 AI EXERCISE:");
  console.log(text);

  const levelMatch =
    text.match(
      /LEVEL:\s*(A1|A2|B1)/i
    );

  const questionMatch =
    text.match(
      /QUESTION:\s*([\s\S]*?)\s*OPTIONS:/i
    );

  const optionsMatch =
    text.match(
      /OPTIONS:\s*([\s\S]*?)\s*ANSWER:/i
    );

  const answerMatch =
    text.match(
      /ANSWER:\s*([123])/i
    );

  const explanationMatch =
    text.match(
      /EXPLANATION:\s*([\s\S]*)/i
    );


  if (
    !questionMatch ||
    !optionsMatch ||
    !answerMatch
  ) {

    throw new Error(
      "Could not parse AI exercise."
    );
  }


  const level =
    levelMatch
      ? levelMatch[1].toUpperCase()
      : "A1";


  const question =
    questionMatch[1].trim();


  const optionLines =
    optionsMatch[1]
      .split("\n")
      .map(x => x.trim())
      .filter(Boolean);


  const options = [];


  for (const line of optionLines) {

    const match =
      line.match(
        /^([123])\s*\|\s*(.+)$/
      );

    if (match) {

      options.push({
        number:
          Number(match[1]),

        text:
          match[2].trim()
      });

    }

  }


  if (options.length !== 3) {

    throw new Error(
      "AI did not return exactly 3 options."
    );
  }


  const answer =
    Number(answerMatch[1]);


  if (
    answer < 1 ||
    answer > 3
  ) {

    throw new Error(
      "Invalid AI answer."
    );
  }


  const explanation =
    explanationMatch
      ? explanationMatch[1].trim()
      : "";


  return {

    level,

    question,

    options,

    answer,

    explanation

  };
}


// ============================================================
// SEND AI EXERCISE
// ============================================================

async function sendAIExercise(jid) {

  if (!sock) {

    console.log(
      "⚠️ Cannot send exercise - socket unavailable."
    );

    return;
  }


  console.log(
    `📝 Creating exercise for ${jid}`
  );


  try {

    const exercise =
      await createAIExercise();


    activeExercises[jid] = exercise;


    let message =
      "📝🇩🇪 *German AI Exercise*\n\n";

    message +=
      `📚 المستوى: ${exercise.level}\n\n`;

    message +=
      `${exercise.question}\n\n`;

    message +=
      `1️⃣ ${exercise.options[0].text}\n`;

    message +=
      `2️⃣ ${exercise.options[1].text}\n`;

    message +=
      `3️⃣ ${exercise.options[2].text}\n\n`;

    message +=
      "💡 أرسل 1 أو 2 أو 3 فقط";


    await sock.sendMessage(
      jid,
      {
        text: message
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


// ============================================================
// SEND AUTOMATIC EXERCISES
// ============================================================

async function sendAutomaticExercises() {

  if (!sock) {

    console.log(
      "⏭️ Auto exercise skipped - no socket."
    );

    return;
  }


  console.log("");
  console.log(
    "⏰ Automatic exercise starting..."
  );


  for (
    const jid of ALLOWED_GROUPS
  ) {

    try {

      await sendAIExercise(jid);

    }

    catch (error) {

      console.log(
        `❌ Could not send to ${jid}:`,
        error.message
      );

    }

  }

}


// ============================================================
// START AUTO EXERCISES
// ============================================================

function startAutomaticExercises() {

  if (autoExerciseStarted) {

    console.log(
      "⏭️ Automatic exercises already running."
    );

    return;
  }


  autoExerciseStarted = true;


  console.log("");
  console.log(
    "⏰ Automatic exercises started."
  );

  console.log(
    "⏰ Interval: every 5 minutes."
  );

  console.log(
    `👥 Groups: ${ALLOWED_GROUPS.length}`
  );


  setInterval(
    async () => {

      await sendAutomaticExercises();

    },
    EXERCISE_INTERVAL
  );
}


// ============================================================
// HANDLE EXERCISE ANSWER
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
    !/^[123]$/.test(text)
  ) {

    return false;
  }


  const exercise =
    activeExercises[jid];


  const selected =
    Number(text);


  const userId =
    getUserId(msg);


  const score =
    getScore(userId);


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

          "⭐ +10 XP\n" +

          `⭐ نقاطك: ${score.points} XP\n` +

          `🎯 مستواك: ${getLevel(score.points)}`
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

          `الإجابة الصحيحة: ${exercise.answer}️⃣\n\n` +

          `${exercise.explanation}\n\n` +

          `⭐ نقاطك: ${score.points} XP\n` +

          `🎯 مستواك: ${getLevel(score.points)}`
      }
    );

  }


  delete activeExercises[jid];


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
        "⭐ *نقاطك في German Bot*\n\n" +

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
// RANK
// ============================================================

async function sendRank(jid) {

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
    users.slice(0, 10);


  let message =
    "🏆🇩🇪 *German Ranking*\n\n";


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


// ============================================================
// MANUAL EXERCISE
// ============================================================

async function manualExercise(jid, msg) {

  const userId =
    getUserId(msg);

  const score =
    getScore(userId);

  score.exercises += 1;


  await sendAIExercise(jid);
}


// ============================================================
// MESSAGE TEXT
// ============================================================

function getMessageText(msg) {

  if (!msg?.message) {
    return "";
  }


  if (
    msg.message.conversation
  ) {

    return msg.message.conversation;
  }


  if (
    msg.message.extendedTextMessage?.text
  ) {

    return (
      msg.message.extendedTextMessage.text
    );
  }


  if (
    msg.message.ephemeralMessage?.message
      ?.conversation
  ) {

    return (
      msg.message.ephemeralMessage
        .message.conversation
    );
  }


  if (
    msg.message.ephemeralMessage?.message
      ?.extendedTextMessage?.text
  ) {

    return (
      msg.message.ephemeralMessage
        .message
        .extendedTextMessage
        .text
    );
  }


  return "";
}


// ============================================================
// MESSAGE HANDLER
// ============================================================

async function handleMessage(msg) {

  if (!msg) return;

  if (!msg.message) return;

  if (msg.key.fromMe) return;


  const jid =
    msg.key.remoteJid;


  if (!jid) return;


  // المجموعات فقط
  if (
    !jid.endsWith("@g.us")
  ) {

    return;
  }


  // المجموعات المسموحة فقط
  if (
    !ALLOWED_GROUPS.includes(jid)
  ) {

    return;
  }


  const rawText =
    getMessageText(msg);


  const question =
    rawText.trim();


  if (!question) return;


  console.log("");
  console.log(
    "📩 GROUP MESSAGE:",
    question
  );


  // ==========================================================
  // COMMANDS
  // ==========================================================

  if (
    question.toLowerCase() ===
    "!test"
  ) {

    await sock.sendMessage(
      jid,
      {
        text:
          "🇩🇪🤖 German AI Bot\n\n" +

          "✅ البوت يعمل.\n" +

          "🧠 Groq AI متصل.\n" +

          "📝 تمارين AI مفعلة.\n" +

          "⏰ تمرين تلقائي كل 5 دقائق.\n" +

          "🏆 نظام النقاط يعمل."
      }
    );

    return;
  }


  if (
    question.toLowerCase() ===
    "!help"
  ) {

    await sock.sendMessage(
      jid,
      {
        text:
          "🇩🇪🤖 *German AI Bot*\n\n" +

          "📝 !exercise\n" +
          "تمرين AI جديد.\n\n" +

          "⭐ !points\n" +
          "نقاطك ومستواك.\n\n" +

          "🏆 !rank\n" +
          "عرض ترتيب الأعضاء.\n\n" +

          "💲 $سؤالك\n" +
          "اسأل الذكاء الاصطناعي.\n\n" +

          "مثال:\n" +
          "$Was bedeutet laufen?"
      }
    );

    return;
  }


  // ==========================================================
  // RANK
  // ==========================================================

  if (
    question.toLowerCase() ===
    "!rank"
  ) {

    await sendRank(jid);

    return;
  }


  // ==========================================================
  // POINTS
  // ==========================================================

  if (
    question.toLowerCase() ===
    "!points"
  ) {

    await sendPoints(
      jid,
      msg
    );

    return;
  }


  // ==========================================================
  // MANUAL EXERCISE
  // ==========================================================

  if (
    question.toLowerCase() ===
    "!exercise"
  ) {

    await manualExercise(
      jid,
      msg
    );

    return;
  }


  // ==========================================================
  // ANSWER 1 / 2 / 3
  // ==========================================================

  if (
    /^[123]$/.test(question)
  ) {

    const handled =
      await handleExerciseAnswer(
        jid,
        msg,
        question
      );


    if (handled) {

      return;
    }

  }


  // ==========================================================
  // AI ONLY WITH $
  // ==========================================================

  if (
    !question.startsWith("$")
  ) {

    console.log(
      "⏭️ Ignored - no $"
    );

    return;
  }


  const aiQuestion =
    question
      .slice(1)
      .trim();


  if (!aiQuestion) {

    return;
  }


  console.log(
    "🤖 Sending to AI..."
  );


  try {

    const answer =
      await askAI(
        aiQuestion
      );


    await sock.sendMessage(
      jid,
      {
        text:
          "🇩🇪🤖 *German AI Bot*\n\n" +
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
          "❌ حدث خطأ في الذكاء الاصطناعي.\n" +
          "حاول مرة أخرى."
      }
    );
  }
}


// ============================================================
// CONNECT TO WHATSAPP
// ============================================================

async function startBot() {

  // منع تشغيل Socket ثاني
  if (reconnecting) {

    console.log(
      "⏭️ Connection already in progress."
    );

    return;
  }


  reconnecting = true;


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

        logger: pino({
          level: "silent"
        }),

        browser:
          Browsers.macOS("Chrome"),

        markOnlineOnConnect:
          false,

        syncFullHistory:
          false,

        generateHighQualityLinkPreview:
          false

      });


    sock.ev.on(
      "creds.update",
      saveCreds
    );


    sock.ev.on(
      "messages.upsert",
      async ({ messages }) => {

        for (
          const msg of messages
        ) {

          try {

            await handleMessage(
              msg
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


    sock.ev.on(
      "connection.update",
      async (update) => {

        const {
          connection,
          lastDisconnect
        } = update;


        // ==================================================
        // CONNECTING
        // ==================================================

        if (
          connection === "connecting"
        ) {

          console.log(
            "🔄 Connecting to WhatsApp..."
          );

        }


        // ==================================================
        // OPEN
        // ==================================================

        if (
          connection === "open"
        ) {

          reconnecting = false;


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


          console.log("");
          console.log(
            `👥 GROUPS ALLOWED: ${ALLOWED_GROUPS.length}`
          );


          ALLOWED_GROUPS.forEach(
            (id) => {

              console.log(
                `👥 ${id}`
              );

            }
          );


          // تشغيل المؤقت مرة واحدة فقط
          startAutomaticExercises();

        }


        // ==================================================
        // CLOSE
        // ==================================================

        if (
          connection === "close"
        ) {

          reconnecting = false;


          let code = 0;


          try {

            const error =
              lastDisconnect?.error;


            if (error) {

              if (
                error instanceof Boom
              ) {

                code =
                  error.output?.statusCode ||
                  0;

              }

              else {

                code =
                  error?.output?.statusCode ||
                  error?.data?.statusCode ||
                  0;

              }

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


          // ==================================================
          // LOGGED OUT
          // ==================================================

          if (
            code ===
            DisconnectReason.loggedOut
          ) {

            console.log(
              "🚨 WhatsApp logged out."
            );

            console.log(
              "🚨 Pair WhatsApp again."
            );

            sock = null;

            return;
          }


          // ==================================================
          // CONNECTION CLOSED / RESTART REQUIRED
          // ==================================================

          if (
            !reconnectTimer
          ) {

            console.log(
              "🔄 Reconnecting in 5 seconds..."
            );


            reconnectTimer =
              setTimeout(
                async () => {

                  reconnectTimer =
                    null;

                  sock = null;

                  await startBot();

                },
                5000
              );

          }

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

        reconnecting = false;

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

  }

  catch (error) {

    reconnecting = false;

    console.log(
      "❌ BOT START ERROR:",
      error.message
    );


    if (!reconnectTimer) {

      reconnectTimer =
        setTimeout(
          async () => {

            reconnectTimer =
              null;

            sock = null;

            await startBot();

          },
          10000
        );

    }

  }

}


// ============================================================
// START
// ============================================================

startBot();
