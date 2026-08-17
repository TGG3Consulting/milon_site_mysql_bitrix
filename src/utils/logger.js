const fs = require("fs");
const path = require("path");

const logsDir = path.join(process.cwd(), "logs");
let currentLogFilePath = null;

function ensureLogsDir() {
  fs.mkdirSync(logsDir, { recursive: true });
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function formatStamp(date = new Date()) {
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join("-") + "_" + [
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("-");
}

function getNextLogIndex() {
  ensureLogsDir();

  const files = fs.readdirSync(logsDir);
  let maxIndex = 0;

  for (const file of files) {
    const match = file.match(/^log(\d+)-/i);
    if (!match) {
      continue;
    }

    const index = Number(match[1]);
    if (Number.isFinite(index) && index > maxIndex) {
      maxIndex = index;
    }
  }

  return maxIndex + 1;
}

function getLogFilePath() {
  if (!currentLogFilePath) {
    return createLogFile();
  }

  return currentLogFilePath;
}

function createLogFile() {
  ensureLogsDir();

  const index = getNextLogIndex();
  currentLogFilePath = path.join(logsDir, `log${index}-${formatStamp()}.txt`);
  return currentLogFilePath;
}

function safeStringify(value) {
  const seen = new WeakSet();

  return JSON.stringify(
    value,
    (_, currentValue) => {
      if (currentValue instanceof Error) {
        return formatError(currentValue);
      }

      if (typeof currentValue === "object" && currentValue !== null) {
        if (seen.has(currentValue)) {
          return "[Circular]";
        }

        seen.add(currentValue);
      }

      return currentValue;
    },
    2,
  );
}

function formatError(error) {
  if (!error) {
    return null;
  }

  const formatted = {
    name: error.name || "Error",
    message: error.message || String(error),
  };

  if (error.stack) {
    formatted.stack = error.stack;
  }

  if (error.cause) {
    formatted.cause = error.cause instanceof Error ? formatError(error.cause) : error.cause;
  }

  if (error.response) {
    formatted.response = {
      status: error.response.status,
      statusText: error.response.statusText,
      data: error.response.data,
      headers: error.response.headers,
    };
  }

  if (error.config) {
    formatted.request = {
      url: error.config.url,
      method: error.config.method,
      baseURL: error.config.baseURL,
      timeout: error.config.timeout,
    };
  }

  return formatted;
}

function formatDetail(detail) {
  if (detail instanceof Error) {
    return safeStringify(formatError(detail));
  }

  if (typeof detail === "string") {
    return detail;
  }

  if (typeof detail === "number" || typeof detail === "boolean" || detail == null) {
    return String(detail);
  }

  return safeStringify(detail);
}

function write(message, filePath) {
  fs.appendFileSync(getLogFilePath(filePath), `${message}\n`, "utf8");
  process.stdout.write(`${message}\n`);
}

function createLogger(scope = "app", options = {}) {
  const filePath = options.filePath || null;

  function log(level, message, ...details) {
    const timestamp = new Date().toISOString().replace("T", " ").replace("Z", "");
    write(`[${timestamp}] [${level}] [${scope}] ${message}`, filePath);

    for (const detail of details) {
      if (detail === undefined) {
        continue;
      }

      const formatted = formatDetail(detail);
      const prefix = formatted.startsWith("{") || formatted.startsWith("[") ? "" : "  - ";
      for (const line of formatted.split("\n")) {
        write(`${prefix}${line}`, filePath);
      }
    }
  }

  return {
    info: (message, ...details) => log("INFO", message, ...details),
    warn: (message, ...details) => log("WARN", message, ...details),
    error: (message, ...details) => log("ERROR", message, ...details),
    debug: (message, ...details) => log("DEBUG", message, ...details),
    section: (title, data) => {
      const timestamp = new Date().toISOString().replace("T", " ").replace("Z", "");
      write(`[${timestamp}] [SECTION] [${scope}] ${title}`, filePath);
      write(formatDetail(data), filePath);
    },
  };
}

function getLogFiles(limit = Number.MAX_SAFE_INTEGER) {
  ensureLogsDir();

  return fs
    .readdirSync(logsDir)
    .filter((file) => file.endsWith(".txt"))
    .map((file) => {
      const filePath = path.join(logsDir, file);
      const stats = fs.statSync(filePath);
      return {
        file,
        filePath,
        modifiedAt: stats.mtimeMs,
      };
    })
    .sort((a, b) => b.modifiedAt - a.modifiedAt)
    .slice(0, limit);
}

module.exports = {
  createLogger,
  createLogFile,
  getLogFiles,
};
