require("./env");

const axios = require("axios");

const bitrix = axios.create({
  baseURL: process.env.BITRIX_WEBHOOK,
  timeout: Number(process.env.BITRIX_REQUEST_TIMEOUT_MS || 60000),
});

module.exports = bitrix;