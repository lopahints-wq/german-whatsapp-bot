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

// المجموعة الوحيدة التي تستقبل التمارين
const ALLOWED_GROUPS = [
  "120363410722950290@g.us"
];

// تمرين كل دقيقة
const EXERCISE_INTERVAL = 60 * 1000;

// ==================================================
// GLOBAL BOT
// ==================================================

let globalSock = null;

// منع إنشاء أكثر من مؤقت
let exerciseTimer = null;

// منع تشغيل أكثر من اتصال في نفس الوقت
let startingBot = false;

// ==================================================
// ALLOWED GROUP
// ==================================================

function isAllowedGroup(jid) {
  return ALLOWED_GROUPS.includes(jid);
}

// ==================================================
// GET MESSAGE TEXT
// ==================================================

function getMessageText(msg) {

  if (msg.message?.conversation) {
    return msg.message.conversation;
  }

  if (
    msg.message?.extendedTextMessage?.text
  ) {
    return msg.message.extendedTextMessage.text;
  }

  if (
    msg.message?.ephemeralMessage?.message?.conversation
  ) {
    return msg.message.ephemeralMessage.message.conversation;
  }

  if (
    msg.message
      ?.ephemeralMessage
      ?.message
      ?.extendedTextMessage
      ?.text
  ) {
    return msg.message
      .ephemeralMessage
      .message
      .extendedTextMessage
      .text;
  }

  if (
    msg.message
      ?.viewOnceMessage
      ?.message
      ?.conversation
  ) {
    return msg.message
      .viewOnceMessage
      .message
      .conversation;
  }

  if (
    msg.message
      ?.viewOnceMessage
      ?.message
      ?.extendedTextMessage
      ?.text
  ) {
    return msg.message
      .viewOnceMessage
      .message
      .extendedTextMessage
      .text;
  }

  return "";
}

// ==================================================
// GROQ AI
// ==================================================

async function askAI(question) {

  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey) {
    throw new Error(
      "GROQ_API_KEY is missing."
    );
  }

  console.log("🧠 Sending request to Groq...");
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
أنت مدرس لغة ألمانية داخل مجموعة WhatsApp.

مهمتك إنشاء تمارين ألمانية مناسبة من A1 إلى B1.

عند إنشاء تمرين:

- أنشئ سؤالاً واحداً فقط.
- استخدم اللغة الألمانية في السؤال.
- استخدم 3 اختيارات فقط.
- يجب أن تكون إجابة واحدة صحيحة.
- لا تكتب شرحاً.
- لا تكتب الإجابة الصحيحة خارج خانة ANSWER.
- لا تستخدم 4 اختيارات.
- غيّر نوع السؤال في كل مرة قدر الإمكان.

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
- قواعد A1
- قواعد A2
- قواعد B1

أعد النتيجة بهذا الشكل فقط:

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

أو:

ANSWER:
2

أو:

ANSWER:
3
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

  // ------------------------------------------
  // output_text
  // ------------------------------------------

  if (
    typeof data.output_text === "string"
  ) {
    answer = data.output_text.trim();
  }

  // ------------------------------------------
  // output[]
  // ------------------------------------------

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

            answer = content.text.trim();

            break;
          }
        }
      }

      if (answer) break;
    }
  }

  if (!answer) {

    console.log(
      "❌ Groq returned no text."
    );

    console.log(
      JSON.stringify(data, null, 2)
    );

    throw new Error(
      "Groq returned an empty answer."
    );
  }

  console.log("🤖 AI:", answer);

  return answer;
}

// ==================================================
// PARSE EXERCISE
// ==================================================

