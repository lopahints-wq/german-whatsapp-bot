const express = require("express");
const pino = require("pino");
const fs = require("fs");
const path = require("path");

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  Browsers,
  getAggregateVotesInPollMessage,
  decryptPollVote,
  getKeyAuthor,
  jidNormalizedUser
} = require("@whiskeysockets/baileys");

const { Boom } = require("@hapi/boom");

// ================= SETTINGS =================

const PORT = Number(process.env.PORT || 10000);

const ALLOWED_GROUPS = [
  "120363423888719176@g.us"
];

const CONTENT_INTERVAL = 60 * 1000;

const CORRECT_POINTS = 10;

const POINTS_FILE =
  path.join(__dirname, "points.json");

// ================= SERVER =================

const app = express();

app.get("/", (req, res) => {
  res.send(
    "🇩🇪 German B1 AI Bot is running!"
  );
});

app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `🌐 Server started on ${PORT}`
    );
  }
);

// ================= STATE =================

let globalSock = null;

let intervalStarted = false;

let points = {};

const names = new Map();

const polls = new Map();

let contentIndex = 0;

// ================= POINTS =================

function norm(jid) {

  if (!jid) return "";

  try {

    return jidNormalizedUser(jid);

  } catch {

    return String(jid);

  }

}

// ================= LOAD POINTS =================

function loadPoints() {

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
        ) || {};

    }

  } catch (error) {

    console.log(
      "⚠️ points.json error:",
      error.message
    );

    points = {};

  }

}

// ================= SAVE POINTS =================

function savePoints() {

  try {

    const tmp =
      POINTS_FILE +
      ".tmp";

    fs.writeFileSync(
      tmp,
      JSON.stringify(
        points,
        null,
        2
      ),
      "utf8"
    );

    fs.renameSync(
      tmp,
      POINTS_FILE
    );

  } catch (error) {

    console.log(
      "❌ Save points error:",
      error.message
    );

  }

}

// ================= REMEMBER NAME =================

function rememberName(
  jid,
  name
) {

  const id =
    norm(jid);

  const cleanName =
    String(
      name || ""
    ).trim();

  if (
    !id ||
    !cleanName
  ) {

    return;

  }

  names.set(
    id,
    cleanName
  );

  if (!points[id]) {

    points[id] = {

      name:
        cleanName,

      points:
        0

    };

  } else {

    points[id].name =
      cleanName;

  }

}

// ================= DISPLAY NAME =================

function displayName(jid) {

  const id =
    norm(jid);

  return (
    names.get(id) ||
    points[id]?.name ||
    id.split("@")[0] ||
    "Player"
  );

}

// ================= ADD POINTS =================

function addPoints(
  jid,
  amount,
  name
) {

  const id =
    norm(jid);

  if (!id) {

    return 0;

  }

  if (!points[id]) {

    points[id] = {

      name:
        name ||
        displayName(id),

      points:
        0

    };

  }

  if (name) {

    points[id].name =
      name;

  }

  points[id].points =
    Number(
      points[id].points || 0
    ) +
    Number(amount || 0);

  savePoints();

  return points[id].points;

}

// ================= TOP PLAYERS =================

