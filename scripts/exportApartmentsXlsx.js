require("dotenv").config();

const fs = require("fs");
const path = require("path");
const db = require("../src/config/db");

const outputDir = path.join(process.cwd(), "outputs", "apartments-export");
const outputPath = path.join(outputDir, "apartments.xlsx");

const columns = [
  { key: "id", header: "MySQL ID", description: "apartments table-ի հիմնական ID", type: "number", width: 12 },
  { key: "building_id", header: "Շենք ID", description: "Շենքի ID", type: "number", width: 12 },
  { key: "block_id", header: "Մուտք/Block ID", description: "Մուտքի կամ block-ի ID", type: "number", width: 16 },
  { key: "floor_id", header: "Հարկ ID", description: "Հարկի ID", type: "number", width: 12 },
  { key: "number", header: "Բնակարան", description: "Բնակարանի համար", type: "text", width: 16 },
  { key: "status", header: "Կարգավիճակ", description: "Բնակարանի ընթացիկ կարգավիճակ", type: "text", width: 16 },
  { key: "reserved_at", header: "Ամրագրման օր", description: "Ամրագրված լինելու ամսաթիվ", type: "date", width: 18 },
  { key: "sold_at", header: "Վաճառքի օր", description: "Վաճառված լինելու ամսաթիվ", type: "date", width: 18 },
  { key: "created_at", header: "Ստեղծվել է", description: "Row-ի ստեղծման ժամանակը", type: "dateTime", width: 22 },
  { key: "updated_at", header: "Թարմացվել է", description: "Row-ի վերջին թարմացման ժամանակը", type: "dateTime", width: 22 },
  { key: "image", header: "Նկար", description: "Բնակարանի նկարի path կամ URL", type: "text", width: 32 },
  { key: "parent_image", header: "Ծնող նկար", description: "Ծնող/հիմնական նկարի path կամ URL", type: "text", width: 32 },
  { key: "square_meter", header: "Մակերես (մ²)", description: "Բնակարանի մակերեսը քմ-ով", type: "number", width: 16 },
  { key: "rooms", header: "Սենյակներ", description: "Սենյակների քանակ", type: "number", width: 12 },
  { key: "old_status", header: "Հին կարգավիճակ", description: "Նախորդ կարգավիճակ, եթե պահված է", type: "text", width: 18 },
  { key: "duplex", header: "Դուպլեքս", description: "1՝ դուպլեքս է, 0՝ չէ", type: "boolean", width: 12 },
  { key: "discount", header: "Զեղչ", description: "Զեղչի արժեք", type: "number", width: 14 },
  { key: "for_main", header: "Գլխավորում", description: "1՝ ցույց տալ գլխավորում, 0՝ ոչ", type: "boolean", width: 14 },
  { key: "active_price", header: "Ակտիվ գին", description: "Գործող գինը", type: "money", width: 16 },
];

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function columnName(index) {
  let name = "";
  let current = index + 1;

  while (current > 0) {
    const remainder = (current - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    current = Math.floor((current - 1) / 26);
  }

  return name;
}

function cellReference(rowIndex, columnIndex) {
  return `${columnName(columnIndex)}${rowIndex}`;
}

function formatDateValue(value) {
  if (!value) {
    return "";
  }

  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toISOString().replace("T", " ").slice(0, 19);
}

function formatCell(value, type, rowIndex, columnIndex, style = 0) {
  const ref = cellReference(rowIndex, columnIndex);

  if (value === null || value === undefined || value === "") {
    return `<c r="${ref}" s="${style}"/>`;
  }

  if (type === "number" || type === "money" || type === "boolean") {
    const numericValue = Number(value);

    if (!Number.isNaN(numericValue)) {
      return `<c r="${ref}" s="${style}"><v>${numericValue}</v></c>`;
    }
  }

  const text = type === "date" || type === "dateTime" ? formatDateValue(value) : value;

  return `<c r="${ref}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${escapeXml(text)}</t></is></c>`;
}

function buildRows(rows) {
  const headerCells = columns
    .map((column, index) => formatCell(column.header, "text", 1, index, 1))
    .join("");
  const dataRows = rows
    .map((row, rowIndex) => {
      const excelRow = rowIndex + 2;
      const cells = columns
        .map((column, columnIndex) => {
          const style = column.type === "money" ? 3 : column.type === "number" ? 2 : 0;
          return formatCell(row[column.key], column.type, excelRow, columnIndex, style);
        })
        .join("");

      return `<row r="${excelRow}">${cells}</row>`;
    })
    .join("");

  return `<row r="1">${headerCells}</row>${dataRows}`;
}

function buildApartmentsSheet(rows) {
  const lastColumn = columnName(columns.length - 1);
  const lastRow = rows.length + 1;
  const columnDefinitions = columns
    .map((column, index) => `<col min="${index + 1}" max="${index + 1}" width="${column.width}" customWidth="1"/>`)
    .join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews>
    <sheetView workbookViewId="0">
      <pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>
      <selection pane="bottomLeft" activeCell="A2" sqref="A2"/>
    </sheetView>
  </sheetViews>
  <cols>${columnDefinitions}</cols>
  <sheetData>${buildRows(rows)}</sheetData>
  <autoFilter ref="A1:${lastColumn}${lastRow}"/>
</worksheet>`;
}

function buildFieldGuideSheet() {
  const headers = ["DB Column", "Գեղեցիկ անուն", "Բացատրություն", "Տիպ"];
  const rows = columns.map((column) => [column.key, column.header, column.description, column.type]);
  const allRows = [headers, ...rows];
  const sheetRows = allRows
    .map((row, rowIndex) => {
      const excelRow = rowIndex + 1;
      const style = rowIndex === 0 ? 1 : 0;
      const cells = row.map((value, columnIndex) => formatCell(value, "text", excelRow, columnIndex, style)).join("");

      return `<row r="${excelRow}">${cells}</row>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews>
    <sheetView workbookViewId="0">
      <pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>
      <selection pane="bottomLeft" activeCell="A2" sqref="A2"/>
    </sheetView>
  </sheetViews>
  <cols>
    <col min="1" max="1" width="24" customWidth="1"/>
    <col min="2" max="2" width="24" customWidth="1"/>
    <col min="3" max="3" width="44" customWidth="1"/>
    <col min="4" max="4" width="14" customWidth="1"/>
  </cols>
  <sheetData>${sheetRows}</sheetData>
  <autoFilter ref="A1:D${allRows.length}"/>
</worksheet>`;
}

function buildStyles() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="2">
    <numFmt numFmtId="164" formatCode="#,##0.00"/>
    <numFmt numFmtId="165" formatCode="#,##0"/>
  </numFmts>
  <fonts count="2">
    <font><sz val="11"/><name val="Calibri"/></font>
    <font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1F4E79"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left style="thin"><color rgb="FFD9E2F3"/></left><right style="thin"><color rgb="FFD9E2F3"/></right><top style="thin"><color rgb="FFD9E2F3"/></top><bottom style="thin"><color rgb="FFD9E2F3"/></bottom><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="4">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1"/>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1"/>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
}

function crc32(buffer) {
  let crc = 0xffffffff;

  for (const byte of buffer) {
    crc ^= byte;

    for (let index = 0; index < 8; index++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();

  return { dosDate, dosTime };
}

function createZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const { dosDate, dosTime } = dosDateTime();

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const data = Buffer.from(entry.content, "utf8");
    const crc = crc32(data);
    const localHeader = Buffer.alloc(30);

    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(name.length, 26);

    localParts.push(localHeader, name, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, name);

    offset += localHeader.length + name.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...localParts, centralDirectory, end]);
}

function workbookFiles(rows) {
  return [
    {
      name: "[Content_Types].xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`,
    },
    {
      name: "_rels/.rels",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
    },
    {
      name: "xl/workbook.xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Apartments" sheetId="1" r:id="rId1"/>
    <sheet name="Field Guide" sheetId="2" r:id="rId2"/>
  </sheets>
</workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
    },
    { name: "xl/styles.xml", content: buildStyles() },
    { name: "xl/worksheets/sheet1.xml", content: buildApartmentsSheet(rows) },
    { name: "xl/worksheets/sheet2.xml", content: buildFieldGuideSheet() },
  ];
}

async function main() {
  const [rows] = await db.execute(
    `SELECT id,
            building_id,
            block_id,
            floor_id,
            number,
            status,
            reserved_at,
            sold_at,
            created_at,
            updated_at,
            image,
            parent_image,
            square_meter,
            rooms,
            old_status,
            duplex,
            discount,
            for_main,
            active_price
     FROM apartments
     ORDER BY building_id, block_id, floor_id, number, id`
  );

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(outputPath, createZip(workbookFiles(rows)));
  console.log(JSON.stringify({ outputPath, rows: rows.length }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.end();
  });
