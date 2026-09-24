const express = require("express");
const pino = require("pino");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  Browsers,
  decryptPollVote,
  getKeyAuthor,
  jidNormalizedUser
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

// كل دقيقة
const CONTENT_INTERVAL =
  60 * 1000;

// نقاط الإجابة الصحيحة
const POINTS_PER_CORRECT = 10;

// ==================================================
// FILE STORAGE
// ==================================================

const POINTS_FILE =
  path.join(
    __dirname,
    "points.json"
  );

const POLLS_FILE =
  path.join(
    __dirname,
    "polls.json"
  );

// ==================================================
// LOAD JSON
// ==================================================

function loadJSON(file, fallback) {

  try {

    if (
      !fs.existsSync(file)
    ) {

      fs.writeFileSync(
        file,
        JSON.stringify(
          fallback,
          null,
          2
        )
      );

      return fallback;

    }

    const data =
      fs.readFileSync(
        file,
        "utf8"
      );

    return JSON.parse(data);

  }

  catch (error) {

    console.log(
      "⚠️ JSON load error:",
      file,
      error.message
    );

    return fallback;

  }

}

// ==================================================
// SAVE JSON
// ==================================================

function saveJSON(file, data) {

  try {

    fs.writeFileSync(
      file,
      JSON.stringify(
        data,
        null,
        2
      )
    );

  }

  catch (error) {

    console.log(
      "❌ JSON save error:",
      file,
      error.message
    );

  }

}

// ==================================================
// DATA
// ==================================================

let points =
  loadJSON(
    POINTS_FILE,
    {}
  );

let polls =
  loadJSON(
    POLLS_FILE,
    {}
  );

// ==================================================
// SOCKET
// ==================================================

let globalSock = null;

let contentInterval = null;

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
// NEXT CONTENT TYPE
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
// SHA256
// ==================================================

function sha256(text) {

  return crypto
    .createHash("sha256")
    .update(
      Buffer.from(text)
    )
    .digest("hex");

}

// ==================================================
// POINTS SYSTEM
// ==================================================

function ensureUser(jid, name) {

  if (!points[jid]) {

    points[jid] = {

      points: 0,

      correct: 0,

      wrong: 0,

      name:
        name ||
        jid

    };

  }

  else if (
    name &&
    name !== jid
  ) {

    points[jid].name =
      name;

  }

}

// ==================================================
// ADD POINTS
// ==================================================

function addPoints(
  jid,
  name,
  amount
) {

  ensureUser(
    jid,
    name
  );

  points[jid].points +=
    amount;

  if (amount > 0) {

    points[jid].correct++;

  }

  else {

    points[jid].wrong++;

  }

  saveJSON(
    POINTS_FILE,
    points
  );

}

// ==================================================
// GET USER POINTS
// ==================================================

function getUserPoints(jid) {

  ensureUser(jid);

  return points[jid];

}

// ==================================================
// LEADERBOARD
// ==================================================

function getLeaderboard() {

  return Object.entries(points)

    .sort(
      (a, b) =>
        b[1].points -
        a[1].points
    )

    .slice(0, 10);

}

// ==================================================
// GROQ AI - CONTENT
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
    "🧠 Sending content request to Groq..."
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

أنت مدرس لغة ألمانية متخصص في مستوى B1 فقط.

مهمتك إنشاء محتوى تعليمي قصير جداً لمجموعة WhatsApp.

القواعد:

1. استخدم مستوى B1 فقط.
2. لا تستخدم شرحاً طويلاً.
3. لا تكرر نفس الموضوع باستمرار.
4. اجعل المحتوى عملياً من الحياة اليومية.
5. استخدم الألمانية للمحتوى.
6. استخدم العربية فقط للترجمة أو الشرح القصير.
7. لا تضف مقدمات طويلة.
8. لا تستخدم Markdown tables.
9. لا تكتب أكثر مما هو مطلوب.
10. إذا كان النوع يحتاج Poll يجب أن يكون هناك 3 اختيارات فقط.
11. يجب أن تكون إجابة Poll واحدة صحيحة فقط.