function parseExercise(text) {

  if (!text) {
    return null;
  }

  const questionMatch =
    text.match(
      /QUESTION:\s*([\s\S]*?)(?=\s*OPTION1:)/i
    );

  const option1Match =
    text.match(
      /OPTION1:\s*([\s\S]*?)(?=\s*OPTION2:)/i
    );

  const option2Match =
    text.match(
      /OPTION2:\s*([\s\S]*?)(?=\s*OPTION3:)/i
    );

  const option3Match =
    text.match(
      /OPTION3:\s*([\s\S]*?)(?=\s*ANSWER:)/i
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
    Number(answerMatch[1]);

  if (!question) {
    return null;
  }

  if (
    options.length !== 3
  ) {
    return null;
  }

  if (
    options.some(
      option => !option
    )
  ) {
    return null;
  }

  if (
    ![1, 2, 3].includes(answer)
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
// GENERATE AI EXERCISE
// ==================================================

async function generateExercise() {

  const prompt = `
أنشئ الآن تمريناً جديداً باللغة الألمانية.

اختر عشوائياً مستوى A1 أو A2 أو B1.

استخدم ثلاثة اختيارات فقط.

يجب أن تكون إجابة واحدة صحيحة فقط.

لا تكرر نفس نوع السؤال السابق إن أمكن.

أخرج النتيجة بالتنسيق المطلوب.
`;

  const aiResponse =
    await askAI(prompt);

  return parseExercise(
    aiResponse
  );
}

// ==================================================
// SEND WHATSAPP POLL
// ==================================================

async function sendExercisePoll(
  sock,
  jid
) {

  if (!isAllowedGroup(jid)) {
    return;
  }

  try {

    console.log(
      `🧠 Creating exercise for ${jid}...`
    );

    const exercise =
      await generateExercise();

    if (!exercise) {

      console.log(
        "❌ Could not create exercise."
      );

      return;
    }

    const poll = {

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

    await sock.sendMessage(
      jid,
      poll
    );

    console.log(
      "✅ Poll sent successfully."
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
// START EXERCISE TIMER
// ==================================================

function startExerciseTimer() {

  // إذا كان مؤقت موجود بالفعل لا تنشئ واحدًا آخر
  if (exerciseTimer) {
    return;
  }

  console.log(
    "⏱️ Starting exercise timer..."
  );

  exerciseTimer =
    setInterval(
      async () => {

        // لا ترسل إذا WhatsApp غير متصل
        if (!globalSock) {

          console.log(
            "⏭️ WhatsApp not connected. Skipping exercise."
          );

          return;
        }

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

// ==================================================
// STOP EXERCISE TIMER
// ==================================================

function stopExerciseTimer() {

  if (!exerciseTimer) {
    return;
  }

  clearInterval(
    exerciseTimer
  );

  exerciseTimer = null;

  console.log(
    "⏹️ Exercise timer stopped."
  );
}

// ==================================================
// START BOT
// ==================================================

async function startBot() {

  // منع startBot من العمل مرتين في نفس اللحظة
  if (startingBot) {

    console.log(
      "⏳ Bot is already starting..."
    );

    return;
  }

  startingBot = true;

  try {

    console.log(
      "🚀 Starting German WhatsApp AI Bot..."
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
    // SOCKET
    // ==================================================

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

    globalSock = sock;

    // السماح بإعادة start بعد إنشاء socket
    startingBot = false;

    // ==================================================
    // SAVE CREDENTIALS
    // ==================================================

    sock.ev.on(
      "creds.update",
      saveCreds
    );

    // ==================================================
    // CONNECTION UPDATE
    // ==================================================

    sock.ev.on(
      "connection.update",
      async (update) => {

        const {
          connection,
          lastDisconnect
        } = update;

        // ------------------------------------------
        // CONNECTING
        // ------------------------------------------

        if (
          connection === "connecting"
        ) {

          console.log(
            "🔄 Connecting to WhatsApp..."
          );
        }

        // ------------------------------------------
        // OPEN
        // ------------------------------------------

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
            "🤖 GERMAN AI BOT READY!"
          );

          console.log(
            "📝 AI POLL READY!"
          );

          console.log(
            "⏱️ Exercise every 1 minute"
          );

          console.log(
            "💲 AI only responds to $"
          );

          console.log(
            "======================================"
          );

          console.log("");

          // تشغيل مؤقت واحد فقط
          startExerciseTimer();
        }

        // ------------------------------------------
        // CLOSE
        // ------------------------------------------

        if (
          connection === "close"
        ) {

          // أوقف المؤقت
          stopExerciseTimer();

          // إزالة socket القديم
          if (
            globalSock === sock
          ) {

            globalSock = null;
          }

          let code = 0;

          try {

            if (
              lastDisconnect?.error
            ) {

              const error =
                lastDisconnect.error;

              if (
                error instanceof Boom
              ) {

                code =
                  error.output.statusCode;

              }

              else if (
                error?.output?.statusCode
              ) {

                code =
                  error.output.statusCode;
              }
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

          // ------------------------------------------
          // LOGGED OUT
          // ------------------------------------------

          if (
            code ===
            DisconnectReason.loggedOut
          ) {

            console.log(
              "⚠️ WhatsApp logged out."
            );

            console.log(
              "⚠️ You must pair WhatsApp again."
            );

            return;
          }

          // ------------------------------------------
          // RECONNECT
          // ------------------------------------------

          console.log(
            "🔄 Reconnecting in 5 seconds..."
          );

          setTimeout(
            () => {

              startBot()
                .catch(
                  error => {

                    console.log(
                      "❌ Reconnect error:",
                      error.message
                    );
                  }
                );

            },
            5000
          );
        }
      }
    );

    // ==================================================
    // PAIRING CODE
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

            // لا تعالج رسائل البوت نفسه
            if (msg.key.fromMe) {
              continue;
            }

            const jid =
              msg.key.remoteJid;

            if (!jid) {
              continue;
            }

            // المجموعات فقط
            if (
              !jid.endsWith("@g.us")
            ) {
              continue;
            }

            const text =
              getMessageText(
                msg
              ).trim();

            if (!text) {
              continue;
            }

            console.log("");
            console.log(
              "📩 GROUP MESSAGE:",
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
                    "🇩🇪🤖 German WhatsApp AI Bot\n\n" +
                    "✅ البوت يعمل بشكل صحيح.\n" +
                    "🧠 Groq AI متصل.\n" +
                    "📝 نظام الاستفتاءات يعمل."
                }
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
                    "🇩🇪🤖 *German WhatsApp AI Bot*\n\n" +

                    "📝 يتم إرسال تمرين ألماني تلقائياً كل دقيقة.\n\n" +

                    "📊 التمرين عبارة عن WhatsApp Poll بثلاثة اختيارات.\n\n" +

                    "💲 الذكاء الاصطناعي:\n" +
                    "اكتب رسالتك بهذا الشكل:\n\n" +

                    "$Was bedeutet gehen?\n\n" +

                    "💡 الرسائل العادية لا يرد عليها البوت."
                }
              );

              continue;
            }

            // ==================================================
            // ONLY ALLOWED GROUP FOR AI/COMMANDS?
            // ==================================================

            // الأوامر وAI يمكن أن تعمل فقط في المجموعة المسموحة
            if (
              !isAllowedGroup(jid)
            ) {

              console.log(
                "⏭️ Group is not allowed."
              );

              continue;
            }

            // ==================================================
            // AI ONLY WITH $
            // ==================================================

            if (
              !text.startsWith("$")
            ) {

              console.log(
                "⏭️ Ignored - no $ prefix."
              );

              continue;
            }

            const aiQuestion =
              text
                .slice(1)
                .trim();

            if (!aiQuestion) {
              continue;
            }

            console.log(
              "🤖 Sending question to AI..."
            );

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

            console.log(
              "✅ AI reply sent."
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

    startingBot = false;

    globalSock = null;

    stopExerciseTimer();

    console.log(
      "❌ BOT START ERROR:",
      error.message
    );

    console.log(
      "🔄 Restarting in 10 seconds..."
    );

    setTimeout(
      () => {

        startBot()
          .catch(
            err => {

              console.log(
                "❌ Restart failed:",
                err.message
              );
            }
          );

      },
      10000
    );
  }
}

// ==================================================
// START
// ==================================================

startBot();