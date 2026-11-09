const db = require("../config/db");

async function loadBlockMap() {
  const [rows] = await db.execute("SELECT id, building_id, name FROM blocks");
  const blockMap = new Map();

  for (const row of rows) {
    blockMap.set(`${row.building_id}:${row.name}`, row.id);
  }

  return blockMap;
}

async function saveApartment(apartment) {
  let existingRows;

  if (apartment.mysqlId) {
    [existingRows] = await db.execute(
      `SELECT id,
              building_id,
              number,
              block_id,
              floor_id,
              status,
              square_meter,
              rooms,
              duplex,
              active_price,
              has_terrace,
              terrace_area,
              total_price
       FROM apartments
       WHERE id = ?`,
      [
        apartment.mysqlId,
      ]
    );
  } else {
    [existingRows] = await db.execute(
      `SELECT id,
              building_id,
              number,
              block_id,
              floor_id,
              status,
              square_meter,
              rooms,
              duplex,
              active_price,
              has_terrace,
              terrace_area,
              total_price
       FROM apartments
       WHERE building_id = ?
         AND number = ?`,
      [
        apartment.buildingId,
        apartment.number,
      ]
    );
  }

  if (apartment.mysqlId && !existingRows.length) {
    return {
      action: "skipped",
      reason: "mysql_id_not_found",
    };
  }

  if (existingRows.length) {
    const existing = existingRows[0];

    const normalizedExisting = {
      id: existing.id,
      buildingId: Number(existing.building_id),
      number: existing.number,
      blockId: existing.block_id,
      floorId: existing.floor_id,
      status: existing.status,
      squareMeter: Number(existing.square_meter),
      rooms: Number(existing.rooms),
      duplex: Number(existing.duplex),
      activePrice: Number(existing.active_price),
      hasTerrace: Number(existing.has_terrace),
      terraceArea: existing.terrace_area === null ? null : Number(existing.terrace_area),
      totalPrice: existing.total_price === null ? null : Number(existing.total_price),
    };
    const changes = {};

    if (normalizedExisting.buildingId !== apartment.buildingId) {
      changes.buildingId = {
        from: normalizedExisting.buildingId,
        to: apartment.buildingId,
      };
    }

    if (String(normalizedExisting.number) !== String(apartment.number)) {
      changes.number = {
        from: normalizedExisting.number,
        to: apartment.number,
      };
    }

    if (normalizedExisting.blockId !== apartment.blockId) {
      changes.blockId = {
        from: normalizedExisting.blockId,
        to: apartment.blockId,
      };
    }

    if (normalizedExisting.floorId !== apartment.floorId) {
      changes.floorId = {
        from: normalizedExisting.floorId,
        to: apartment.floorId,
      };
    }

    if (normalizedExisting.status !== apartment.status) {
      changes.status = {
        from: normalizedExisting.status,
        to: apartment.status,
      };
    }

    if (normalizedExisting.squareMeter !== apartment.squareMeter) {
      changes.squareMeter = {
        from: normalizedExisting.squareMeter,
        to: apartment.squareMeter,
      };
    }

    if (normalizedExisting.rooms !== apartment.rooms) {
      changes.rooms = {
        from: normalizedExisting.rooms,
        to: apartment.rooms,
      };
    }

    if (normalizedExisting.duplex !== apartment.duplex) {
      changes.duplex = {
        from: normalizedExisting.duplex,
        to: apartment.duplex,
      };
    }

    if (normalizedExisting.activePrice !== apartment.activePrice) {
      changes.activePrice = {
        from: normalizedExisting.activePrice,
        to: apartment.activePrice,
      };
    }

    if (normalizedExisting.hasTerrace !== apartment.hasTerrace) {
      changes.hasTerrace = {
        from: normalizedExisting.hasTerrace,
        to: apartment.hasTerrace,
      };
    }

    if (normalizedExisting.terraceArea !== apartment.terraceArea) {
      changes.terraceArea = {
        from: normalizedExisting.terraceArea,
        to: apartment.terraceArea,
      };
    }

    if (normalizedExisting.totalPrice !== apartment.totalPrice) {
      changes.totalPrice = {
        from: normalizedExisting.totalPrice,
        to: apartment.totalPrice,
      };
    }

    const hasChanges = Object.keys(changes).length > 0;

    if (!hasChanges) {
      return {
        action: "unchanged",
        existing: normalizedExisting,
      };
    }

    if (changes.buildingId || changes.number) {
      const [conflictingRows] = await db.execute(
        `SELECT id,
                building_id,
                number
         FROM apartments
         WHERE building_id = ?
           AND number = ?
           AND id <> ?
         LIMIT 1`,
        [
          apartment.buildingId,
          apartment.number,
          existing.id,
        ]
      );

      if (conflictingRows.length) {
        const conflicting = conflictingRows[0];

        return {
          action: "skipped",
          reason: "building_number_conflict",
          existing: normalizedExisting,
          conflict: {
            id: conflicting.id,
            buildingId: Number(conflicting.building_id),
            number: conflicting.number,
          },
          changes,
        };
      }
    }

    await db.execute(
      `UPDATE apartments
       SET building_id = ?,
           number = ?,
           block_id = ?,
           floor_id = ?,
           status = ?,
           square_meter = ?,
           rooms = ?,
           duplex = ?,
           active_price = ?,
           has_terrace = ?,
           terrace_area = ?,
           total_price = ?,
           updated_at = NOW()
       WHERE id = ?`,
      [
        apartment.buildingId,
        apartment.number,
        apartment.blockId,
        apartment.floorId,
        apartment.status,
        apartment.squareMeter,
        apartment.rooms,
        apartment.duplex,
        apartment.activePrice,
        apartment.hasTerrace,
        apartment.terraceArea,
        apartment.totalPrice,
        existing.id,
      ]
    );

    return {
      action: "updated",
      existing: normalizedExisting,
      changes,
    };
  }

  const [insertResult] = await db.execute(
    `INSERT INTO apartments (
       building_id,
       block_id,
       floor_id,
       number,
       status,
       square_meter,
       rooms,
       duplex,
       active_price,
       has_terrace,
       terrace_area,
       total_price,
       created_at,
       updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
    [
      apartment.buildingId,
      apartment.blockId,
      apartment.floorId,
      apartment.number,
      apartment.status,
      apartment.squareMeter,
      apartment.rooms,
      apartment.duplex,
      apartment.activePrice,
      apartment.hasTerrace,
      apartment.terraceArea,
      apartment.totalPrice,
    ]
  );

  return {
    action: "inserted",
    id: insertResult.insertId,
  };
}

module.exports = {
  loadBlockMap,
  saveApartment,
};
