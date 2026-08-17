const dotenv = require("dotenv");

const envPath =
  process.env.BITRIX_CONNECTOR_ENV_PATH || "/etc/bitrix-connector/bitrix-connector.env";

dotenv.config({ path: envPath });

module.exports = {
  envPath,
};
