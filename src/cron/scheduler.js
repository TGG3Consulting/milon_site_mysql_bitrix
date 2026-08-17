const fs = require("fs");
const path = require("path");
const cron = require("node-cron");

const syncApartments = require("../sync/syncApartments");
const { createLogger, createLogFile } = require("../utils/logger");

const schedulerLogger = createLogger("scheduler");
const configPath = path.join(__dirname, "..", "config", "scheduler.json");
const defaultConfig = {
  enabled: true,
  cronExpression: "*/1 * * * *",
};
const schedulerTimezone = process.env.SCHEDULER_TIMEZONE || "Asia/Yerevan";

let task = null;
let isRunning = false;
let lastRunAt = null;
let lastSummary = null;
let lastError = null;
let config = loadConfig();
const listeners = {
  start: new Set(),
  finish: new Set(),
};

// config papka create
function ensureConfigDir() {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
}

// scheduler config kardal
function loadConfig() {
  ensureConfigDir();

  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2), "utf8");
    return { ...defaultConfig };
  }

  try {
    const rawConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));

    return {
      ...defaultConfig,
      ...rawConfig,
    };
  } catch (error) {
    schedulerLogger.error("Failed to load scheduler config, using defaults", error.message);
    return { ...defaultConfig };
  }
}

// scheduler config pahpanal
function saveConfig() {
  ensureConfigDir();
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");
}

// eventner kanchel
async function emit(eventName, payload) {
  const handlers = listeners[eventName] || [];

  for (const handler of handlers) {
    try {
      await handler(payload);
    } catch (error) {
      schedulerLogger.error(`Scheduler ${eventName} listener failed`, error.message);
    }
  }
}

// sync run anel
async function executeSync(trigger = "scheduled") {
  if (isRunning) {
    return {
      skipped: true,
      reason: "already_running",
    };
  }

  isRunning = true;
  lastError = null;

  const filePath = createLogFile();
  const runLogger = createLogger("scheduler", { filePath });
  const syncLogger = createLogger("syncApartments", { filePath });
  const startedAt = new Date().toISOString();

  try {
    runLogger.info("SYNC START", { trigger, filePath });
    await emit("start", { trigger, filePath, startedAt });

    const summary = await syncApartments(syncLogger);

    if (!summary) {
      throw new Error("Sync completed without summary");
    }

    runLogger.section("FINAL SUMMARY", summary);

    runLogger.info("SYNC END");

    lastRunAt = new Date().toISOString();
    lastSummary = summary;
    lastError = null;

    const result = {
      ok: true,
      summary,
      filePath,
      trigger,
      startedAt,
      finishedAt: lastRunAt,
    };

    await emit("finish", result);

    return result;
  } catch (error) {
    lastError = error.message;
    runLogger.error("SYNC FAILED", error.message);

    const finishedAt = new Date().toISOString();
    const result = {
      ok: false,
      error: error.message,
      filePath,
      trigger,
      startedAt,
      finishedAt,
    };

    await emit("finish", result);

    return result;
  } finally {
    isRunning = false;
  }
}

// cron task stexcel
function scheduleTask() {
  if (task) {
    task.stop();
    task.destroy();
  }

  task = cron.schedule(config.cronExpression, () => {
    executeSync("scheduled");
  }, {
    scheduled: config.enabled,
    timezone: schedulerTimezone,
  });

  if (config.enabled) {
    task.start();
  } else {
    task.stop();
  }
}

// scheduler miacnel
function initScheduler() {
  scheduleTask();
  schedulerLogger.info("Scheduler initialized", getStatus());
}

// scheduler start
function startScheduler() {
  config.enabled = true;
  saveConfig();
  scheduleTask();
  schedulerLogger.info("Scheduler started", getStatus());
  return getStatus();
}

// scheduler stop
function stopScheduler() {
  config.enabled = false;
  saveConfig();

  if (task) {
    task.stop();
  }

  schedulerLogger.warn("Scheduler stopped", getStatus());
  return getStatus();
}

// cron text poxel
function setCronExpression(cronExpression) {
  if (!cron.validate(cronExpression)) {
    throw new Error("Invalid cron expression");
  }

  config.cronExpression = cronExpression;
  saveConfig();
  scheduleTask();
  schedulerLogger.info("Scheduler expression updated", getStatus());

  return getStatus();
}

// scheduler status
function getStatus() {
  return {
    enabled: config.enabled,
    cronExpression: config.cronExpression,
    timezone: schedulerTimezone,
    isRunning,
    lastRunAt,
    lastError,
    lastSummary,
  };
}

// event listener avelacnel
function on(eventName, handler) {
  if (!listeners[eventName]) {
    throw new Error(`Unknown scheduler event: ${eventName}`);
  }

  listeners[eventName].add(handler);

  return () => {
    listeners[eventName].delete(handler);
  };
}

module.exports = {
  executeSync,
  getStatus,
  initScheduler,
  on,
  setCronExpression,
  startScheduler,
  stopScheduler,
};
