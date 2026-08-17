const fs = require("fs");
const path = require("path");
const axios = require("axios");
require("../config/env");


const {
  executeSync,
  getStatus,
  on,
  setCronExpression,
  startScheduler,
  stopScheduler,
} = require("../cron/scheduler");
const { createLogger, getLogFiles } = require("../utils/logger");

const logger = createLogger("telegramBot");
const token = process.env.TELEGRAM_BOT_TOKEN;
const telegramDataDir = path.join(process.cwd(), "data");
const knownChatIdsFilePath = path.join(telegramDataDir, "telegram-chat-ids.json");
const allowedChatIds = new Set(
  (process.env.TELEGRAM_ALLOWED_CHAT_IDS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);

let offset = 0;
let polling = false;
const pendingActions = new Map();
const knownChatIds = loadKnownChatIds();
const LOGS_PAGE_SIZE = 10;
const BUTTONS = {
  status: "Ստատուս",
  runNow: "Թարմացնել հիմա",
  schedule: "Կարգացույց",
  logs: "Լոգեր",
  start: "Միացնել",
  stop: "Կանգնեցնել",
  dailyTime: "Ամեն օր նշված ժամին",
  everyMinute: "Ամեն րոպե",
  back: "Հետ",
  seeMore: "տեսնել ավելին",
};
const TELEGRAM_COMMANDS = [
  { command: "start", description: "Բացել կառավարման մենյուն" },
  { command: "status", description: "Տեսնել ընթացիկ կարգավիճակը" },
  { command: "logs", description: "Բացել վերջին լոգերը" },
  { command: "id", description: "Տեսնել chat id-ն" },
];

function loadKnownChatIds() {
  try {
    if (!fs.existsSync(knownChatIdsFilePath)) {
      return new Set();
    }

    const raw = fs.readFileSync(knownChatIdsFilePath, "utf8");
    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed)) {
      return new Set();
    }

    return new Set(
      parsed
        .map((value) => String(value).trim())
        .filter(Boolean),
    );
  } catch (error) {
    logger.warn("Failed to load Telegram chat ids", error.message);
    return new Set();
  }
}

function saveKnownChatIds() {
  fs.mkdirSync(telegramDataDir, { recursive: true });
  fs.writeFileSync(
    knownChatIdsFilePath,
    JSON.stringify(Array.from(knownChatIds).sort(), null, 2),
    "utf8",
  );
}

function getBaseUrl() {
  return `https://api.telegram.org/bot${token}`;
}

function isAuthorized(chatId) {
  if (!allowedChatIds.size) {
    return true;
  }

  return allowedChatIds.has(String(chatId));
}

function rememberChatId(chatId) {
  const normalizedChatId = String(chatId);

  if (knownChatIds.has(normalizedChatId)) {
    return;
  }

  knownChatIds.add(normalizedChatId);
  saveKnownChatIds();
  logger.info("Telegram chat registered", { chatId: normalizedChatId });
}

function getNotificationChatIds() {
  if (allowedChatIds.size) {
    return Array.from(allowedChatIds);
  }

  return Array.from(knownChatIds);
}

function buildMainKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: BUTTONS.status, callback_data: "status" },
        { text: BUTTONS.runNow, callback_data: "run_now" },
      ],
      [
        { text: BUTTONS.schedule, callback_data: "menu:schedule" },
        { text: BUTTONS.logs, callback_data: "menu:logs" },
      ],
      [
        { text: BUTTONS.start, callback_data: "start_sched" },
        { text: BUTTONS.stop, callback_data: "stop_sched" },
      ],
    ],
  };
}

function buildScheduleKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: BUTTONS.dailyTime, callback_data: "sched:daily_time" },
      ],
      [
        { text: BUTTONS.everyMinute, callback_data: "sched:every_minute" },
        { text: BUTTONS.back, callback_data: "menu:main" },
      ],
    ],
  };
}

function describeSchedule(expression) {
  const dailyMatch = expression.match(/^(\d{1,2}) (\d{1,2}) \* \* \*$/);

  if (dailyMatch) {
    const minute = dailyMatch[1].padStart(2, "0");
    const hour = dailyMatch[2].padStart(2, "0");
    return `Ամեն օր ${hour}:${minute}`;
  }

  if (expression === "*/1 * * * *") {
    return "Ամեն րոպե";
  }

  return expression;
}

