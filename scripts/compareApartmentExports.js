const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const outputDir = path.join(process.cwd(), "outputs", "apartments-export");
const mysqlPath = path.join(outputDir, "apartments.xlsx");
const bitrixPath = path.join(outputDir, "bitrix apartments.xls");
const reportPath = path.join(outputDir, "apartment-export-compare-report.json");

const MYSQL_COLUMNS = [
  "id",
  "building_id",
  "block_id",
  "floor_id",
  "number",
  "status",
  "reserved_at",
  "sold_at",
  "created_at",
  "updated_at",
  "image",
  "parent_image",
  "square_meter",
  "rooms",
  "old_status",
  "duplex",
  "discount",
  "for_main",
  "active_price",
];

const BUILDING_BY_BITRIX_NAME = {
  "Milon Hills": 1,
  "Milon Tower": 3,
};

const STATUS_BY_BITRIX_LABEL = {
  "Ազատ": "active",
  "Ամրագրված": "reserved",
  "Կնքված": "sold",
  "Վաճառված": "sold",
  "Տեղեկանք": "pending",
};

function decodeEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/<[^>]+>/g, "")
    .trim();
}

function normalizeNumber(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toNumber(value) {
  const normalized = String(value ?? "")
    .replace(/\u00a0/g, "")
    .replace(/\s+/g, "")
    .replace(/[^\d.-]/g, "");
  if (!normalized) {
    return null;
  }
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : null;
}

function roundNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.round(numeric * 100) / 100 : null;
}

function getXlsxEntry(entryName) {
  return execFileSync("tar", ["-xOf", mysqlPath, entryName], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
}

function readSharedStrings() {
  const xml = getXlsxEntry("xl/sharedStrings.xml");
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((match) => {
    const text = [...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
      .map((textMatch) => decodeEntities(textMatch[1]))
      .join("");
    return text;
  });
}

function columnIndex(cellRef) {
  const letters = cellRef.match(/[A-Z]+/)[0];
  let index = 0;
  for (const letter of letters) {
    index = index * 26 + (letter.charCodeAt(0) - 64);
  }
  return index - 1;
}

function readMysqlRows() {
  const sharedStrings = readSharedStrings();
  const xml = getXlsxEntry("xl/worksheets/sheet1.xml");
  const rows = [];

  for (const rowMatch of xml.matchAll(/<row\b[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    const rowNumber = Number(rowMatch[1]);
    if (rowNumber === 1) {
      continue;
    }

    const cells = [];
    for (const cellMatch of rowMatch[2].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>|<c\b([^>]*)\/>/g)) {
      const attrs = cellMatch[1] || cellMatch[3] || "";
      const ref = attrs.match(/\br="([^"]+)"/)?.[1];
      if (!ref) {
        continue;
      }
      const value = cellMatch[2]?.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "";
      const isSharedString = /\bt="s"/.test(attrs);
      cells[columnIndex(ref)] = isSharedString ? sharedStrings[Number(value)] : value;
    }

    const row = {};
    MYSQL_COLUMNS.forEach((key, index) => {
      row[key] = cells[index] ?? "";
    });

    row.id = toNumber(row.id);
    row.building_id = toNumber(row.building_id);
    row.floor_id = toNumber(row.floor_id);
    row.number = normalizeNumber(row.number);
    row.square_meter = roundNumber(row.square_meter);
    row.rooms = toNumber(row.rooms);
    row.active_price = roundNumber(row.active_price);
    row.sourceRow = rowNumber;
    rows.push(row);
  }

  return rows;
}

function readBitrixRows() {
  const html = fs.readFileSync(bitrixPath, "utf8");
  const headerMatch = html.match(/<thead>[\s\S]*?<tr>([\s\S]*?)<\/tr>[\s\S]*?<\/thead>/i);
  const headers = [...(headerMatch?.[1] || "").matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)]
    .map((match) => decodeEntities(match[1]));
  const bodyMatch = html.match(/<tbody>([\s\S]*?)<\/tbody>/i);
  const rows = [];

  for (const rowMatch of (bodyMatch?.[1] || "").matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const values = [...rowMatch[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)]
      .map((match) => decodeEntities(match[1]));
    if (!values.length) {
      continue;
    }

    const raw = {};
    headers.forEach((header, index) => {
      raw[header] = values[index] ?? "";
    });

    const buildingName = raw["Համալիր"] || raw["Համալիր տեստ"];
    const row = {
      title: normalizeNumber(raw["Название"]),
      buildingName,
      building_id: BUILDING_BY_BITRIX_NAME[buildingName] ?? null,
      statusLabel: raw["Стадия"],
      status: STATUS_BY_BITRIX_LABEL[raw["Стадия"]] ?? raw["Стадия"],
      number: normalizeNumber(raw["Համար"] || String(raw["Название"] || "").split(/\s+/)[0]),
      rooms: toNumber(raw["Սենյակների քանակ"]),
      floor: toNumber(raw["Հարկ"]),
      square_meter: roundNumber(raw["Մակերես (մ²)"]),
      active_price: roundNumber(toNumber(raw["Արժեք (մ²)"])),
      total: roundNumber(raw["Сумма"]),
      id: toNumber(raw["ID test"]),
      raw,
    };
    row.expected_floor_id =
      row.building_id === 1 && row.floor !== null
        ? row.floor + 3
        : row.building_id === 3 && row.floor !== null
          ? row.floor + 63
          : null;
    rows.push(row);
  }

  return rows;
}

function groupBy(rows, keyFn) {
  const map = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!map.has(key)) {
      map.set(key, []);
    }
    map.get(key).push(row);
  }
  return map;
}

