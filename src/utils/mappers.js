const buildingMap = {
  // Milon Hills
  1377: 1,
  // Milon Plaza
  1375: 2,
  // Milon Tower
  1379: 3

};
//mutq
const entranceMap = {

1381: 1,
1383: 2,
1385: 3,
1387: 4,
1389: 5,
1391: 6,
1393: 7,
1433: 8

};

const statusMap = {
  "DT1038_23:NEW": "active",
  "DT1038_23:UC_ERVL1W": "pending",
  "DT1038_23:PREPARATION": "pending",
  "DT1038_23:CLIENT": "reserved",
  "DT1038_23:UC_EXVT4Z": "sold",
  "DT1038_23:UC_U2R6A8": "sold",
  "DT1038_23:UC_N1D302": "sold"

};

function getFloorId(buildingId, floor) {

  // Milon Hills
  if (buildingId === 1) {
    return floor + 3;
  }

  // Milon Plaza
  if (buildingId === 2) {
    return floor + 45;
  }

  // Milon Tower
  if (buildingId === 3) {
    return floor + 63;
  }

  return null;

}

module.exports = {

  buildingMap,
  entranceMap,
  statusMap,
  getFloorId

};