function buildLogsKeyboard(offset = 0) {
  const allLogFiles = getLogFiles(Number.MAX_SAFE_INTEGER);
  const start = Math.max(0, Number(offset) || 0);
  const logFiles = allLogFiles.slice(start, start + LOGS_PAGE_SIZE);
  const rows = logFiles.map((item) => [
    {
      text: `Լոգ ${item.file.replace(/^log/i, "#").replace(".txt", "")}`,
      callback_data: `log:${item.file}`,
    },
  ]);

  if (start + LOGS_PAGE_SIZE < allLogFiles.length) {
    rows.push([{ text: BUTTONS.seeMore, callback_data: `logs:${start + LOGS_PAGE_SIZE}` }]);
  }

  rows.push([{ text: BUTTONS.back, callback_data: "menu:main" }]);

  return {
    logFiles,
    total: allLogFiles.length,
    offset: start,
    replyMarkup: {
      inline_keyboard: rows,
    },
  };
}

function formatStatus() {
  const status = getStatus();
  const schedulerState = status.enabled ? "Միացված" : "Կանգնած";
  // const runState = status.isRunning ? "Ընթացքի մեջ" : "Չի աշխատում";

  return [
    "MilonMining կառավարման վահանակ",
    "",
    `Պլանավորիչ: ${schedulerState}`,
    `Ընթացիկ ռեժիմ: ${describeSchedule(status.cronExpression)}`,
    // `Գործընթաց: ${runState}`,
    `Վերջին թարմացումը: ${status.lastRunAt || "Դեռ չի եղել"}`,
    `Վերջին սխալը: ${status.lastError || "Չկա"}`,
    `Cron: ${status.cronExpression}`,
  ].join("\n");
}

function parseDailyTime(text) {
  const match = text.trim().match(/^(\d{1,2}):(\d{2})$/);

  if (!match) {
    return null;
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }

  return {
    hour,
    minute,
    expression: `${minute} ${hour} * * *`,
    label: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
  };
}

function formatRunStartedMessage(payload) {
  return [
    "Թարմացումը սկսվել է",
    "",
    `Աղբյուր: ${payload.trigger}`,
    `Սկսվել է: ${payload.startedAt}`,
  ].join("\n");
}

function formatRunFinishedMessage(payload) {
  if (!payload.ok) {
    return [
      "Թարմացումն ավարտվել է",
      "",
      "Արդյունք: Սխալ",
      `Սխալ: ${payload.error}`,
      `Լոգ ֆայլ: ${path.basename(payload.filePath)}`,
    ].join("\n");
  }

  return [
    "Թարմացումն ավարտվել է",
    "",
    "Արդյունք: Հաջող",
    `Ընդամենը: ${payload.summary.total}`,
    `Թարմացվել է: ${payload.summary.updated}`,
    `Բաց է թողնվել: ${payload.summary.skipped}`,
    `Ավելացվել է: ${payload.summary.inserted}`,
    `Անփոփոխ է: ${payload.summary.unchanged}`,
    `Լոգ ֆայլ: ${path.basename(payload.filePath)}`,
  ].join("\n");
}

async function api(method, payload) {
  const response = await axios.post(`${getBaseUrl()}/${method}`, payload);
  return response.data;
}

async function registerBotCommands() {
  await api("setMyCommands", {
    commands: TELEGRAM_COMMANDS,
  });
}

async function sendMessage(chatId, text, replyMarkup) {
  return api("sendMessage", {
    chat_id: chatId,
    text,
    reply_markup: replyMarkup,
  });
}

async function editMessage(chatId, messageId, text, replyMarkup) {
  return api("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    reply_markup: replyMarkup,
  });
}

async function replaceCallbackMessage(callbackQuery, text, replyMarkup) {
  const chatId = callbackQuery.message?.chat?.id;
  const messageId = callbackQuery.message?.message_id;

  if (!chatId || !messageId) {
    return sendMessage(chatId, text, replyMarkup);
  }

  try {
    return await editMessage(chatId, messageId, text, replyMarkup);
  } catch (error) {
    const description = error.response?.data?.description || error.message;

    if (description.includes("message is not modified")) {
      return null;
    }

    if (
      description.includes("message can't be edited")
      || description.includes("message to edit not found")
    ) {
      return sendMessage(chatId, text, replyMarkup);
    }

    throw error;
  }
}

async function answerCallbackQuery(callbackQueryId, text) {
  return api("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text,
  });
}