function topPlayers() {

  return Object.entries(
    points
  )

    .map(
      ([jid, data]) => ({

        jid,

        name:
          data.name ||
          displayName(jid),

        points:
          Number(
            data.points || 0
          )

      })
    )

    .filter(
      player =>
        player.points > 0
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

}

// ================= GROQ =================

async function groq(
  input,
  instructions
) {

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

        method:
          "POST",

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

  if (
    !response.ok
  ) {

    throw new Error(
      data?.error?.message ||
      "Groq request failed."
    );

  }

  if (
    typeof data.output_text ===
    "string" &&
    data.output_text.trim()
  ) {

    return data
      .output_text
      .trim();

  }

  let output = "";

  for (
    const item
    of data.output || []
  ) {

    for (
      const content
      of item.content || []
    ) {

      if (
        content.type ===
          "output_text" &&
        typeof content.text ===
          "string"
      ) {

        output +=
          content.text;

      }

    }

  }

  if (
    !output.trim()
  ) {

    throw new Error(
      "Groq returned empty answer."
    );

  }

  return output.trim();

}

// ==================================================
// AI CHAT
// ==================================================

// مهم جدًا:
// $hi يدخل هنا فقط.
// لا يدخل إلى نظام الدروس.

async function chatAI(
  question
) {

  return groq(

    question,

    `

أنت مدرس لغة ألمانية B1 ومساعد ذكي.

أجب عن سؤال المستخدم بشكل طبيعي ومختصر.

ممنوع استخدام:

TYPE:
WORD:
OPTION1:
OPTION2:
OPTION3:
ANSWER:

لا تنشئ Poll إلا إذا طلب المستخدم ذلك.

إذا كان السؤال بالعربية:
اشرح بالعربية مع أمثلة ألمانية عند الحاجة.

إذا كتب المستخدم جملة ألمانية:
صحح الجملة واشرح الخطأ باختصار.

إذا سأل عن كلمة ألمانية:
اشرح معناها بالعربية وأعط مثالاً.

إذا سأل عن قاعدة:
اشرحها بالعربية باختصار مع مثال ألماني.

`

  );

}

// ================= EDUCATIONAL AI =================

async function educationalAI(
  type,
  topic
) {

  return groq(

    `النوع: ${type}

الموضوع:
${topic}`,

    `

أنت مدرس لغة ألمانية متخصص في مستوى B1.

أنشئ محتوى قصير لمجموعة WhatsApp.

مستوى B1 فقط.

إذا كان النوع DIALOGUE أو SITUATION:

TYPE:
DIALOGUE

TITLE:
عنوان قصير

CONTENT:
4 إلى 6 أسطر ألمانية

QUESTION:
سؤال فهم بالألمانية

OPTION1:
اختيار

OPTION2:
اختيار

OPTION3:
اختيار

ANSWER:
1

يجب أن تكون إجابة واحدة فقط صحيحة.

إذا كان النوع WORD:

TYPE:
WORD

WORD:
كلمة ألمانية B1

TRANSLATION:
المعنى بالعربية

EXAMPLE:
مثال ألماني

EXAMPLE_TRANSLATION:
ترجمة المثال

إذا كان النوع GRAMMAR:

TYPE:
GRAMMAR

TITLE:
اسم القاعدة

EXPLANATION:
شرح عربي قصير

EXAMPLE:
مثال ألماني

TRANSLATION:
ترجمة المثال

إذا كان النوع VERBS:

TYPE:
VERBS

VERB1:
Infinitiv | Präteritum | Perfekt | المعنى

VERB2:
Infinitiv | Präteritum | Perfekt | المعنى

VERB3:
Infinitiv | Präteritum | Perfekt | المعنى

VERB4:
Infinitiv | Präteritum | Perfekt | المعنى

VERB5:
Infinitiv | Präteritum | Perfekt | المعنى

ممنوع إضافة كلام خارج الصيغة.

`

  );

}

// ================= FIELD =================

function field(
  text,
  key,
  next = []
) {

  const end =
    next.length
      ? `(?=\\n(?:${next.join("|")}):)`
      : "$";

  const regex =
    new RegExp(
      `${key}:\\s*([\\s\\S]*?)${end}`,
      "i"
    );

  const match =
    text.match(regex);

  return match
    ? match[1].trim()
    : "";

}

// ================= PARSE POLL =================

function parsePoll(
  text
) {

  const data = {

    type:
      field(
        text,
        "TYPE",
        [
          "TITLE",
          "CONTENT"
        ]
      ),

    title:
      field(
        text,
        "TITLE",
        [
          "CONTENT"
        ]
      ),

    content:
      field(
        text,
        "CONTENT",
        [
          "QUESTION"
        ]
      ),

    question:
      field(
        text,
        "QUESTION",
        [
          "OPTION1"
        ]
      ),

    option1:
      field(
        text,
        "OPTION1",
        [
          "OPTION2"
        ]
      ),

    option2:
      field(
        text,
        "OPTION2",
        [
          "OPTION3"
        ]
      ),

    option3:
      field(
        text,
        "OPTION3",
        [
          "ANSWER"
        ]
      ),

    answer:
      field(
        text,
        "ANSWER"
      )

  };

  if (
    !data.title ||
    !data.content ||
    !data.question ||
    !data.option1 ||
    !data.option2 ||
    !data.option3 ||
    !/^[123]$/.test(
      data.answer
    )
  ) {

    return null;

  }

  data.answer =
    Number(
      data.answer
    );

  return data;

}

// ================= PARSE WORD =================

function parseWord(
  text
) {

  const data = {

    word:
      field(
        text,
        "WORD",
        [
          "TRANSLATION"
        ]
      ),

    translation:
      field(
        text,
        "TRANSLATION",
        [
          "EXAMPLE"
        ]
      ),

    example:
      field(
        text,
        "EXAMPLE",
        [
          "EXAMPLE_TRANSLATION"
        ]
      ),

    exampleTranslation:
      field(
        text,
        "EXAMPLE_TRANSLATION"
      )

  };

  if (
    !data.word ||
    !data.translation ||
    !data.example ||
    !data.exampleTranslation
  ) {

    return null;

  }

  return data;

}

// ================= PARSE GRAMMAR =================

function parseGrammar(
  text
) {

  const data = {

    title:
      field(
        text,
        "TITLE",
        [
          "EXPLANATION"
        ]
      ),

    explanation:
      field(
        text,
        "EXPLANATION",
        [
          "EXAMPLE"
        ]
      ),

    example:
      field(
        text,
        "EXAMPLE",
        [
          "TRANSLATION"
        ]
      ),

    translation:
      field(
        text,
        "TRANSLATION"
      )

  };

  if (
    !data.title ||
    !data.explanation ||
    !data.example ||
    !data.translation
  ) {

    return null;

  }

  return data;

}

// ================= PARSE VERBS =================

function parseVerbs(
  text
) {

  const verbs = [];

  for (
    let i = 1;
    i <= 5;
    i++
  ) {

    const value =
      field(
        text,
        `VERB${i}`,
        i < 5
          ? [`VERB${i + 1}`]
          : []
      );

    if (value) {

      verbs.push(
        value
      );

    }

  }

  return verbs.length === 5
    ? verbs
    : null;

}

// ================= CONTENT =================

const CONTENT_TYPES = [
  "dialogue",
  "word",
  "grammar",
  "verbs",
  "situation"
];

const TOPICS = [

  "في السوبرماركت",
  "في المقهى",
  "في المطعم",
  "في العمل",
  "مقابلة عمل",
  "محطة القطار",
  "الحافلة",
  "الفندق",
  "البنك",
  "البريد",
  "شراء الملابس",
  "عند الطبيب",
  "حجز موعد",
  "السؤال عن الطريق",
  "استئجار شقة",
  "الجيران",
  "التسوق",
  "المطار",
  "السيارة",
  "مكالمة هاتفية",
  "التحدث مع صديق",
  "الحياة اليومية",
  "الدراسة",
  "الجامعة",
  "المكتب"

];

function getRandomTopic() {

  return TOPICS[
    Math.floor(
      Math.random() *
      TOPICS.length
    )
  ];

}

function getNextType() {

  const type =
    CONTENT_TYPES[
      contentIndex %
      CONTENT_TYPES.length
    ];

  contentIndex++;

  return type;

}

// ================= GENERATE =================

async function generateContent() {

  const type =
    getNextType();

  const topic =
    getRandomTopic();

  console.log(
    "🎯 Type:",
    type
  );

  console.log(
    "📚 Topic:",
    topic
  );

  const text =
    await educationalAI(
      type.toUpperCase(),
      topic
    );

  return {
    type,
    text
  };

}

// ================= SEND POLL =================

async function sendPoll(
  sock,
  jid,
  data
) {

  const parsed =
    parsePoll(
      data.text
    );

  if (!parsed) {

    console.log(
      "❌ Invalid poll generated:"
    );

    console.log(
      data.text
    );

    return;

  }

  const pollName =

    `🇩🇪💬 ${parsed.title}

${parsed.content}

❓ ${parsed.question}`;

  const sent =
    await sock.sendMessage(
      jid,
      {

        poll: {

          name:
            pollName,

          values: [

            `1️⃣ ${parsed.option1}`,

            `2️⃣ ${parsed.option2}`,

            `3️⃣ ${parsed.option3}`

          ],

          selectableCount:
            1

        }

      }
    );

  if (
    sent?.key?.id
  ) {

    polls.set(
      sent.key.id,
      {

        jid,

        answer:
          parsed.answer,

        options: [

          parsed.option1,

          parsed.option2,

          parsed.option3

        ],

        message:
          sent,

        awarded:
          new Set()

      }
    );

    console.log(
      "📝 Poll saved:",
      sent.key.id
    );

  }

}

// ================= SEND WORD =================

async function sendWord(
  sock,
  jid,
  text
) {

  const parsed =
    parseWord(
      text
    );

  if (!parsed) {

    console.log(
      "❌ Invalid word."
    );

    return;

  }

  await sock.sendMessage(
    jid,
    {

      text:

        `🧠🇩🇪 *Wort des Tages*

🇩🇪 *${parsed.word}*

🇸🇦 ${parsed.translation}

📝 ${parsed.example}

🇸🇦 ${parsed.exampleTranslation}`

    }
  );

}

// ================= SEND GRAMMAR =================

async function sendGrammar(
  sock,
  jid,
  text
) {

  const parsed =
    parseGrammar(
      text
    );

  if (!parsed) {

    console.log(
      "❌ Invalid grammar."
    );

    return;

  }

  await sock.sendMessage(
    jid,
    {

      text:

        `📚🇩🇪 *B1 Grammatik*

🔹 *${parsed.title}*

${parsed.explanation}

📝 ${parsed.example}

🇸🇦 ${parsed.translation}`

    }
  );

}

// ================= SEND VERBS =================

async function sendVerbs(
  sock,
  jid,
  text
) {

  const verbs =
    parseVerbs(
      text
    );

  if (!verbs) {

    console.log(
      "❌ Invalid verbs."
    );

    return;

  }

  const message =

    `🔥🇩🇪 *5 wichtige B1 Verben*

` +

    verbs
      .map(
        (verb, index) =>
          `${index + 1}️⃣ ${verb}`
      )
      .join("\n");

  await sock.sendMessage(
    jid,
    {
      text:
        message
    }
  );

}

// ================= SEND CONTENT =================

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

    const data =
      await generateContent();

    if (
      data.type ===
        "dialogue" ||
      data.type ===
        "situation"
    ) {

      await sendPoll(
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
        data.text
      );

    }

    else if (
      data.type ===
      "grammar"
    ) {

      await sendGrammar(
        sock,
        jid,
        data.text
      );

    }

    else if (
      data.type ===
      "verbs"
    ) {

      await sendVerbs(
        sock,
        jid,
        data.text
      );

    }

  } catch (error) {

    console.log(
      "❌ Content error:",
      error.message
    );

  }

}

