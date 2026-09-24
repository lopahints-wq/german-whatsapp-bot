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
  decryptPollVote
} = require("@whiskeysockets/baileys");

const { Boom } = require("@hapi/boom");

// ==================================================
// SERVER
// ==================================================

const app = express();

const PORT = process.env.PORT || 10000;

app.get("/", (req, res) => {
  res.send("🇩🇪 German B1 AI Bot is running!");
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

// كل دقيقة
const CONTENT_INTERVAL = 60 * 1000;

// نقاط الإجابة الصحيحة
const POINTS_PER_CORRECT_ANSWER = 10;

// ==================================================
// DATA DIRECTORY
// ==================================================

const DATA_DIR = path.join(
  process.cwd(),
  "data"
);

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, {
    recursive: true
  });
}

const POINTS_FILE =
  path.join(DATA_DIR, "points.json");

const POLLS_FILE =
  path.join(DATA_DIR, "polls.json");

// ==================================================
// JSON HELPERS
// ==================================================

function loadJSON(file, fallback) {

  try {

    if (!fs.existsSync(file)) {

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

    if (!data.trim()) {
      return fallback;
    }

    return JSON.parse(data);

  }

  catch (error) {

    console.log(
      "❌ JSON load error:",
      file,
      error.message
    );

    return fallback;

  }

}

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
// POINTS
// ==================================================

let players =
  loadJSON(
    POINTS_FILE,
    {}
  );

/*
الشكل:

{
  "user-id": {
    "name": "Ahmed",
    "points": 50
  }
}
*/

function normalizeUserId(jid) {

  if (!jid) {
    return "";
  }

  return jid
    .replace(/:.*(?=@)/, "")
    .trim();

}

function getUserName(
  msg,
  jid
) {

  if (
    msg?.pushName &&
    msg.pushName.trim()
  ) {

    return msg.pushName.trim();

  }

  const id =
    normalizeUserId(jid);

  if (
    players[id]?.name
  ) {

    return players[id].name;

  }

  if (id.includes("@")) {

    return id.split("@")[0];

  }

  return id || "Unknown";

}

function registerUser(
  jid,
  name
) {

  const id =
    normalizeUserId(jid);

  if (!id) {
    return "";
  }

  if (!players[id]) {

    players[id] = {

      name:
        name ||
        id.split("@")[0],

      points: 0

    };

  }

  else if (
    name &&
    name.trim()
  ) {

    players[id].name =
      name.trim();

  }

  saveJSON(
    POINTS_FILE,
    players
  );

  return id;

}

function addPoints(
  jid,
  name,
  amount
) {

  const id =
    registerUser(
      jid,
      name
    );

  if (!id) {
    return 0;
  }

  players[id].points =
    Number(
      players[id].points || 0
    ) + amount;

  saveJSON(
    POINTS_FILE,
    players
  );

  return players[id].points;

}

// ==================================================
// POLLS DATABASE
// ==================================================

let polls =
  loadJSON(
    POLLS_FILE,
    {}
  );

/*
polls:

{
  "POLL_MESSAGE_ID": {
    "jid": "...@g.us",
    "question": "...",
    "options": [],
    "correctAnswer": 2,
    "messageSecret": "...",
    "creatorJid": "...",
    "awarded": []
  }
}
*/

function savePolls() {

  saveJSON(
    POLLS_FILE,
    polls
  );

}

// ==================================================
// SOCKET
// ==================================================

let globalSock = null;

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
// GROQ - EDUCATIONAL CONTENT
// ==================================================

async function askContentAI(
  instruction
) {

  const apiKey =
    process.env.GROQ_API_KEY;

  if (!apiKey) {

    throw new Error(
      "GROQ_API_KEY is missing."
    );

  }

  console.log(
    "🧠 Generating educational content..."
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

أنت مدرس لغة ألمانية متخصص في مستوى B1.

مهمتك إنشاء محتوى تعليمي لمجموعة WhatsApp.

القواعد:

1. مستوى B1 فقط.
2. المحتوى عملي من الحياة اليومية.
3. لا تكتب مقدمة طويلة.
4. استخدم الألمانية للمحتوى.
5. استخدم العربية للترجمة والشرح فقط.
6. لا تستخدم Markdown tables.
7. Poll يجب أن يحتوي على 3 اختيارات فقط.
8. يجب أن تكون هناك إجابة صحيحة واحدة فقط.

DIALOGUE أو SITUATION:

TYPE:
DIALOGUE

TITLE:
عنوان قصير

CONTENT:
المحتوى

QUESTION:
السؤال

OPTION1:
الاختيار

OPTION2:
الاختيار

OPTION3:
الاختيار

ANSWER:
1

WORD:

TYPE:
WORD

WORD:
الكلمة

TRANSLATION:
الترجمة

EXAMPLE:
المثال

EXAMPLE_TRANSLATION:
الترجمة

GRAMMAR:

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

VERBS:

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

ممنوع كتابة أي شيء خارج هذه الصيغة.

`,

          input:
            instruction

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
        item?.type === "message" &&
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

      if (answer) {
        break;
      }

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
// GROQ - NORMAL CHAT
// ==================================================

async function askChatAI(
  question
) {

  const apiKey =
    process.env.GROQ_API_KEY;

  if (!apiKey) {

    throw new Error(
      "GROQ_API_KEY is missing."
    );

  }

  console.log(
    "🤖 Sending chat question to Groq..."
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

أنت مساعد لتعلم اللغة الألمانية.

أجب كمدرس ألمانية بمستوى B1.

يمكن للمستخدم أن يسأل بالعربية أو الألمانية.

إذا كان السؤال عن كلمة ألمانية:
- اذكر المعنى بالعربية.
- أعط مثالاً بالألمانية.
- ترجم المثال.

إذا كان السؤال عن قاعدة:
اشرحها بالعربية باختصار مع مثال ألماني.

إذا كان السؤال عاماً:
أجب بشكل طبيعي ومختصر.

مهم جداً:

لا تستخدم TYPE:
لا تستخدم WORD:
لا تستخدم OPTION1:
لا تستخدم ANSWER:

هذه المحادثة ليست درس Poll.

أجب مباشرة على سؤال المستخدم.

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
        item?.type === "message" &&
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

      if (answer) {
        break;
      }

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
// PARSER
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

function parseGrammar(text) {

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

function parseVerbs(text) {

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

4 إلى 6 أسطر.

بعده سؤال فهم واحد.

3 اختيارات فقط.

`;

  }

  else if (
    type === "word"
  ) {

    instruction = `

النوع: WORD

اختر كلمة ألمانية B1 مرتبطة بالحياة اليومية.

كلمة واحدة فقط.

مثال واحد.

`;

  }

  else if (
    type === "grammar"
  ) {

    instruction = `

النوع: GRAMMAR

اختر قاعدة B1 واحدة.

شرح قصير جداً.

مثال واحد.

`;

  }

  else if (
    type === "verbs"
  ) {

    instruction = `

النوع: VERBS

اختر 5 أفعال ألمانية مهمة بمستوى B1.

لكل فعل:
Infinitiv
Präteritum
Perfekt
المعنى بالعربية.

بدون أمثلة.

`;

  }

  else if (
    type === "situation"
  ) {

    instruction = `

النوع: SITUATION

الموضوع:
${topic}

أنشئ موقفاً عملياً بمستوى B1.

4 إلى 6 أسطر.

بعده سؤال فهم واحد.

3 اختيارات فقط.

`;

  }

  const response =
    await askContentAI(
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

  const sent =
    await sock.sendMessage(
      jid,
      pollMessage
    );

  if (
    !sent?.key?.id
  ) {

    console.log(
      "❌ Poll sent but message ID missing."
    );

    return;

  }

  // ================================================
  // SAVE POLL INFORMATION
  // ================================================

  let secret = "";

  try {

    const messageSecret =
      sent?.message
        ?.messageContextInfo
        ?.messageSecret;

    if (messageSecret) {

      if (
        Buffer.isBuffer(
          messageSecret
        )
      ) {

        secret =
          messageSecret.toString(
            "base64"
          );

      }

      else if (
        messageSecret instanceof
        Uint8Array
      ) {

        secret =
          Buffer.from(
            messageSecret
          ).toString(
            "base64"
          );

      }

      else if (
        typeof messageSecret ===
        "string"
      ) {

        secret =
          messageSecret;

      }

    }

  }

  catch (error) {

    console.log(
      "⚠️ Could not read poll secret:",
      error.message
    );

  }

  const creatorJid =
    sock.user?.id ||
    "";

  polls[
    sent.key.id
  ] = {

    jid,

    question:
      parsed.question,

    options:
      parsed.options,

    correctAnswer:
      parsed.answer,

    messageSecret:
      secret,

    creatorJid,

    awarded: [],

    createdAt:
      Date.now()

  };

  savePolls();

  console.log(
    "✅ Poll sent:"
  );

  console.log(
    "🆔 Poll ID:",
    sent.key.id
  );

  console.log(
    "🎯 Correct answer:",
    parsed.answer
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

  message +=
    "\n📌 Infinitiv → Präteritum → Perfekt → المعنى";

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
      "📚 Creating B1 content..."
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
// GET TEXT
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
// GET VOTER ID
// ==================================================

function getVoterId(
  key
) {

  if (!key) {
    return "";
  }

  if (
    key.fromMe
  ) {

    return (
      globalSock?.user?.id ||
      ""
    );

  }

  return (
    key.participantAlt ||
    key.remoteJidAlt ||
    key.participant ||
    key.remoteJid ||
    ""
  );

}

// ==================================================
// GET VOTER NAME
// ==================================================

function getVoterName(
  msg,
  key
) {

  if (
    msg?.pushName
  ) {

    return msg.pushName;

  }

  const jid =
    getVoterId(
      key
    );

  const id =
    normalizeUserId(
      jid
    );

  if (
    players[id]?.name
  ) {

    return players[id].name;

  }

  return (
    id.split("@")[0] ||
    "Player"
  );

}

// ==================================================
// HASH POLL OPTION
// ==================================================

function hashOption(
  option
) {

  return crypto
    .createHash("sha256")
    .update(
      Buffer.from(
        option,
        "utf8"
      )
    )
    .digest("hex");

}

// ==================================================
// FIND SELECTED OPTION
// ==================================================

function getSelectedOptionIndex(
  selectedOptions,
  options
) {

  if (
    !Array.isArray(
      selectedOptions
    )
  ) {

    return 0;

  }

  for (
    const selected
    of selectedOptions
  ) {

    let selectedHash = "";

    if (
      Buffer.isBuffer(
        selected
      )
    ) {

      selectedHash =
        selected.toString(
          "hex"
        );

    }

    else if (
      selected instanceof
      Uint8Array
    ) {

      selectedHash =
        Buffer.from(
          selected
        ).toString(
          "hex"
        );

    }

    else {

      selectedHash =
        String(selected);

    }

    for (
      let i = 0;
      i < options.length;
      i++
    ) {

      if (
        selectedHash ===
        hashOption(
          options[i]
        )
      ) {

        return i + 1;

      }

    }

  }

  return 0;

}

// ==================================================
// AWARD POINT
// ==================================================

async function processCorrectVote(
  pollId,
  voterJid,
  voterName,
  selectedIndex
) {

  const poll =
    polls[pollId];

  if (!poll) {

    console.log(
      "⚠️ Poll not found:",
      pollId
    );

    return;

  }

  if (
    selectedIndex !==
    Number(
      poll.correctAnswer
    )
  ) {

    console.log(
      `❌ Wrong answer from ${voterName}`
    );

    return;

  }

  const userId =
    normalizeUserId(
      voterJid
    );

  if (!userId) {
    return;
  }

  // لا تعطي النقاط مرتين
  if (
    !Array.isArray(
      poll.awarded
    )
  ) {

    poll.awarded = [];

  }

  if (
    poll.awarded.includes(
      userId
    )
  ) {

    console.log(
      `ℹ️ ${voterName} already received points for this poll.`
    );

    return;

  }

  poll.awarded.push(
    userId
  );

  savePolls();

  const total =
    addPoints(
      voterJid,
      voterName,
      POINTS_PER_CORRECT_ANSWER
    );

  console.log(
    "======================================"
  );

  console.log(
    "🏆 CORRECT ANSWER"
  );

  console.log(
    "👤 Player:",
    voterName
  );

  console.log(
    "⭐ +",
    POINTS_PER_CORRECT_ANSWER
  );

  console.log(
    "🏆 Total:",
    total
  );

  console.log(
    "======================================"
  );

  if (
    poll.jid
  ) {

    try {

      await globalSock.sendMessage(
        poll.jid,
        {
          text:
            `🎉 أحسنت ${voterName}!\n\n` +
            `✅ إجابة صحيحة!\n` +
            `⭐ +${POINTS_PER_CORRECT_ANSWER} نقاط\n` +
            `🏆 مجموع نقاطك: ${total}`
        }
      );

    }

    catch (error) {

      console.log(
        "⚠️ Could not send point message:",
        error.message
      );

    }

  }

}

// ==================================================
// HANDLE DECRYPTED POLL UPDATE
// ==================================================

async function handleDecryptedPollUpdate(
  pollId,
  pollUpdates
) {

  const poll =
    polls[pollId];

  if (!poll) {
    return;
  }

  if (
    !Array.isArray(
      pollUpdates
    )
  ) {

    return;

  }

  for (
    const update
    of pollUpdates
  ) {

    const vote =
      update?.vote;

    if (!vote) {
      continue;
    }

    const voterKey =
      update
        ?.pollUpdateMessageKey;

    const voterJid =
      getVoterId(
        voterKey
      );

    const voterName =
      players[
        normalizeUserId(
          voterJid
        )
      ]?.name ||
      normalizeUserId(
        voterJid
      ).split("@")[0];

    const selectedIndex =
      getSelectedOptionIndex(
        vote.selectedOptions,
        poll.options
      );

    console.log(
      "🗳️ Poll vote:",
      voterName,
      selectedIndex
    );

    await processCorrectVote(
      pollId,
      voterJid,
      voterName,
      selectedIndex
    );

  }

}

// ==================================================
// HANDLE RAW ENCRYPTED POLL
// ==================================================

async function handleRawPollVote(
  msg
) {

  try {

    const pollUpdate =
      msg?.message
        ?.pollUpdateMessage;

    if (!pollUpdate) {
      return;
    }

    const creationKey =
      pollUpdate
        .pollCreationMessageKey;

    if (
      !creationKey?.id
    ) {

      console.log(
        "⚠️ Poll creation ID missing."
      );

      return;

    }

    const pollId =
      creationKey.id;

    const poll =
      polls[pollId];

    if (!poll) {

      console.log(
        "⚠️ Raw vote received but poll is not stored:",
        pollId
      );

      return;

    }

    if (
      !poll.messageSecret
    ) {

      console.log(
        "⚠️ Poll secret missing:",
        pollId
      );

      return;

    }

    if (
      typeof decryptPollVote !==
      "function"
    ) {

      console.log(
        "⚠️ decryptPollVote is not available in this Baileys version."
      );

      return;

    }

    const voterJid =
      getVoterId(
        msg.key
      );

    const voterName =
      getVoterName(
        msg,
        msg.key
      );

    const creatorJid =
      poll.creatorJid ||
      globalSock?.user?.id;

    const pollEncKey =
      Buffer.from(
        poll.messageSecret,
        "base64"
      );

    const decrypted =
      decryptPollVote(
        pollUpdate.vote,
        {

          pollEncKey,

          pollCreatorJid:
            creatorJid,

          pollMsgId:
            pollId,

          voterJid

        }
      );

    const selectedIndex =
      getSelectedOptionIndex(
        decrypted?.selectedOptions,
        poll.options
      );

    console.log(
      "🔓 Raw poll decrypted:",
      voterName,
      selectedIndex
    );

    await processCorrectVote(
      pollId,
      voterJid,
      voterName,
      selectedIndex
    );

  }

  catch (error) {

    console.log(
      "❌ Poll decrypt error:",
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
  userJid,
  userName
) {

  const id =
    normalizeUserId(
      userJid
    );

  const points =
    Number(
      players[id]?.points ||
      0
    );

  await sock.sendMessage(
    jid,
    {
      text:
        `🏆🇩🇪 نقاطك\n\n` +
        `👤 ${userName}\n` +
        `⭐ ${points} نقطة`
    }
  );

}

// ==================================================
// TOP PLAYERS
// ==================================================

async function sendTopPlayers(
  sock,
  jid
) {

  const list =
    Object.entries(
      players
    )
      .map(
        ([id, data]) => ({

          id,

          name:
            data.name ||
            id.split("@")[0],

          points:
            Number(
              data.points || 0
            )

        })
      )
      .sort(
        (a, b) =>
          b.points -
          a.points
      )
      .slice(
        0,
        10
      );

  if (!list.length) {

    await sock.sendMessage(
      jid,
      {
        text:
          "🏆🇩🇪 B1 TOP PLAYERS\n\n" +
          "لا توجد نقاط بعد."
      }
    );

    return;

  }

  let message =
    "🏆🇩🇪 *B1 TOP PLAYERS*\n\n";

  list.forEach(
    (player, index) => {

      const medal =
        index === 0
          ? "🥇"
          : index === 1
          ? "🥈"
          : index === 2
          ? "🥉"
          : `${index + 1}.`;

      message +=
        `${medal} *${player.name}* — ⭐ ${player.points}\n`;

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

        "🇩🇪🤖 *German B1 Bot*\n\n" +

        "📚 الدروس تصل تلقائياً.\n\n" +

        "🗳️ Poll = +10 نقاط للإجابة الصحيحة.\n\n" +

        "🏆 *الأوامر:*\n\n" +

        "⭐ !points\n" +
        "معرفة نقاطك\n\n" +

        "🏆 !top\n" +
        "أفضل اللاعبين\n\n" +

        "📚 !now\n" +
        "إرسال درس الآن\n\n" +

        "🤖 $سؤالك\n" +
        "التحدث مع الذكاء الاصطناعي\n\n" +

        "❓ !help\n" +
        "عرض المساعدة"

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
            "🤖 AI CHAT READY!"
          );

          console.log(
            "🏆 POINT SYSTEM READY!"
          );

          console.log(
            "🗳️ POLL SYSTEM READY!"
          );

          console.log(
            "⏱️ Automatic content: every 1 minute"
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

          catch {}

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

            if (!msg) {
              continue;
            }

            if (!msg.message) {
              continue;
            }

            // ============================================
            // RAW POLL VOTE
            // ============================================

            if (
              msg.message
                ?.pollUpdateMessage
            ) {

              await handleRawPollVote(
                msg
              );

              continue;

            }

            // ============================================
            // IGNORE OUR OWN NORMAL MESSAGES
            // ============================================

            if (
              msg.key.fromMe
            ) {

              continue;

            }

            const jid =
              msg.key.remoteJid;

            if (!jid) {
              continue;
            }

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

            // ============================================
            // SAVE USER NAME
            // ============================================

            const senderJid =
              getVoterId(
                msg.key
              );

            const senderName =
              getVoterName(
                msg,
                msg.key
              );

            registerUser(
              senderJid,
              senderName
            );

            if (!text) {
              continue;
            }

            console.log(
              "📩 MESSAGE:",
              text
            );

            // ============================================
            // !TEST
            // ============================================

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
                    "🏆 نظام النقاط يعمل.\n" +
                    "🗳️ نظام Poll يعمل."

                }
              );

              continue;

            }

            // ============================================
            // !POINTS
            // ============================================

            if (
              text.toLowerCase() ===
              "!points" ||
              text.toLowerCase() ===
              "!point"
            ) {

              await sendMyPoints(
                sock,
                jid,
                senderJid,
                senderName
              );

              continue;

            }

            // ============================================
            // !TOP
            // ============================================

            if (
              text.toLowerCase() ===
              "!top"
            ) {

              await sendTopPlayers(
                sock,
                jid
              );

              continue;

            }

            // ============================================
            // !NOW
            // ============================================

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

            // ============================================
            // !HELP
            // ============================================

            if (
              text.toLowerCase() ===
              "!help"
            ) {

              await sendHelp(
                sock,
                jid
              );

              continue;

            }

            // ============================================
            // AI CHAT
            //
            // IMPORTANT:
            // يبدأ بـ $
            // ============================================

            if (
              text.startsWith("$")
            ) {

              const aiQuestion =
                text
                  .slice(1)
                  .trim();

              if (!aiQuestion) {
                continue;
              }

              console.log(
                "🤖 AI QUESTION:",
                aiQuestion
              );

              try {

                const answer =
                  await askChatAI(
                    aiQuestion
                  );

                await sock.sendMessage(
                  jid,
                  {

                    text:
                      "🇩🇪🤖 *German B1 AI*\n\n" +
                      answer

                  }
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
                      "❌ حدث خطأ في الذكاء الاصطناعي.\n\n" +
                      "تحقق من GROQ_API_KEY."

                  }
                );

              }

              continue;

            }

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
    // DECRYPTED POLL UPDATES
    // ==================================================

    sock.ev.on(
      "messages.update",
      async updates => {

        for (
          const item
          of updates
        ) {

          try {

            const pollUpdates =
              item?.update
                ?.pollUpdates;

            if (
              !pollUpdates
            ) {

              continue;

            }

            const pollId =
              item?.key?.id;

            if (!pollId) {
              continue;
            }

            console.log(
              "🗳️ messages.update poll:",
              pollId
            );

            await handleDecryptedPollUpdate(
              pollId,
              pollUpdates
            );

          }

          catch (error) {

            console.log(
              "❌ Poll update error:",
              error.message
            );

          }

        }

      }
    );

    // ==================================================
    // AUTOMATIC CONTENT
    // ==================================================

    setInterval(
      async () => {

        if (!globalSock) {
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

  catch (error) {

    console.log(
      "❌ BOT START ERROR:",
      error.message
    );

    console.log(
      error.stack
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