async function sendDocument(chatId, filePath, fileName) {
  const formData = new FormData();
  const buffer = fs.readFileSync(filePath);

  formData.append("chat_id", String(chatId));
  formData.append("document", new Blob([buffer]), fileName);

  const response = await axios.post(`${getBaseUrl()}/sendDocument`, formData);
  return response.data;
}

async function handleCommand(message) {
  const chatId = message.chat.id;
  const text = message.text || "";

  rememberChatId(chatId);

  if (text === "/id") {
    await sendMessage(chatId, `Քո chat id-ն է ${chatId}`);
    return;
  }

  if (!isAuthorized(chatId)) {
    logger.warn("Unauthorized Telegram access attempt", { chatId, text });
    await sendMessage(chatId, "Դու թույլատրված չես։");
    return;
  }

  const pendingAction = pendingActions.get(chatId);

  if (pendingAction === "await_daily_time") {
    const parsedTime = parseDailyTime(text);

    if (!parsedTime) {
      await sendMessage(
        chatId,
        "Ժամը սխալ ձևաչափով է։\nՈւղարկիր օրինակ `13:00`",
        buildScheduleKeyboard(),
      );
      return;
    }

    setCronExpression(parsedTime.expression);
    startScheduler();
    pendingActions.delete(chatId);

    await sendMessage(
      chatId,
      `Ժամանակացույցը հաջողությամբ թարմացվեց։\nՆոր ժամը ամեն օր ${parsedTime.label}\n\n${formatStatus()}`,
      buildMainKeyboard(),
    );
    return;
  }

  if (text === "/start") {
    await sendMessage(
      chatId,
      [
        "Բարի գալուստ MilonMining կառավարման բոտ։",
        "Այս chat-ից կարող ես տեսնել կարգավիճակը և կառավարել scheduler-ը։",
      ].join("\n"),
      buildMainKeyboard(),
    );
    return;
  }

  if (text === "/status") {
    await sendMessage(chatId, formatStatus(), buildMainKeyboard());
    return;
  }

  if (text === "/logs") {
    const { logFiles, replyMarkup } = buildLogsKeyboard();

    await sendMessage(
      chatId,
      logFiles.length ? "Սրանք վերջին լոգ ֆայլերն են, ընտրիր որը ուղարկել։" : "Լոգ ֆայլեր դեռ չկան։",
      replyMarkup,
    );
  }
}