// ================= GET MESSAGE TEXT =================

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

// ================= FIND NAME =================

async function findUserName(
  sock,
  groupJid,
  userJid
) {

  const id =
    norm(userJid);

  if (
    names.has(id)
  ) {

    return names.get(id);

  }

  if (
    points[id]?.name
  ) {

    return points[id].name;

  }

  try {

    const metadata =
      await sock.groupMetadata(
        groupJid
      );

    const participant =
      metadata.participants.find(
        participant => {

          const ids = [

            participant.id,

            participant.lid,

            participant.phoneNumber

          ]

            .filter(Boolean)

            .map(norm);

          return ids.includes(
            id
          );

        }
      );

    if (participant) {

      const name =
        participant.notify ||
        participant.name ||
        participant.verifiedName;

      if (name) {

        rememberName(
          id,
          name
        );

        savePoints();

        return name;

      }

    }

  } catch (error) {

    console.log(
      "⚠️ Name lookup:",
      error.message
    );

  }

  return displayName(
    id
  );

}

// ================= AWARD POLL =================

async function awardPollVotes(
  sock,
  pollId,
  updates
) {

  const poll =
    polls.get(
      pollId
    );

  if (
    !poll ||
    !updates?.length
  ) {

    return;

  }

  try {

    const aggregate =
      getAggregateVotesInPollMessage(
        {

          message:
            poll.message.message,

          pollUpdates:
            updates

        }
      );

    if (
      !Array.isArray(
        aggregate
      )
    ) {

      return;

    }

    const correctOption =
      poll.options[
        poll.answer - 1
      ];

    for (
      const item
      of aggregate
    ) {

      if (
        item.name !==
        correctOption
      ) {

        continue;

      }

      for (
        const voter
        of item.voters || []
      ) {

        const voterId =
          norm(voter);

        if (!voterId) {

          continue;

        }

        // منع تكرار النقاط
        if (
          poll.awarded.has(
            voterId
          )
        ) {

          continue;

        }

        poll.awarded.add(
          voterId
        );

        const name =
          await findUserName(
            sock,
            poll.jid,
            voterId
          );

        const total =
          addPoints(
            voterId,
            CORRECT_POINTS,
            name
          );

        await sock.sendMessage(
          poll.jid,
          {

            text:

              `🎉👏 ممتاز ${name}!

✅ إجابة صحيحة!

⭐ +${CORRECT_POINTS} نقاط

🏆 مجموع نقاطك: ${total}`

          }
        );

        console.log(
          `🏆 ${name} +${CORRECT_POINTS}`
        );

      }

    }

  } catch (error) {

    console.log(
      "❌ Poll vote error:",
      error.message
    );

  }

}

