const express = require("express");
const pino = require("pino");
const fs = require("fs");

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  Browsers,
  makeInMemoryStore,
  getAggregateVotesInPollMessage
} = require("@whiskeysockets/baileys");

const { Boom } = require("@hapi/boom");

// ==================================================
// SERVER
// ==================================================

const app = express();

const PORT =
  process.env.PORT || 10000;

app.get("/", (req, res) => {

  res.send(
    "🇩🇪 German B1 AI Bot is running!"
  );

});

app.listen(PORT, () => {

  console.log(
    `🌐 Server started on port ${PORT}`
  );

});

// ==================================================
// SETTINGS
// ==================================================

const ALLOWED_GROUPS = [
  "120363410722950290@g.us"
];

const CONTENT_INTERVAL =
  60 * 1000;

// نقاط الإجابة الصحيحة
const CORRECT_POINTS = 10;

// ==================================================
// GLOBAL
// ==================================================

let globalSock = null;

let automaticContentStarted = false;

// ==================================================
// CONTENT TYPES
// ==================================================

const CONTENT_TYPES = [
  "dialogue",
  "word",
  "grammar",
  "verbs",
  "situation"
];

let contentIndex = 0;

// ==================================================
// TOPICS
// ==================================================

const TOPICS = [

  "في السوبرماركت",
  "في المقهى",
  "في المطعم",
  "في العمل",
  "مقابلة عمل",
  "في محطة القطار",
  "في الحافلة",
  "في الفندق",
  "في البنك",
  "في البريد",
  "شراء الملابس",
  "عند الطبيب",
  "حجز موعد",
  "السؤال عن الطريق",
  "استئجار شقة",
  "التحدث مع الجيران",
  "التسوق",
  "المطار",
  "السيارة وتصليحها",
  "مكالمة هاتفية",
  "التحدث مع صديق",
  "الحياة اليومية",
  "الدراسة",
  "الجامعة",
  "العمل في المكتب"

];

// ==================================================
// RANDOM TOPIC
// ==================================================

function getRandomTopic() {

  return TOPICS[
    Math.floor(
      Math.random() *
      TOPICS.length
    )
  ];

}

// ==================================================
// NEXT CONTENT
// ==================================================

function getNextContentType() {

  const type =
    CONTENT_TYPES[
      contentIndex %
      CONTENT_TYPES.length
    ];

  contentIndex++;

  return type;

}

// ==================================================
// POINTS SYSTEM
// ==================================================

const POINTS_FILE =
  "./points.json";

let points = {};

try {

  if (
    fs.existsSync(
      POINTS_FILE
    )
  ) {

    points =
      JSON.parse(
        fs.readFileSync(
          POINTS_FILE,
          "utf8"
        )
      );

  }

} catch (error) {

  console.log(
    "⚠️ Could not load points.json"
  );

  points = {};

}

// ==================================================
// SAVE POINTS
// ==================================================

function savePoints() {

  try {

    fs.writeFileSync(
      POINTS_FILE,
      JSON.stringify(
        points,
        null,
        2
      )
    );

  } catch (error) {

    console.log(
      "❌ Could not save points:",
      error.message
    );

  }

}

// ==================================================
// GET USER DATA
// ==================================================

function getUserData(
  jid,
  name = "Unknown"
) {

  if (!jid) {

    return {
      name: "Unknown",
      points: 0
    };

  }

  // مستخدم جديد
  if (!points[jid]) {

    points[jid] = {

      name:
        name || "Unknown",

      points: 0

    };

  }

  // دعم البيانات القديمة
  if (
    typeof points[jid] ===
    "number"
  ) {

    points[jid] = {

      name:
        name || "Unknown",

      points:
        points[jid]

    };

  }

  // تحديث الاسم
  if (
    name &&
    name !== "Unknown"
  ) {

    points[jid].name =
      name;

  }

  return points[jid];

}

// ==================================================
// GET POINTS
// ==================================================