function slimMysql(row) {
  if (!row) return null;
  return {
    sourceRow: row.sourceRow,
    id: row.id,
    building_id: row.building_id,
    number: row.number,
    floor_id: row.floor_id,
    status: row.status,
    square_meter: row.square_meter,
    rooms: row.rooms,
    active_price: row.active_price,
  };
}

function slimBitrix(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    buildingName: row.buildingName,
    building_id: row.building_id,
    number: row.number,
    floor: row.floor,
    expected_floor_id: row.expected_floor_id,
    statusLabel: row.statusLabel,
    status: row.status,
    square_meter: row.square_meter,
    rooms: row.rooms,
    active_price: row.active_price,
  };
}

function main() {
  const mysqlRows = readMysqlRows();
  const bitrixRows = readBitrixRows();
  const mysqlFiltered = mysqlRows.filter((row) => row.building_id === 1 || row.building_id === 3);
  const bitrixFiltered = bitrixRows.filter((row) => row.building_id === 1 || row.building_id === 3);

  const mysqlById = new Map(mysqlFiltered.map((row) => [row.id, row]));
  const bitrixById = new Map(bitrixFiltered.filter((row) => row.id).map((row) => [row.id, row]));
  const mysqlByKey = groupBy(mysqlFiltered, (row) => `${row.building_id}|${row.number}`);
  const bitrixByKey = groupBy(bitrixFiltered, (row) => `${row.building_id}|${row.number}`);

  const missingInBitrix = mysqlFiltered
    .filter((row) => !bitrixById.has(row.id))
    .map((row) => ({
      mysql: slimMysql(row),
      bitrixSameBuildingNumber: (bitrixByKey.get(`${row.building_id}|${row.number}`) || []).map(slimBitrix),
    }));

  const missingInMysql = bitrixFiltered
    .filter((row) => !row.id || !mysqlById.has(row.id))
    .map((row) => ({
      bitrix: slimBitrix(row),
      mysqlSameBuildingNumber: (mysqlByKey.get(`${row.building_id}|${row.number}`) || []).map(slimMysql),
    }));

  const fieldMismatches = [];
  for (const bitrix of bitrixFiltered) {
    const mysql = bitrix.id ? mysqlById.get(bitrix.id) : null;
    if (!mysql) {
      continue;
    }

    const differences = {};
    const checks = [
      ["building_id", mysql.building_id, bitrix.building_id],
      ["number", mysql.number, bitrix.number],
      ["floor_id", mysql.floor_id, bitrix.expected_floor_id],
      ["status", mysql.status, bitrix.status],
      ["square_meter", mysql.square_meter, bitrix.square_meter],
      ["rooms", mysql.rooms, bitrix.rooms],
      ["active_price", mysql.active_price, bitrix.active_price],
    ];
    for (const [field, mysqlValue, bitrixValue] of checks) {
      if (String(mysqlValue) !== String(bitrixValue)) {
        differences[field] = { mysql: mysqlValue, bitrix: bitrixValue };
      }
    }

    if (Object.keys(differences).length) {
      fieldMismatches.push({
        id: bitrix.id,
        mysql: slimMysql(mysql),
        bitrix: slimBitrix(bitrix),
        differences,
        conflictAtBitrixBuildingNumber: (mysqlByKey.get(`${bitrix.building_id}|${bitrix.number}`) || [])
          .filter((row) => row.id !== bitrix.id)
          .map(slimMysql),
      });
    }
  }

  const duplicateMysqlKeys = [...mysqlByKey.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([key, rows]) => ({ key, rows: rows.map(slimMysql) }));
  const duplicateBitrixKeys = [...bitrixByKey.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([key, rows]) => ({ key, rows: rows.map(slimBitrix) }));
  const duplicateBitrixIds = [...groupBy(bitrixFiltered.filter((row) => row.id), (row) => row.id).entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([id, rows]) => ({ id, rows: rows.map(slimBitrix) }));

  const report = {
    files: {
      mysqlPath,
      bitrixPath,
    },
    counts: {
      mysqlAll: mysqlRows.length,
      bitrixAll: bitrixRows.length,
      mysqlBuilding1And3: mysqlFiltered.length,
      bitrixBuilding1And3: bitrixFiltered.length,
      mysqlByBuilding: {
        1: mysqlFiltered.filter((row) => row.building_id === 1).length,
        3: mysqlFiltered.filter((row) => row.building_id === 3).length,
      },
      bitrixByBuilding: {
        1: bitrixFiltered.filter((row) => row.building_id === 1).length,
        3: bitrixFiltered.filter((row) => row.building_id === 3).length,
      },
    },
    missingInBitrix,
    missingInMysql,
    fieldMismatches,
    duplicateMysqlKeys,
    duplicateBitrixKeys,
    duplicateBitrixIds,
  };

  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  console.log(JSON.stringify({
    reportPath,
    counts: report.counts,
    missingInBitrix,
    missingInMysql,
    fieldMismatchCount: fieldMismatches.length,
    fieldMismatches: fieldMismatches.slice(0, 20),
    duplicateMysqlKeys,
    duplicateBitrixKeys,
    duplicateBitrixIds,
  }, null, 2));
}

main();