DIALOGUE:

حوار B1 قصير من 4 إلى 6 أسطر.
بعده سؤال فهم واحد.
3 اختيارات فقط.

WORD:

كلمة ألمانية واحدة B1.
معناها بالعربية.
مثال ألماني واحد.
ترجم المثال.

GRAMMAR:

قاعدة B1 واحدة فقط.
شرح عربي في سطرين كحد أقصى.
مثال ألماني واحد.
ترجم المثال.

VERBS:

5 أفعال ألمانية مهمة.

لكل فعل:

Infinitiv
Präteritum
Perfekt
المعنى بالعربية.

SITUATION:

موقف عملي قصير B1.
4 إلى 6 أسطر.
ثم سؤال واحد.
3 اختيارات فقط.

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

أو 2 أو 3 فقط.

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

ممنوع إضافة كلام خارج الصيغة.
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

  return answer;

}

// ==================================================
// GROQ AI - CHAT
// ==================================================

async function askChatAI(question) {

  const apiKey =
    process.env.GROQ_API_KEY;

  if (!apiKey) {

    throw new Error(
      "GROQ_API_KEY is missing."
    );

  }

  console.log(
    "🧠 Sending chat request to Groq..."
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

أنت مساعد ومدرس ألمانية لمجموعة WhatsApp.

المستخدم قد يكتب بالعربية أو الألمانية.

إذا سأل سؤالاً عن اللغة الألمانية:

- أجب بمستوى B1.
- اشرح بالعربية باختصار.
- أعط مثالاً ألمانياً عند الحاجة.
- ترجم المثال للعربية.

إذا كتب المستخدم تحية مثل:
hi
hello
hallo
السلام عليكم

فرد عليه بشكل طبيعي.

إذا سأل سؤالاً عاماً، أجب عنه بشكل طبيعي.

لا تستخدم صيغة:
TYPE:
TITLE:
OPTION1:

هذه الصيغة مخصصة للمحتوى التلقائي فقط.

كن مختصراً ومفيداً.
`,

            input:
              question

          })

      }
    );

  const data =
    await response.json();

  console.log(
    "📦 Chat AI status:",
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
      "Groq chat request failed."
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
      "Groq returned empty chat answer."
    );

  }

  return answer;

}

// ==================================================
// GET FIELD
// ==================================================

function getField(
  text,
  field,
  nextFields = []
) {

  const endPattern =
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

function parsePollContent(text) {

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

function parseWord(text) {

  const word =
    getField(
      text,
      "WORD",
      ["TRANSLATION"]
    );

  const translation =
    getField(
      text,
      "TRANSLATION",
      ["EXAMPLE"]
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

function parseGrammar(text) {

  const title =
    getField(
      text,
      "TITLE",
      ["EXPLANATION"]
    );

  const explanation =
    getField(
      text,
      "EXPLANATION",
      ["EXAMPLE"]
    );

  const example =
    getField(
      text,
      "EXAMPLE",
      ["TRANSLATION"]
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

function parseVerbs(text) {

  const verbs = [];

  for (
    let i = 1;
    i <= 5;
    i++
  ) {

    const value =
      getField(
        text,
        `VERB${i}`,
        [
          `VERB${i + 1}`
        ]
      );

    if (value) {

      verbs.push(value);

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
4 إلى 6 أسطر فقط.
ثم سؤال فهم و3 اختيارات.
`;

  }

  else if (
    type === "word"
  ) {

    instruction = `
النوع: WORD

اختر كلمة B1 مرتبطة بالحياة اليومية.
كلمة واحدة فقط مع مثال واحد.
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

أنشئ موقفاً عملياً قصيراً B1.
4 إلى 6 أسطر.
ثم سؤال فهم و3 اختيارات.
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

      selectableCount:
        1

    }

  };

  const sent =
    await sock.sendMessage(
      jid,
      pollMessage
    );

  // ==================================================
  // SAVE POLL
  // ==================================================

  if (
    sent?.key?.id
  ) {

    const pollId =
      sent.key.id;

    const secret =
      sent.messageContextInfo
        ?.messageSecret;

    polls[pollId] = {

      id:
        pollId,

      jid,

      answer:
        parsed.answer,

      options:
        parsed.options,

      createdAt:
        Date.now(),

      creatorJid:
        jidNormalizedUser(
          sock.user?.lid ||
          sock.user?.id ||
          ""
        ),

      messageSecret:
        secret
          ? Buffer.from(
              secret
            ).toString(
              "base64"
            )
          : null,

      scoredVoters: {}

    };

    saveJSON(
      POLLS_FILE,
      polls
    );

    console.log(
      "💾 Poll saved:",
      pollId
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
      text: message
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
      text: message
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

  await sock.sendMessage(
    jid,
    {
      text: message
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
      data.type === "word"
    ) {

      await sendWord(
        sock,
        jid,
        data
      );

    }

    else if (
      data.type === "grammar"
    ) {

      await sendGrammar(
        sock,
        jid,
        data
      );

    }

    else if (
      data.type === "verbs"
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
// GET MESSAGE TEXT
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
// PROCESS POLL VOTE
// ==================================================

async function processPollVote(
  sock,
  msg
) {

  try {

    const pollUpdate =
      msg.message
        ?.pollUpdateMessage;

    if (!pollUpdate)
      return;

    const creationKey =
      pollUpdate
        .pollCreationMessageKey;

    if (
      !creationKey?.id
    ) {

      console.log(
        "⚠️ Poll creation key missing."
      );

      return;

    }

    const pollId =
      creationKey.id;

    const poll =
      polls[pollId];

    if (!poll) {

      console.log(
        "⚠️ Poll not found:",
        pollId
      );

      return;

    }

    // ==================================================
    // ONLY OUR GROUPS
    // ==================================================

    const jid =
      msg.key.remoteJid;

    if (
      !ALLOWED_GROUPS.includes(
        jid
      )
    ) {

      return;

    }

    // ==================================================
    // VOTER JID
    // ==================================================

    const myJid =
      jidNormalizedUser(
        sock.user?.id ||
        ""
      );

    const voterJid =
      getKeyAuthor(
        msg.key,
        myJid
      );

    if (!voterJid) {

      console.log(
        "⚠️ Voter JID missing."
      );

      return;

    }

    // ==================================================
    // ALREADY SCORED
    // ==================================================

    if (
      poll.scoredVoters &&
      poll.scoredVoters[
        voterJid
      ]
    ) {

      console.log(
        "ℹ️ User already scored this poll:",
        voterJid
      );

      return;

    }

    // ==================================================
    // SECRET
    // ==================================================

    if (
      !poll.messageSecret
    ) {

      console.log(
        "❌ Poll messageSecret missing:",
        pollId
      );

      return;

    }

    const pollEncKey =
      Buffer.from(
        poll.messageSecret,
        "base64"
      );

    // ==================================================
    // CREATOR JID
    // ==================================================

    const creatorCandidates = [];

    if (
      sock.user?.lid
    ) {

      creatorCandidates.push(
        jidNormalizedUser(
          sock.user.lid
        )
      );

    }

    if (
      poll.creatorJid
    ) {

      creatorCandidates.push(
        jidNormalizedUser(
          poll.creatorJid
        )
      );

    }

    if (
      sock.user?.id
    ) {

      creatorCandidates.push(
        jidNormalizedUser(
          sock.user.id
        )
      );

    }

    // إزالة التكرار
    const uniqueCreators =
      [
        ...new Set(
          creatorCandidates
        )
      ];

    // ==================================================
    // DECRYPT
    // ==================================================

    let vote = null;

    for (
      const creatorJid
      of uniqueCreators
    ) {

      try {

        vote =
          decryptPollVote(

            pollUpdate.vote,

            {

              pollCreatorJid:
                creatorJid,

              pollMsgId:
                pollId,

              pollEncKey,

              voterJid

            }

          );

        if (vote) {

          console.log(
            "🔓 Poll vote decrypted."
          );

          break;

        }

      }

      catch (error) {

        console.log(
          "⚠️ Poll decrypt attempt failed:",
          creatorJid
        );

      }

    }

    if (!vote) {

      console.log(
        "❌ Could not decrypt poll vote."
      );

      return;

    }

    // ==================================================
    // SELECTED OPTION
    // ==================================================

    const selected =
      vote.selectedOptions || [];

    if (
      !selected.length
    ) {

      console.log(
        "⚠️ No selected option."
      );

      return;

    }

    const selectedHash =
      Buffer.from(
        selected[0]
      ).toString(
        "hex"
      );

    // ==================================================
    // FIND ANSWER
    // ==================================================

    let selectedIndex = -1;

    for (
      let i = 0;
      i < poll.options.length;
      i++
    ) {

      const optionHash =
        sha256(
          poll.options[i]
        );

      if (
        optionHash ===
        selectedHash
      ) {

        selectedIndex =
          i + 1;

        break;

      }

    }

    if (
      selectedIndex === -1
    ) {

      console.log(
        "⚠️ Could not identify selected option."
      );

      return;

    }

    // ==================================================
    // NAME
    // ==================================================

    const name =
      msg.pushName ||
      voterJid;

    // ==================================================
    // CORRECT
    // ==================================================

    const correct =
      selectedIndex ===
      poll.answer;

    ensureUser(
      voterJid,
      name
    );

    // مهم:
    // نسجل المستخدم قبل إرسال الرسالة
    // حتى لا يحصل على النقاط مرتين.

    poll.scoredVoters =
      poll.scoredVoters || {};

    poll.scoredVoters[
      voterJid
    ] = {

      answer:
        selectedIndex,

      correct,

      time:
        Date.now()

    };

    saveJSON(
      POLLS_FILE,
      polls
    );

    if (correct) {

      addPoints(
        voterJid,
        name,
        POINTS_PER_CORRECT
      );

      console.log(
        `🏆 ${name} +${POINTS_PER_CORRECT} points`
      );

      await sock.sendMessage(
        jid,
        {

          text:

            `🎉 *إجابة صحيحة!*\n\n` +

            `👤 ${name}\n` +

            `⭐ +${POINTS_PER_CORRECT} نقطة\n` +

            `🏆 مجموع نقاطك: ` +
            `${points[voterJid].points}`

        }
      );

    }

    else {

      addPoints(
        voterJid,
        name,
        0
      );

      console.log(
        `❌ ${name} answered incorrectly.`
      );

      await sock.sendMessage(
        jid,
        {

          text:

            `❌ *إجابة غير صحيحة*\n\n` +

            `👤 ${name}\n` +

            `⭐ نقاطك: ` +
            `${points[voterJid].points}\n\n` +

            `💡 حاول في السؤال القادم!`

        }
      );

    }

  }

  catch (error) {

    console.log(
      "❌ Poll vote error:",
      error.message
    );

  }

}

// ==================================================
// POINTS COMMAND
// ==================================================

async function sendMyPoints(
  sock,
  jid,
  senderJid,
  name
) {

  ensureUser(
    senderJid,
    name
  );

  const user =
    points[senderJid];

  await sock.sendMessage(
    jid,
    {

      text:

        "🏆 *نقاطك في German B1 Bot*\n\n" +

        `👤 ${user.name}\n` +

        `⭐ النقاط: ${user.points}\n` +

        `✅ إجابات صحيحة: ${user.correct}\n` +

        `❌ إجابات خاطئة: ${user.wrong}`

    }
  );

}

// ==================================================
// TOP COMMAND
// ==================================================

async function sendLeaderboard(
  sock,
  jid
) {

  const leaderboard =
    getLeaderboard();

  if (
    !leaderboard.length
  ) {

    await sock.sendMessage(
      jid,
      {

        text:
          "🏆 لا توجد نقاط بعد.\nحل أول Poll!"

      }
    );

    return;

  }

  let text =
    "🏆 *German B1 TOP 10*\n\n";

  leaderboard.forEach(
    ([userJid, user], index) => {

      text +=

        `${index + 1}️⃣ ` +

        `${user.name || userJid}` +

        ` — ⭐ ${user.points}\n`;

    }
  );

  await sock.sendMessage(
    jid,
    {
      text
    }
  );

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

        auth: state,

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
      async update => {

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
            "🏆 Points System"
          );

          console.log(
            "🤖 AI Chat with $"
          );

          console.log(
            "======================================"
          );

          console.log("");

          // ==================================================
          // START ONLY ONE INTERVAL
          // ==================================================

          if (
            !contentInterval
          ) {

            contentInterval =
              setInterval(
                async () => {

                  if (
                    !globalSock
                  )
                    return;

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

                    catch (error) {

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

          globalSock = null;

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
          const msg
          of messages
        ) {

          try {

            if (!msg)
              continue;

            if (!msg.message)
              continue;

            // ==================================================
            // POLL VOTE
            // ==================================================

            if (
              msg.message
                ?.pollUpdateMessage
            ) {

              await processPollVote(
                sock,
                msg
              );

              continue;

            }

            // ==================================================
            // IGNORE OWN NORMAL MESSAGES
            // ==================================================

            if (
              msg.key.fromMe
            ) {

              continue;

            }

            const jid =
              msg.key.remoteJid;

            if (!jid)
              continue;

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

            const senderJid =
              getKeyAuthor(
                msg.key,
                jidNormalizedUser(
                  sock.user?.id ||
                  ""
                )
              );

            const senderName =
              msg.pushName ||
              senderJid;

            console.log(
              "📩 MESSAGE:",
              text
            );

            // ==================================================
            // !TEST
            // ==================================================

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

            // ==================================================
            // !NOW
            // ==================================================

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

            // ==================================================
            // !POINTS
            // ==================================================

            if (
              text.toLowerCase() ===
              "!points"
            ) {

              await sendMyPoints(
                sock,
                jid,
                senderJid,
                senderName
              );

              continue;

            }

            // ==================================================
            // !TOP
            // ==================================================

            if (
              text.toLowerCase() ===
              "!top"
            ) {

              await sendLeaderboard(
                sock,
                jid
              );

              continue;

            }

            // ==================================================
            // !HELP
            // ==================================================

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

                    `✅ الإجابة الصحيحة = +${POINTS_PER_CORRECT} نقاط\n` +

                    "⭐ !points — نقاطك\n" +

                    "🏆 !top — المتصدرون\n\n" +

                    "🤖 *AI Chat*\n" +

                    "اكتب:\n" +

                    "$ سؤالك\n\n" +

                    "⚡ !now\n" +

                    "إرسال محتوى الآن."

                }
              );

              continue;

            }

            // ==================================================
            // AI CHAT
            // ==================================================

            if (
              text.startsWith("$")
            ) {

              const aiQuestion =
                text
                  .slice(1)
                  .trim();

              if (
                !aiQuestion
              ) {

                continue;

              }

              console.log(
                "🤖 AI CHAT:",
                aiQuestion
              );

              const answer =
                await askChatAI(
                  aiQuestion
                );

              await sock.sendMessage(
                jid,
                {

                  text:

                    "🇩🇪🤖 *German B1 Bot*\n\n" +

                    answer

                }
              );

              continue;

            }

          }

          catch (error) {

            console.log(
              "❌ Message error:",
              error.message
            );

            try {

              if (
                msg.key?.remoteJid
              ) {

                await sock.sendMessage(
                  msg.key.remoteJid,
                  {

                    text:
                      "⚠️ حدث خطأ مؤقت. حاول مرة أخرى."

                  }
                );

              }

            }

            catch {}

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