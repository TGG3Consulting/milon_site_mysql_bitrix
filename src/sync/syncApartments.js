const bitrix = require("../config/bitrix");
const {
  buildingMap,
  entranceMap,
  statusMap,
  getFloorId,
} = require("../utils/mappers");
const {
  loadBlockMap,
  saveApartment,
} = require("../services/apartment.service");
const { createLogger } = require("../utils/logger");

const MYSQL_APARTMENT_ID_FIELD = "ufCrm11_1776278251224";
const BITRIX_REQUEST_RETRIES = Number(process.env.BITRIX_REQUEST_RETRIES || 3);
const BITRIX_RETRY_DELAY_MS = Number(process.env.BITRIX_RETRY_DELAY_MS || 2000);
const MYSQL_APARTMENT_ID_FIELD_ALIASES = [
  MYSQL_APARTMENT_ID_FIELD,
  "UF_CRM_11_1776278251224",
  "ufCrm11_1776278251224",
  "ufCrm1776278278898",
  "ufCrm_1776278278898",
  "ufCrm11_1776278278898",
  "UF_CRM_1776278278898",
  "UF_CRM_11_1776278278898",
];

function parseApartmentNumber(title) {
  return String(title || "").trim().split(/\s+/)[0] || null;
}

function parsePositiveInteger(value) {
  const numericValue = Number(value);

  if (!Number.isInteger(numericValue) || numericValue <= 0) {
    return null;
  }

  return numericValue;
}
 
function getMysqlApartmentIdValue(item) {
  for (const field of MYSQL_APARTMENT_ID_FIELD_ALIASES) {
    if (item[field] !== undefined && item[field] !== null && item[field] !== "") {
      return item[field];
    }
  }
  
  return undefined;
}

function parseMoneyValue(value) {
  const amount = String(value || "0").split("|")[0];
  return Number(amount);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetriableBitrixError(error) {
  const status = error.response?.status;
  const code = error.code;

  return (
    code === "ETIMEDOUT"
    || code === "ECONNRESET"
    || code === "EAI_AGAIN"
    || code === "ENOTFOUND"
    || code === "ECONNABORTED"
    || status === 408
    || status === 429
    || status === 500
    || status === 502
    || status === 503
    || status === 504
  );
}

async function requestBitrix(method, payload, logger = createLogger("bitrix"), attempt = 1) {
  try {
    return await bitrix.post(method, payload);
  } catch (error) {
    const retriable = isRetriableBitrixError(error);
    const maxAttempts = BITRIX_REQUEST_RETRIES + 1;

    logger.warn("Bitrix request failed", {
      method,
      attempt,
      maxAttempts,
      retriable,
      code: error.code,
      status: error.response?.status,
      message: error.message,
    });

    if (!retriable || attempt >= maxAttempts) {
      throw error;
    }

    const delay = BITRIX_RETRY_DELAY_MS * attempt;
    await sleep(delay);
    return requestBitrix(method, payload, logger, attempt + 1);
  }
}

function buildLogPayload(item, apartment) {
  return {
    bitrixId: item.id,
    title: item.title,
    bitrix: {
      stageId: item.stageId,
      complexId: item.ufCrm11_1776077056,
      entranceId: item.ufCrm11_1776077122,
      floor: item.ufCrm11_1776077300,
      rooms: item.ufCrm11_1776077288,
      squareMeter: item.ufCrm11_1776077273,
      activePrice: item.ufCrm11_1776093169,
      duplex: item.ufCrm11_1779547935718,
      mysqlApartmentId: getMysqlApartmentIdValue(item),
    },
    mysql: apartment,
  };
}

async function syncApartments(logger = createLogger("syncApartments")) {
  try {
    let start = 0;
    const allItems = [];

    while (true) {
      const response = await requestBitrix("crm.item.list", {
        entityTypeId: 1038,
        start,
        select: [
          "id",
          "title",
          "stageId",
          "opportunity",
          "ufCrm11_1776077056",
          "ufCrm11_1776077122",
          "ufCrm11_1776077288",
          "ufCrm11_1776077300",
          "ufCrm11_1776077273",
          "ufCrm11_1776093169",
          "ufCrm11_1779547935718",
          ...MYSQL_APARTMENT_ID_FIELD_ALIASES,
        ],
      }, logger);

      const items = response.data.result.items;
      allItems.push(...items);

      logger.info("Loaded apartments batch", { totalLoaded: allItems.length });

      if (!response.data.next) {
        break;
      }

      start = response.data.next;
    }

    const blockMap = await loadBlockMap();
    let inserted = 0;
    let updated = 0;
    let unchanged = 0;
    let skipped = 0;

    for (const item of allItems) {
      const buildingId = buildingMap[item.ufCrm11_1776077056];
      const entrance = entranceMap[item.ufCrm11_1776077122];
      const number = parseApartmentNumber(item.title);
      const status = statusMap[item.stageId];
      const floor = Number(item.ufCrm11_1776077300);
      const floorId = getFloorId(buildingId, floor);
      const blockId = blockMap.get(`${buildingId}:${entrance}`);
      const rooms = Number(item.ufCrm11_1776077288);
      const squareMeter = Number(item.ufCrm11_1776077273);
      const activePrice = parseMoneyValue(item.ufCrm11_1776093169);
      const duplex = item.ufCrm11_1779547935718 ? 1 : 0;
      const mysqlApartmentIdValue = getMysqlApartmentIdValue(item);
      const mysqlApartmentId = parsePositiveInteger(mysqlApartmentIdValue);

      if (
        !mysqlApartmentId ||
        !buildingId ||
        !entrance ||
        !number ||
        !status ||
        !floorId ||
        !blockId ||
        Number.isNaN(rooms) ||
        Number.isNaN(squareMeter) ||
        Number.isNaN(activePrice)
      ) {
        skipped++;
        logger.warn("Skipped apartment", {
          bitrixId: item.id,
          title: item.title,
          mysqlApartmentId: mysqlApartmentIdValue,
          mysqlApartmentIdAliases: MYSQL_APARTMENT_ID_FIELD_ALIASES,
          buildingId,
          entrance,
          blockId,
          floor,
          floorId,
          status,
        });
        continue;
      }

      const apartment = {
        mysqlId: mysqlApartmentId,
        buildingId,
        blockId,
        floorId,
        number,
        status,
        squareMeter,
        rooms,
        duplex,
        activePrice,
      };
      const result = await saveApartment(apartment);
      const logPayload = buildLogPayload(item, apartment);

      if (result.action === "inserted") {
        inserted++;
        logger.info("Apartment inserted", {
          ...logPayload,
          inserted: {
            id: result.id,
            ...apartment,
          },
        });
      } else if (result.action === "updated") {
        updated++;
        logger.info("Apartment updated", {
          ...logPayload,
          existing: result.existing,
          changedFields: Object.keys(result.changes),
          changes: result.changes,
        });
      } else if (result.action === "skipped") {
        skipped++;
        logger.warn("Skipped apartment", {
          ...logPayload,
          existing: result.existing,
          conflict: result.conflict,
          changedFields: result.changes ? Object.keys(result.changes) : undefined,
          changes: result.changes,
          reason: result.reason,
        });
      } else {
        unchanged++;
        logger.info("Apartment unchanged", {
          ...logPayload,
          existing: result.existing,
        });
      }
    }

    const summary = {
      total: allItems.length,
      inserted,
      updated,
      unchanged,
      skipped,
    };

    logger.section("SYNC RESULT", summary);

    return summary;
  } catch (error) {
    logger.error("Sync failed", error, error.response?.data);
    return null;
  }
}

module.exports = syncApartments;