function getUserPoints(
  jid,
  name = "Unknown"
) {

  const user =
    getUserData(
      jid,
      name
    );

  return user.points;

}

// ==================================================
// ADD POINTS
// ==================================================

function addPoints(
  jid,
  amount,
  name = "Unknown"
) {

  const user =
    getUserData(
      jid,
      name
    );

  user.points += amount;

  if (
    name &&
    name !== "Unknown"
  ) {

    user.name =
      name;

  }

  savePoints();

  return user.points;

}

// ==================================================
// POLL STORAGE
// ==================================================

/*
  pollId ->

  {
    groupJid,
    correctAnswer,
    question,
    options,
    createdAt
  }
*/

const activePolls =
  new Map();

/*
  pollId -> Set of users
  الذين أخذوا النقاط بالفعل
*/

const answeredPolls =
  new Map();

// ==================================================
// BAILEYS STORE
// ==================================================

const store =
  makeInMemoryStore({

    logger:
      pino({
        level: "silent"
      })

  });

try {

  if (
    fs.existsSync(
      "./baileys_store.json"
    )
  ) {

    store.readFromFile(
      "./baileys_store.json"
    );

  }

} catch (error) {

  console.log(
    "⚠️ Could not load Baileys store."
  );

}

setInterval(
  () => {

    try {

      store.writeToFile(
        "./baileys_store.json"
      );

    } catch (error) {

      console.log(
        "⚠️ Store save error:",
        error.message
      );

    }

  },
  10000
);

// ==================================================
// GET MESSAGE FROM STORE
// ==================================================

async function getMessage(key) {

  try {

    const message =
      await store.loadMessage(
        key.remoteJid,
        key.id
      );

    return message?.message;

  } catch (error) {

    console.log(
      "⚠️ Could not load message:",
      error.message
    );

    return undefined;

  }

}

// ==================================================
// GET WHATSAPP NAME
// ==================================================