// ================= RAW POLL VOTE =================

async function handleRawPollVote(
  sock,
  msg
) {

  const raw =
    msg?.message
      ?.pollUpdateMessage;

  if (
    !raw?.pollCreationMessageKey?.id ||
    !raw.vote
  ) {

    return false;

  }

  const pollId =
    raw
      .pollCreationMessageKey
      .id;

  const poll =
    polls.get(
      pollId
    );

  if (!poll) {

    return false;

  }

  const secret =
    poll
      .message
      ?.message
      ?.messageContextInfo
      ?.messageSecret;

  if (!secret) {

    console.log(
      "❌ Poll messageSecret missing."
    );

    return false;

  }

  try {

    const myPn =
      sock.user?.id
        ? jidNormalizedUser(
            sock.user.id
          )
        : "";

    const myLid =
      sock.user?.lid
        ? jidNormalizedUser(
            sock.user.lid
          )
        : "";

    const creator =
      getKeyAuthor(
        raw.pollCreationMessageKey,
        myPn
      );

    const voter =
      getKeyAuthor(
        msg.key,
        myPn
      );

    let vote =
      null;

    const creators =
      [
        myLid,
        creator
      ].filter(Boolean);

    for (
      const creatorJid
      of creators
    ) {

      try {

        vote =
          decryptPollVote(
            raw.vote,
            {

              pollEncKey:
                secret,

              pollCreatorJid:
                creatorJid,

              pollMsgId:
                pollId,

              voterJid:
                voter

            }
          );

        if (vote) {

          break;

        }

      } catch {}

    }

    if (!vote) {

      return false;

    }

    await awardPollVotes(
      sock,
      pollId,
      [

        {

          pollUpdateMessageKey:
            msg.key,

          vote,

          senderTimestampMs:
            raw.senderTimestampMs

        }

      ]
    );

    return true;

  } catch (error) {

    console.log(
      "❌ Poll decrypt error:",
      error.message
    );

    return false;

  }

}

