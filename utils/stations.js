const stations = [
  {
    id: "s1",
    name: "科技园超级充电站",
    distanceKm: 0.8,
    availableGuns: 6,
    pricePerKwh: 1.25,
    address: "深圳市南山区科技南十二路 18 号",
  },
  {
    id: "s2",
    name: "软件产业基地充电站",
    distanceKm: 1.4,
    availableGuns: 3,
    pricePerKwh: 1.08,
    address: "深圳市南山区高新南一道 9 号",
  },
  {
    id: "s3",
    name: "后海中心充电站",
    distanceKm: 2.1,
    availableGuns: 9,
    pricePerKwh: 1.32,
    address: "深圳市南山区后海大道 2068 号",
  },
];

function getStations() {
  return stations;
}

function getStationById(id) {
  return stations.find((item) => item.id === id) || null;
}

module.exports = {
  getStations,
  getStationById,
};
