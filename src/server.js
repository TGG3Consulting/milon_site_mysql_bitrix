require("./config/env");
const { createLogger } = require("./utils/logger");
const logger = createLogger("server");

process.on("uncaughtException", (error) => {
  logger.error("Uncaught exception", error, error?.response?.data);
});

process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled rejection", reason instanceof Error ? reason : new Error(String(reason)));
});

const { initScheduler } = require("./cron/scheduler");
const { initTelegramBot } = require("./services/telegramBot");

initScheduler();
initTelegramBot();
logger.info("Connector started");