async function getWhatsAppName(
  sock,
  groupJid,
  userJid
) {

  try {

    // أولاً نحاول من أعضاء المجموعة
    const metadata =
      await sock.groupMetadata(
        groupJid
      );

    const participant =
      metadata.participants.find(
        p =>
          p.id === userJid ||
          p.jid === userJid ||
          p.lid === userJid
      );

    if (
      participant?.notify
    ) {

      return participant.notify;

    }

    if (
      participant?.name
    ) {

      return participant.name;

    }

    if (
      participant?.verifiedName
    ) {

      return participant.verifiedName;

    }

  } catch (error) {

    console.log(
      "⚠️ Could not get group member name:",
      error.message
    );

  }

  // اسم بديل
  return (
    userJid
      ?.split("@")[0] ||
    "Unknown"
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
      "GROQ_API_KEY is missing."
    );

  }

  console.log(
    "🧠 Sending request to Groq..."
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

        body:
          JSON.stringify({

            model:
              "openai/gpt-oss-20b",

            instructions: `

أنت مدرس لغة ألمانية متخصص في مستوى B1.

إذا كان السؤال من المستخدم سؤالاً عادياً:
أجب عنه بشكل طبيعي ومختصر بالعربية والألمانية عند الحاجة.

إذا كان المطلوب إنشاء محتوى تعليمي، اتبع الصيغة المحددة أدناه.

القواعد:

1. استخدم مستوى B1.
2. لا تستخدم شرحاً طويلاً.
3. لا تكرر نفس الموضوع باستمرار.
4. اجعل المحتوى عملياً من الحياة اليومية.
5. استخدم الألمانية للمحتوى.
6. استخدم العربية للترجمة أو الشرح.
7. لا تضف مقدمات طويلة.
8. لا تستخدم Markdown tables.
9. إذا كان النوع يحتاج Poll يجب أن يكون هناك 3 اختيارات فقط.
10. يجب أن تكون إجابة Poll واحدة صحيحة فقط.

أنواع المحتوى:

DIALOGUE:

حوار B1 قصير من 4 إلى 6 أسطر.
ثم سؤال فهم.
3 اختيارات.

WORD:

كلمة ألمانية B1.
معناها.
مثال.
ترجمة المثال.

GRAMMAR:

قاعدة B1 واحدة.
شرح قصير.
مثال.
ترجمة.

VERBS:

5 أفعال B1.
Infinitiv
Präteritum
Perfekt
المعنى.

SITUATION:

موقف عملي B1.
4 إلى 6 أسطر.
ثم سؤال.
3 اختيارات.

إذا كان DIALOGUE أو SITUATION:

TYPE:
DIALOGUE

TITLE:
عنوان قصير

CONTENT:
المحتوى

QUESTION:
السؤال

OPTION1:
الاختيار الأول

OPTION2:
الاختيار الثاني

OPTION3:
الاختيار الثالث

ANSWER:
1

إذا كان WORD:

TYPE:
WORD

WORD:
الكلمة

TRANSLATION:
الترجمة

EXAMPLE:
الجملة

EXAMPLE_TRANSLATION:
الترجمة

إذا كان GRAMMAR:

TYPE:
GRAMMAR

TITLE:
اسم القاعدة

EXPLANATION:
شرح قصير

EXAMPLE:
مثال

TRANSLATION:
الترجمة

إذا كان VERBS:

TYPE:
VERBS

VERB1:
الفعل | Präteritum | Perfekt | المعنى

VERB2:
الفعل | Präteritum | Perfekt | المعنى

VERB3:
الفعل | Präteritum | Perfekt | المعنى

VERB4:
الفعل | Präteritum | Perfekt | المعنى

VERB5:
الفعل | Präteritum | Perfekt | المعنى

لا تضف كلاماً خارج الصيغة عندما يطلب منك إنشاء محتوى تعليمي.

`,

            input:
              question

          })

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
    Array.isArray(
      data.output
    )
  ) {

    for (
      const item
      of data.output
    ) {

      if (
        item?.type ===
          "message" &&
        Array.isArray(
          item.content
        )
      ) {

        for (
          const content
          of item.content
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

      if (answer)
        break;

    }

  }

  if (!answer) {

    throw new Error(
      "Groq returned empty answer."
    );

  }

  console.log(
    "🤖 AI content generated."
  );

  return answer;

}

// ==================================================
// FIELD PARSER
// ==================================================

function getField(
  text,
  field,
  nextFields = []
) {

  let endPattern =
    nextFields.length
      ? `(?=\\n(?:${nextFields.join("|")}):)`
      : "$";

  const regex =
    new RegExp(
      `${field}:\\s*([\\s\\S]*?)${endPattern}`,
      "i"
    );

  const match =
    text.match(regex);

  return match
    ? match[1].trim()
    : "";

}

// ==================================================
// PARSE POLL
// ==================================================

function parsePollContent(
  text
) {

  const type =
    getField(
      text,
      "TYPE",
      [
        "TITLE",
        "CONTENT"
      ]
    );

  const title =
    getField(
      text,
      "TITLE",
      [
        "CONTENT"
      ]
    );

  const content =
    getField(
      text,
      "CONTENT",
      [
        "QUESTION"
      ]
    );

  const question =
    getField(
      text,
      "QUESTION",
      [
        "OPTION1"
      ]
    );

  const option1 =
    getField(
      text,
      "OPTION1",
      [
        "OPTION2"
      ]
    );

  const option2 =
    getField(
      text,
      "OPTION2",
      [
        "OPTION3"
      ]
    );

  const option3 =
    getField(
      text,
      "OPTION3",
      [
        "ANSWER"
      ]
    );

  const answer =
    getField(
      text,
      "ANSWER"
    );

  if (
    !type ||
    !content ||
    !question ||
    !option1 ||
    !option2 ||
    !option3 ||
    !/^[123]$/.test(
      answer
    )
  ) {

    console.log(
      "❌ Poll parsing failed:"
    );

    console.log(text);

    return null;

  }

  return {

    type,

    title,

    content,

    question,

    options: [

      option1,

      option2,

      option3

    ],

    answer:
      Number(answer)

  };

}

// ==================================================
// PARSE WORD
// ==================================================

function parseWord(
  text
) {

  const word =
    getField(
      text,
      "WORD",
      [
        "TRANSLATION"
      ]
    );

  const translation =
    getField(
      text,
      "TRANSLATION",
      [
        "EXAMPLE"
      ]
    );

  const example =
    getField(
      text,
      "EXAMPLE",
      [
        "EXAMPLE_TRANSLATION"
      ]
    );

  const exampleTranslation =
    getField(
      text,
      "EXAMPLE_TRANSLATION"
    );

  if (
    !word ||
    !translation ||
    !example ||
    !exampleTranslation
  ) {

    return null;

  }

  return {

    word,

    translation,

    example,

    exampleTranslation

  };

}

// ==================================================
// PARSE GRAMMAR
// ==================================================

function parseGrammar(
  text
) {

  const title =
    getField(
      text,
      "TITLE",
      [
        "EXPLANATION"
      ]
    );

  const explanation =
    getField(
      text,
      "EXPLANATION",
      [
        "EXAMPLE"
      ]
    );

  const example =
    getField(
      text,
      "EXAMPLE",
      [
        "TRANSLATION"
      ]
    );

  const translation =
    getField(
      text,
      "TRANSLATION"
    );

  if (
    !title ||
    !explanation ||
    !example ||
    !translation
  ) {

    return null;

  }

  return {

    title,

    explanation,

    example,

    translation

  };

}

// ==================================================
// PARSE VERBS
// ==================================================

function parseVerbs(
  text
) {

  const verbs = [];

  for (
    let i = 1;
    i <= 5;
    i++
  ) {

    const next =
      i < 5
        ? [
            `VERB${i + 1}`
          ]
        : [];

    const value =
      getField(
        text,
        `VERB${i}`,
        next
      );

    if (value) {

      verbs.push(
        value
      );

    }

  }

  if (
    verbs.length !== 5
  ) {

    return null;

  }

  return verbs;

}

// ==================================================
// GENERATE CONTENT
// ==================================================

async function generateContent() {

  const type =
    getNextContentType();

  const topic =
    getRandomTopic();

  console.log(
    `🎯 Content type: ${type}`
  );

  console.log(
    `📚 Topic: ${topic}`
  );

  let instruction = "";

  if (
    type === "dialogue"
  ) {

    instruction = `

النوع: DIALOGUE

الموضوع:
${topic}

أنشئ حواراً طبيعياً بمستوى B1.

الحوار 4 إلى 6 أسطر فقط.

بعده سؤال فهم واحد
و3 اختيارات.

`;

  }

  else if (
    type === "word"
  ) {

    instruction = `

النوع: WORD

اختر كلمة B1 مرتبطة بالحياة اليومية.

كلمة واحدة فقط
مع مثال واحد.

`;

  }

  else if (
    type === "grammar"
  ) {

    instruction = `

النوع: GRAMMAR

اختر قاعدة B1 واحدة.

اشرحها باختصار شديد.

مثال واحد فقط.

`;

  }

  else if (
    type === "verbs"
  ) {

    instruction = `

النوع: VERBS

اختر 5 أفعال B1 مختلفة ومفيدة.

لكل فعل:

Infinitiv
Präteritum
Perfekt
المعنى بالعربية.

لا تكتب أمثلة.

`;

  }

  else if (
    type === "situation"
  ) {

    instruction = `

النوع: SITUATION

الموضوع:
${topic}

أنشئ موقفاً عملياً قصيراً بمستوى B1.

4 إلى 6 أسطر.

بعده سؤال فهم واحد
و3 اختيارات.

`;

  }

  const response =
    await askAI(
      instruction
    );

  return {

    type,

    response

  };

}

// ==================================================
// SEND POLL
// ==================================================

async function sendPollContent(
  sock,
  jid,
  data
) {

  const parsed =
    parsePollContent(
      data.response
    );

  if (!parsed) {

    console.log(
      "❌ Invalid poll content."
    );

    return;

  }

  const messageText =

    "🇩🇪💬 *" +
    parsed.title +
    "*\n\n" +

    parsed.content +
    "\n\n" +

    "❓ *" +
    parsed.question +
    "*";

  const pollMessage = {

    poll: {

      name:
        messageText,

      values: [

        `1️⃣ ${parsed.options[0]}`,

        `2️⃣ ${parsed.options[1]}`,

        `3️⃣ ${parsed.options[2]}`

      ],

      selectableCount: 1

    }

  };

  const sentPoll =
    await sock.sendMessage(
      jid,
      pollMessage
    );

  if (
    sentPoll?.key?.id
  ) {

    const pollId =
      sentPoll.key.id;

    activePolls.set(
      pollId,
      {

        groupJid:
          jid,

        correctAnswer:
          parsed.answer,

        question:
          parsed.question,

        options:
          parsed.options,

        createdAt:
          Date.now()

      }
    );

    answeredPolls.set(
      pollId,
      new Set()
    );

    console.log(
      "📝 Poll registered:",
      pollId
    );

    console.log(
      "✅ Correct answer:",
      parsed.answer
    );

  }

  console.log(
    "✅ Poll sent."
  );

}

// ==================================================
// SEND WORD
// ==================================================

async function sendWord(
  sock,
  jid,
  data
) {

  const parsed =
    parseWord(
      data.response
    );

  if (!parsed) {

    console.log(
      "❌ Invalid word content."
    );

    return;

  }

  const message =

    "🧠🇩🇪 *Wort des Tages*\n\n" +

    "🇩🇪 *" +
    parsed.word +
    "*\n" +

    "🇸🇦 " +
    parsed.translation +
    "\n\n" +

    "📝 " +
    parsed.example +
    "\n" +

    "🇸🇦 " +
    parsed.exampleTranslation;

  await sock.sendMessage(
    jid,
    {
      text:
        message
    }
  );

  console.log(
    "✅ Word sent."
  );

}

// ==================================================
// SEND GRAMMAR
// ==================================================

async function sendGrammar(
  sock,
  jid,
  data
) {

  const parsed =
    parseGrammar(
      data.response
    );

  if (!parsed) {

    console.log(
      "❌ Invalid grammar content."
    );

    return;

  }

  const message =

    "📚🇩🇪 *B1 Grammatik*\n\n" +

    "🔹 *" +
    parsed.title +
    "*\n\n" +

    parsed.explanation +
    "\n\n" +

    "📝 " +
    parsed.example +
    "\n" +

    "🇸🇦 " +
    parsed.translation;

  await sock.sendMessage(
    jid,
    {
      text:
        message
    }
  );

  console.log(
    "✅ Grammar sent."
  );

}

// ==================================================
// SEND VERBS
// ==================================================

async function sendVerbs(
  sock,
  jid,
  data
) {

  const verbs =
    parseVerbs(
      data.response
    );

  if (!verbs) {

    console.log(
      "❌ Invalid verbs content."
    );

    return;

  }

  let message =

    "🔥🇩🇪 *5 wichtige B1 Verben*\n\n";

  verbs.forEach(
    (verb, index) => {

      message +=
        `${index + 1}️⃣ ${verb}\n`;

    }
  );

  message +=
    "\n📌 Infinitiv → Präteritum → Perfekt → المعنى";

  await sock.sendMessage(
    jid,
    {
      text:
        message
    }
  );

  console.log(
    "✅ Verbs sent."
  );

}

// ==================================================
// SEND CONTENT
// ==================================================

async function sendContent(
  sock,
  jid
) {

  if (
    !ALLOWED_GROUPS.includes(
      jid
    )
  ) {

    return;

  }

  try {

    console.log(
      "======================================"
    );

    console.log(
      "📚 Creating new B1 content..."
    );

    const data =
      await generateContent();

    if (
      data.type ===
        "dialogue" ||
      data.type ===
        "situation"
    ) {

      await sendPollContent(
        sock,
        jid,
        data
      );

    }

    else if (
      data.type ===
      "word"
    ) {

      await sendWord(
        sock,
        jid,
        data
      );

    }

    else if (
      data.type ===
      "grammar"
    ) {

      await sendGrammar(
        sock,
        jid,
        data
      );

    }

    else if (
      data.type ===
      "verbs"
    ) {

      await sendVerbs(
        sock,
        jid,
        data
      );

    }

    console.log(
      "======================================"
    );

  }

  catch (error) {

    console.log(
      "❌ Content error:",
      error.message
    );

  }

}

// ==================================================
// MESSAGE TEXT
// ==================================================

function getMessageText(
  msg
) {

  if (
    msg.message?.conversation
  ) {

    return (
      msg.message.conversation
    );

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
      "🚀 Starting German B1 AI Bot..."
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
          false,

        // مهم جداً للـPoll
        getMessage:
          async (key) => {

            return await getMessage(
              key
            );

          }

      });

    // ربط التخزين بالـSocket
    store.bind(
      sock.ev
    );

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
            "🔄 Connecting..."
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
            "🇩🇪 B1 AI EDUCATION BOT READY!"
          );

          console.log(
            "🏆 POINT SYSTEM READY!"
          );

          console.log(
            "💬 Dialogues"
          );

          console.log(
            "🧠 Vocabulary"
          );

          console.log(
            "📚 Grammar"
          );

          console.log(
            "🔥 Verbs"
          );

          console.log(
            "📝 Polls"
          );

          console.log(
            "🏆 +10 points for correct answers"
          );

          console.log(
            "⏱️ Every 1 minute"
          );

          console.log(
            "======================================"
          );

          console.log("");

          // لا نشغل interval أكثر من مرة
          if (
            !automaticContentStarted
          ) {

            automaticContentStarted =
              true;

            setInterval(
              async () => {

                if (
                  !globalSock
                ) {

                  return;

                }

                for (
                  const groupId
                  of ALLOWED_GROUPS
                ) {

                  try {

                    await sendContent(
                      globalSock,
                      groupId
                    );

                  }

                  catch (
                    error
                  ) {

                    console.log(
                      "❌ Automatic content error:",
                      error.message
                    );

                  }

                }

              },
              CONTENT_INTERVAL
            );

          }

        }

        if (
          connection ===
          "close"
        ) {

          let code = 0;

          try {

            if (
              lastDisconnect
                ?.error instanceof
                Boom
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
    // POLL VOTES
    // ==================================================

    sock.ev.on(
      "messages.update",
      async (updates) => {

        for (
          const {
            key,
            update
          }
          of updates
        ) {

          try {

            if (
              !update?.pollUpdates
            ) {

              continue;

            }

            const pollId =
              key?.id;

            if (!pollId) {

              continue;

            }

            const pollInfo =
              activePolls.get(
                pollId
              );

            if (!pollInfo) {

              console.log(
                "⚠️ Poll not registered:",
                pollId
              );

              continue;

            }

            // الرسالة الأصلية
            const pollCreation =
              await getMessage(
                key
              );

            if (!pollCreation) {

              console.log(
                "⚠️ Original poll message not found:",
                pollId
              );

              continue;

            }

            // فك التصويت
            const votes =
              getAggregateVotesInPollMessage({

                message:
                  pollCreation,

                pollUpdates:
                  update.pollUpdates

              });

            console.log(
              "📊 Poll aggregation:",
              JSON.stringify(
                votes,
                null,
                2
              )
            );

            let answered =
              answeredPolls.get(
                pollId
              );

            if (!answered) {

              answered =
                new Set();

              answeredPolls.set(
                pollId,
                answered
              );

            }

            // كل اختيار
            for (
              let i = 0;
              i < votes.length;
              i++
            ) {

              const vote =
                votes[i];

              if (
                !vote?.voters ||
                vote.voters.length === 0
              ) {

                continue;

              }

              const selectedOption =
                i + 1;

              // كل شخص اختار هذا الخيار
              for (
                const userJid
                of vote.voters
              ) {

                if (!userJid) {

                  continue;

                }

                // لا تعطي نقاطاً مرتين
                if (
                  answered.has(
                    userJid
                  )
                ) {

                  continue;

                }

                answered.add(
                  userJid
                );

                // الاسم
                const userName =
                  await getWhatsAppName(
                    sock,
                    pollInfo.groupJid,
                    userJid
                  );

                // ==========================================
                // CORRECT
                // ==========================================

                if (
                  selectedOption ===
                  pollInfo.correctAnswer
                ) {

                  const total =
                    addPoints(
                      userJid,
                      CORRECT_POINTS,
                      userName
                    );

                  console.log(
                    `🏆 ${userName} +${CORRECT_POINTS} = ${total}`
                  );

                  await sock.sendMessage(
                    pollInfo.groupJid,
                    {

                      text:

                        "🎉🇩🇪 *Richtig!*\n\n" +

                        `👤 ${userName}\n` +

                        "✅ إجابة صحيحة!\n" +

                        `🏆 +${CORRECT_POINTS} نقاط\n\n` +

                        `⭐ مجموع نقاطك: ${total}`

                    }
                  );

                }

                // ==========================================
                // WRONG
                // ==========================================

                else {

                  console.log(
                    `❌ ${userName} answered incorrectly`
                  );

                  await sock.sendMessage(
                    pollInfo.groupJid,
                    {

                      text:

                        "❌🇩🇪 *Leider falsch!*\n\n" +

                        `👤 ${userName}\n` +

                        "لم تكن الإجابة صحيحة.\n" +

                        "💪 حاول في السؤال القادم!"

                    }
                  );

                }

              }

            }

          }

          catch (error) {

            console.log(
              "❌ Poll processing error:",
              error.message
            );

          }

        }

      }
    );

    // ==================================================
    // MESSAGES
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

            if (!msg)
              continue;

            if (!msg.message)
              continue;

            if (msg.key.fromMe)
              continue;

            const jid =
              msg.key.remoteJid;

            if (!jid)
              continue;

            // المجموعة فقط
            if (
              !jid.endsWith(
                "@g.us"
              )
            ) {

              continue;

            }

            const userJid =
              msg.key.participant ||
              msg.participant ||
              jid;

            const userName =
              msg.pushName ||
              "Unknown";

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

            // ==========================================
            // !TEST
            // ==========================================

            if (
              text.toLowerCase() ===
              "!test"
            ) {

              await sock.sendMessage(
                jid,
                {

                  text:

                    "🇩🇪🤖 German B1 AI Bot\n\n" +

                    "✅ البوت يعمل.\n" +

                    "🧠 Groq متصل.\n" +

                    "📚 نظام B1 يعمل.\n" +

                    "🏆 نظام النقاط يعمل."

                }
              );

              continue;

            }

            // ==========================================
            // !NOW
            // ==========================================

            if (
              text.toLowerCase() ===
              "!now"
            ) {

              if (
                ALLOWED_GROUPS.includes(
                  jid
                )
              ) {

                await sendContent(
                  sock,
                  jid
                );

              }

              continue;

            }

            // ==========================================
            // !POINT
            // ==========================================

            if (
              text.toLowerCase() ===
                "!point" ||
              text.toLowerCase() ===
                "!points"
            ) {

              const userPoints =
                getUserPoints(
                  userJid,
                  userName
                );

              await sock.sendMessage(
                jid,
                {

                  text:

                    "🏆🇩🇪 *نقاطك*\n\n" +

                    `👤 ${userName}\n` +

                    `⭐ ${userPoints} نقطة`

                }
              );

              continue;

            }

            // ==========================================
            // !TOP
            // ==========================================

            if (
              text.toLowerCase() ===
              "!top"
            ) {

              const ranking =
                Object.entries(
                  points
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
                ranking.length ===
                0
              ) {

                await sock.sendMessage(
                  jid,
                  {

                    text:
                      "🏆 لا توجد نقاط حتى الآن."

                  }
                );

                continue;

              }

              let message =
                "🏆🇩🇪 *B1 TOP PLAYERS*\n\n";

              ranking.forEach(
                (
                  [
                    playerJid,
                    user
                  ],
                  index
                ) => {

                  let medal;

                  if (
                    index === 0
                  ) {

                    medal =
                      "🥇";

                  }

                  else if (
                    index === 1
                  ) {

                    medal =
                      "🥈";

                  }

                  else if (
                    index === 2
                  ) {

                    medal =
                      "🥉";

                  }

                  else {

                    medal =
                      `${index + 1}.`;

                  }

                  const displayName =
                    user.name ||
                    playerJid
                      .split("@")[0];

                  message +=

                    `${medal} ${displayName} — ⭐ ${user.points}\n`;

                }
              );

              await sock.sendMessage(
                jid,
                {
                  text:
                    message
                }
              );

              continue;

            }

            // ==========================================
            // !RANK
            // ==========================================

            if (
              text.toLowerCase() ===
              "!rank"
            ) {

              const user =
                getUserData(
                  userJid,
                  userName
                );

              const ranking =
                Object.entries(
                  points
                )
                .sort(
                  (a, b) =>
                    b[1].points -
                    a[1].points
                );

              const position =
                ranking.findIndex(
                  ([playerJid]) =>
                    playerJid ===
                    userJid
                ) + 1;

              await sock.sendMessage(
                jid,
                {

                  text:

                    "📊🇩🇪 *ترتيبك*\n\n" +

                    `👤 ${user.name}\n` +

                    `⭐ النقاط: ${user.points}\n` +

                    `🏅 المركز: ${position}`

                }
              );

              savePoints();

              continue;

            }

            // ==========================================
            // !HELP
            // ==========================================

            if (
              text.toLowerCase() ===
              "!help"
            ) {

              await sock.sendMessage(
                jid,
                {

                  text:

                    "🇩🇪 *German B1 AI Bot*\n\n" +

                    "📚 المحتوى يصل تلقائياً.\n\n" +

                    "💬 حوارات B1\n" +

                    "🧠 كلمات وترجمة\n" +

                    "📚 قواعد قصيرة\n" +

                    "🔥 أفعال وتصريفاتها\n" +

                    "🛒 مواقف الحياة اليومية\n" +

                    "📝 Poll بثلاثة اختيارات\n\n" +

                    "🏆 *نظام النقاط*\n" +

                    "✅ الإجابة الصحيحة = +10 نقاط\n\n" +

                    "⚡ !point\n" +

                    "عرض نقاطك\n\n" +

                    "🏆 !top\n" +

                    "أفضل اللاعبين\n\n" +

                    "📊 !rank\n" +

                    "عرض ترتيبك\n\n" +

                    "⚡ !now\n" +

                    "إرسال محتوى الآن\n\n" +

                    "🤖 $سؤالك\n" +

                    "طرح سؤال على الذكاء الاصطناعي"

                }
              );

              continue;

            }

            // ==========================================
            // AI
            // ==========================================

            if (
              !text.startsWith("$")
            ) {

              continue;

            }

            const aiQuestion =
              text
                .slice(1)
                .trim();

            if (!aiQuestion)
              continue;

            console.log(
              "🤖 AI QUESTION:",
              aiQuestion
            );

            const answer =
              await askAI(
                `

السؤال من أحد أعضاء مجموعة ألمانية:

${aiQuestion}

إذا كان السؤال عادياً:
أجب عليه مباشرة وباختصار.

إذا كان السؤال متعلقاً بتعلم الألمانية:
أجب كمدرس ألمانية B1.

لا تحول السؤال إلى Poll إلا إذا طلب المستخدم ذلك صراحة.

`
              );

            await sock.sendMessage(
              jid,
              {

                text:

                  "🇩🇪🤖 *German B1 AI Bot*\n\n" +

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