// ================= POINT COMMAND =================

async function sendMyPoints(
  sock,
  jid,
  sender
) {

  const id =
    norm(sender);

  const total =
    Number(
      points[id]?.points || 0
    );

  const name =
    displayName(id);

  await sock.sendMessage(
    jid,
    {

      text:

        `⭐ *B1 POINTS*

👤 ${name}

🏆 ${total} نقطة`

    }
  );

}

// ================= TOP COMMAND =================

async function sendTopPlayers(
  sock,
  jid
) {

  const list =
    topPlayers();

  if (
    !list.length
  ) {

    await sock.sendMessage(
      jid,
      {

        text:
          "🏆🇩🇪 *B1 TOP PLAYERS*\n\nلا توجد نقاط بعد."

      }
    );

    return;

  }

  const message =

    "🏆🇩🇪 *B1 TOP PLAYERS*\n\n" +

    list
      .map(
        (player, index) =>
          `${index + 1}. ${player.name} — ⭐ ${player.points}`
      )
      .join("\n");

  await sock.sendMessage(
    jid,
    {

      text:
        message

    }
  );

}

// ================= HELP =================

async function sendHelp(
  sock,
  jid
) {

  await sock.sendMessage(
    jid,
    {

      text:

        `🇩🇪🤖 *German B1 Bot*

📚 محتوى B1 تلقائي

📝 Polls

⭐ نقاط للإجابة الصحيحة

💬 اكتب:
$سؤالك

⭐ !point
⭐ !points

🏆 !top

⚡ !now

ℹ️ !help`

    }
  );

}