async function handleCallbackQuery(callbackQuery) {
  const chatId = callbackQuery.message.chat.id;
  const callbackData = callbackQuery.data || "";

  rememberChatId(chatId);

  if (!isAuthorized(chatId)) {
    await answerCallbackQuery(callbackQuery.id, "Դու թույլատրված չես");
    return;
  }

  if (callbackData === "menu:main") {
    await replaceCallbackMessage(
      callbackQuery,
      "Կառավարման գլխավոր մենյուն",
      buildMainKeyboard(),
    );
    await answerCallbackQuery(callbackQuery.id, "Գլխավոր մենյունը բացվեց");
    return;
  }

  if (callbackData === "menu:schedule") {
    await replaceCallbackMessage(
      callbackQuery,
      "Ընտրիր, թե ինչպես պետք է գործի scheduler-ը։",
      buildScheduleKeyboard(),
    );
    await answerCallbackQuery(callbackQuery.id, "Ժամանակացույցի բաժինը բացվեց");
    return;
  }

  if (callbackData === "menu:logs") {
    const { logFiles, replyMarkup } = buildLogsKeyboard();

    await replaceCallbackMessage(
      callbackQuery,
      logFiles.length ? "Սրանք վերջին լոգ ֆայլերն են, ընտրիր որը ուղարկել։" : "Լոգ ֆայլեր դեռ չկան։",
      replyMarkup,
    );
    await answerCallbackQuery(callbackQuery.id, "Լոգերի բաժինը բացվեց");
    return;
  }

  if (callbackData.startsWith("logs:")) {
    const nextOffset = Number(callbackData.slice(5));
    const { logFiles, replyMarkup } = buildLogsKeyboard(nextOffset);

    await replaceCallbackMessage(
      callbackQuery,
      logFiles.length ? "Սրանք լոգ ֆայլերն են, ընտրիր որը ուղարկել։" : "Այլ լոգ ֆայլեր չկան։",
      replyMarkup,
    );
    await answerCallbackQuery(callbackQuery.id, "Լոգերի հաջորդ էջը բացվեց");
    return;
  }

  if (callbackData === "status") {
    await replaceCallbackMessage(callbackQuery, formatStatus(), buildMainKeyboard());
    await answerCallbackQuery(callbackQuery.id, "Կարգավիճակը թարմացվեց");
    return;
  }

  if (callbackData === "run_now") {
    await answerCallbackQuery(callbackQuery.id, "Թարմացումը սկսվում է");
    const result = await executeSync("telegram");

    if (result.skipped) {
      await replaceCallbackMessage(
        callbackQuery,
        "Թարմացումը չսկսվեց, որովհետև արդեն ընթացքի մեջ է։",
        buildMainKeyboard(),
      );
    }

    return;
  }

  if (callbackData === "start_sched") {
    startScheduler();
    await replaceCallbackMessage(callbackQuery, formatStatus(), buildMainKeyboard());
    await answerCallbackQuery(callbackQuery.id, "Պլանավորիչը միացվեց");
    return;
  }

  if (callbackData === "stop_sched") {
    stopScheduler();
    await replaceCallbackMessage(callbackQuery, formatStatus(), buildMainKeyboard());
    await answerCallbackQuery(callbackQuery.id, "Պլանավորիչը կանգնեցվեց");
    return;
  }

  if (callbackData === "sched:daily_time") {
    pendingActions.set(chatId, "await_daily_time");
    await replaceCallbackMessage(
      callbackQuery,
      "Ուղարկիր ժամը HH:MM ձևաչափով։\nՕրինակ՝ `13:00`",
      buildScheduleKeyboard(),
    );
    await answerCallbackQuery(callbackQuery.id, "Ուղարկիր ժամը 13:00 ձևաչափով");
    return;
  }

  if (callbackData === "sched:every_minute") {
    setCronExpression("*/1 * * * *");
    startScheduler();

    await replaceCallbackMessage(
      callbackQuery,
      `Ժամանակացույցը հաջողությամբ թարմացվեց։\nՆոր ռեժիմը ամեն րոպե\n\n${formatStatus()}`,
      buildMainKeyboard(),
    );
    await answerCallbackQuery(callbackQuery.id, "Ժամանակացույցը թարմացվեց");
    return;
  }

  if (callbackData.startsWith("log:")) {
    const fileName = callbackData.slice(4);
    const match = getLogFiles(Number.MAX_SAFE_INTEGER).find((item) => item.file === fileName);

    if (!match) {
      await answerCallbackQuery(callbackQuery.id, "Լոգ ֆայլը չի գտնվել");
      return;
    }

    await answerCallbackQuery(callbackQuery.id, "Լոգ ֆայլը ուղարկվում է");
    await sendDocument(chatId, match.filePath, match.file);
  }
}

async function poll() {
  if (polling) {
    return;
  }

  polling = true;

  while (polling) {
    try {
      const response = await axios.get(`${getBaseUrl()}/getUpdates`, {
        params: {
          offset,
          timeout: 30,
        },
      });

      const updates = response.data.result || [];

      for (const update of updates) {
        offset = update.update_id + 1;

        if (update.message?.text) {
          await handleCommand(update.message);
        }

        if (update.callback_query) {
          await handleCallbackQuery(update.callback_query);
        }
      }
    } catch (error) {
      logger.error("Telegram polling failed", error, error.response?.data);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

async function broadcast(text, replyMarkup) {
  const chatIds = getNotificationChatIds();

  for (const chatId of chatIds) {
    try {
      await sendMessage(chatId, text, replyMarkup);
    } catch (error) {
      logger.error("Failed to send Telegram broadcast", {
        chatId,
        error: error.message,
      });
    }
  }
}

function initTelegramBot() {
  if (!token) {
    logger.warn("Telegram bot is disabled. TELEGRAM_BOT_TOKEN is missing.");
    return;
  }

  on("start", async (payload) => {
    await broadcast(formatRunStartedMessage(payload));
  });

  on("finish", async (payload) => {
    await broadcast(formatRunFinishedMessage(payload));
  });

  logger.info("Telegram bot polling started");
  registerBotCommands()
    .then(() => {
      logger.info("Telegram bot commands registered", {
        commands: TELEGRAM_COMMANDS.map((item) => item.command),
      });
    })
    .catch((error) => {
      logger.error("Failed to register Telegram commands", error, error.response?.data);
    });
  poll();
}

module.exports = {
  initTelegramBot,
}; 
