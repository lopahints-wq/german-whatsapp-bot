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
  res.send("🇩🇪 German B1 AI Bot is running!");
});

app.listen(PORT, () => {
  console.log(`🌐 Server started on port ${PORT}`);
});

// ==================================================
// SETTINGS
// ==================================================

// المجموعة التي يرسل فيها البوت الدروس
const ALLOWED_GROUPS = [
  "120363423888719176@g.us"
];

// للتجربة: رسالة تعليمية كل دقيقة
const CONTENT_INTERVAL = 60 * 1000;

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

// ==================================================
// RANDOM TOPIC
// ==================================================

function getRandomTopic() {

  return TOPICS[
    Math.floor(
      Math.random() * TOPICS.length
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

        body: JSON.stringify({

          model:
            "openai/gpt-oss-20b",

          instructions: `
أنت مدرس لغة ألمانية متخصص في مستوى B1 فقط.

مهمتك إنشاء محتوى تعليمي قصير جداً لمجموعة WhatsApp.

القواعد المهمة:

1. استخدم مستوى B1 فقط.
2. لا تستخدم شرحاً طويلاً.
3. لا تكرر نفس الموضوع باستمرار.
4. اجعل المحتوى عملياً من الحياة اليومية.
5. استخدم الألمانية للمحتوى.
6. استخدم العربية فقط للترجمة أو الشرح القصير.
7. لا تضف مقدمات طويلة.
8. لا تستخدم Markdown tables.
9. لا تكتب أكثر مما هو مطلوب.
10. إذا كان النوع يحتاج Poll، يجب أن يكون هناك 3 اختيارات فقط.
11. يجب أن تكون إجابة Poll واحدة صحيحة فقط.

أنواع المحتوى:

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
أرسل 5 أفعال ألمانية مهمة.
لكل فعل:
Infinitiv
Präteritum
Perfekt
المعنى بالعربية.
بدون شرح طويل.

SITUATION:
موقف عملي قصير B1 من الحياة اليومية.
4 إلى 6 أسطر.
ثم سؤال واحد.
3 اختيارات فقط.

إذا كان النوع DIALOGUE أو SITUATION:
يجب أن يكون الناتج بهذا الشكل بالضبط:

TYPE:
DIALOGUE

TITLE:
عنوان قصير

CONTENT:
المحتوى هنا

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

ممنوع إضافة كلام خارج هذه الصيغة.
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
      "Groq returned empty answer."
    );

  }

  console.log(
    "🤖 AI content generated."
  );

  return answer;

}

// ==================================================
// PARSE CONTENT
// ==================================================

function getField(text, field, nextFields = []) {

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
// PARSE POLL CONTENT
// ==================================================

function parsePollContent(text) {

  const type =
    getField(
      text,
      "TYPE",
      ["TITLE", "CONTENT"]
    );

  const title =
    getField(
      text,
      "TITLE",
      ["CONTENT"]
    );

  const content =
    getField(
      text,
      "CONTENT",
      ["QUESTION"]
    );

  const question =
    getField(
      text,
      "QUESTION",
      ["OPTION1"]
    );

  const option1 =
    getField(
      text,
      "OPTION1",
      ["OPTION2"]
    );

  const option2 =
    getField(
      text,
      "OPTION2",
      ["OPTION3"]
    );

  const option3 =
    getField(
      text,
      "OPTION3",
      ["ANSWER"]
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
    !/^[123]$/.test(answer)
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
      ["EXAMPLE_TRANSLATION"]
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
// CREATE CONTENT
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
بعده سؤال فهم واحد و3 اختيارات.
`;

  }

  else if (
    type === "word"
  ) {

    instruction = `
النوع: WORD

اختر كلمة B1 مرتبطة بالحياة اليومية.
لا تختار كلمة سهلة جداً.
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

أنشئ موقفاً عملياً قصيراً بمستوى B1.
4 إلى 6 أسطر.
بعده سؤال فهم واحد و3 اختيارات.
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

  let messageText =
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

  await sock.sendMessage(
    jid,
    pollMessage
  );

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
    !ALLOWED_GROUPS.includes(jid)
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
            "⏱️ Every 1 minute"
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
                    "🇩🇪🤖 German B1 AI Bot\n\n" +
                    "✅ البوت يعمل.\n" +
                    "🧠 Groq متصل.\n" +
                    "📚 نظام B1 يعمل."
                }
              );

              continue;

            }

            // ==================================================
            // !now
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
                    "🇩🇪 *German B1 AI Bot*\n\n" +

                    "📚 المحتوى يصل تلقائياً.\n\n" +

                    "💬 حوارات B1\n" +
                    "🧠 كلمات وترجمة\n" +
                    "📚 قواعد قصيرة\n" +
                    "🔥 أفعال وتصريفاتها\n" +
                    "🛒 مواقف الحياة اليومية\n" +
                    "📝 Poll بثلاثة اختيارات\n\n" +

                    "⚡ !now\n" +
                    "إرسال محتوى تجريبي الآن."
                }
              );

              continue;

            }

            // ==================================================
            // AI
            // ==================================================

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

            const answer =
              await askAI(
                `
السؤال من أحد أعضاء مجموعة ألمانية:

${aiQuestion}

أجب كمدرس ألمانية B1.
`
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
    // AUTOMATIC CONTENT
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