// ================= START BOT =================

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

    // ================= CONNECTION =================

    sock.ev.on(
      "connection.update",
      async update => {

        const {

          connection,

          lastDisconnect

        } = update;

        if (
          connection ===
          "open"
        ) {

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
            "⭐ Points system ready"
          );

          console.log(
            "💬 AI system ready"
          );

          console.log(
            "======================================"
          );

        }

        if (
          connection ===
          "close"
        ) {

          globalSock =
            null;

          let code =
            0;

          try {

            code =
              lastDisconnect
                ?.error
                ?.output
                ?.statusCode ||
              0;

          } catch {}

          console.log(
            "❌ WhatsApp disconnected:",
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
            "🔄 Reconnecting..."
          );

          setTimeout(
            startBot,
            5000
          );

        }

      }
    );

    // ================= PAIRING =================

    if (
      !state.creds.registered
    ) {

      const phone =
        process.env
          .WHATSAPP_NUMBER;

      if (!phone) {

        throw new Error(
          "WHATSAPP_NUMBER is missing."
        );

      }

      await new Promise(
        resolve =>
          setTimeout(
            resolve,
            3000
          )
      );

      const code =
        await sock.requestPairingCode(
          phone.replace(
            /\D/g,
            ""
          )
        );

      console.log(
        "======================================"
      );

      console.log(
        "📱 WHATSAPP PAIRING CODE:"
      );

      console.log(
        code
      );

      console.log(
        "======================================"
      );

    }

    // ================= MESSAGES =================

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

            if (
              !msg?.message
            ) {

              continue;

            }

            // بعض إصدارات Baileys
            // ترسل التصويت هنا.

            if (
              msg.message
                .pollUpdateMessage
            ) {

              await handleRawPollVote(
                sock,
                msg
              );

              continue;

            }

            if (
              msg.key.fromMe
            ) {

              continue;

            }

            const jid =
              msg.key.remoteJid;

            if (
              !jid
            ) {

              continue;

            }

            if (
              !jid.endsWith(
                "@g.us"
              )
            ) {

              continue;

            }

            const sender =
              msg.key.participant ||
              msg.participant;

            if (
              sender &&
              msg.pushName
            ) {

              rememberName(
                sender,
                msg.pushName
              );

              savePoints();

            }

            const text =
              getMessageText(
                msg
              ).trim();

            if (
              !text
            ) {

              continue;

            }

            console.log(
              "📩 MESSAGE:",
              text
            );

            const lower =
              text.toLowerCase();

            // ================= TEST =================

            if (
              lower ===
              "!test"
            ) {

              await sock.sendMessage(
                jid,
                {

                  text:

                    `🇩🇪🤖 German B1 Bot

✅ Bot يعمل

🧠 Groq متصل

⭐ Points يعمل

💬 AI يعمل مع $

🏆 !top يعمل`

                }
              );

              continue;

            }

            // ================= POINT =================

            if (
              lower ===
                "!point" ||
              lower ===
                "!points"
            ) {

              if (
                sender
              ) {

                await sendMyPoints(
                  sock,
                  jid,
                  sender
                );

              }

              continue;

            }

            // ================= TOP =================

            if (
              lower ===
              "!top"
            ) {

              await sendTopPlayers(
                sock,
                jid
              );

              continue;

            }

            // ================= HELP =================

            if (
              lower ===
              "!help"
            ) {

              await sendHelp(
                sock,
                jid
              );

              continue;

            }

            // ================= NOW =================

            if (
              lower ===
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

            // ================= AI CHAT =================

            // مهم:
            // أي رسالة تبدأ بـ $
            // تدخل chatAI فقط.

            if (
              text.startsWith(
                "$"
              )
            ) {

              const question =
                text
                  .slice(1)
                  .trim();

              if (
                !question
              ) {

                continue;

              }

              try {

                console.log(
                  "🤖 AI CHAT:",
                  question
                );

                const answer =
                  await chatAI(
                    question
                  );

                await sock.sendMessage(
                  jid,
                  {

                    text:

                      `🇩🇪🤖 *German B1 AI*

${answer}`

                  }
                );

              } catch (error) {

                console.log(
                  "❌ AI error:",
                  error.message
                );

                await sock.sendMessage(
                  jid,
                  {

                    text:

                      `❌ حدث خطأ في الذكاء الاصطناعي.

تأكد من:
GROQ_API_KEY

في Daytona.`

                  }
                );

              }

              continue;

            }

          } catch (error) {

            console.log(
              "❌ Message error:",
              error.message
            );

          }

        }

      }
    );

    // ================= POLL UPDATES =================

    sock.ev.on(
      "messages.update",
      async updates => {

        for (
          const {
            key,
            update
          }
          of updates
        ) {

          try {

            if (
              update?.pollUpdates
            ) {

              await awardPollVotes(
                sock,
                key.id,
                update.pollUpdates
              );

            }

          } catch (error) {

            console.log(
              "❌ Poll update error:",
              error.message
            );

          }

        }

      }
    );

    // ================= AUTOMATIC CONTENT =================

    if (
      !intervalStarted
    ) {

      intervalStarted =
        true;

      setInterval(
        async () => {

          if (
            !globalSock
          ) {

            return;

          }

          for (
            const group
            of ALLOWED_GROUPS
          ) {

            try {

              await sendContent(
                globalSock,
                group
              );

            } catch (error) {

              console.log(
                "❌ Automatic content error:",
                error.message
              );

            }

          }

        },
        CONTENT_INTERVAL
      );

      console.log(
        "⏱️ Automatic content started."
      );

    }

  } catch (error) {

    console.log(
      "❌ BOT START ERROR:",
      error.message
    );

    globalSock =
      null;

    console.log(
      "🔄 Restarting in 10 seconds..."
    );

    setTimeout(
      startBot,
      10000
    );

  }

}

// ================= START =================

loadPoints();

console.log(
  `⭐ Loaded ${
    Object.keys(points).length
  } players.`
);

startBot();