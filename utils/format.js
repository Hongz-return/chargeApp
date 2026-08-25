/**
 * 通用格式化工具。
 *
 * 这些函数在小程序运行时与 Node 单元测试中均可直接使用，
 * 因此不允许在此文件内引用任何 wx.* API。
 */

function pad2(n) {
  return n < 10 ? '0' + n : '' + n;
}

/** 秒 -> HH:MM:SS */
function formatDuration(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
}

/** 秒 -> "1小时23分" / "23分" / "45秒"，用于订单列表等紧凑展示 */
function formatDurationCn(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h > 0) return `${h}小时${pad2(m)}分`;
  if (m > 0) return `${m}分`;
  return `${total}秒`;
}

/** 金额保留两位小数，非法输入回落到 0.00 */
function formatMoney(value) {
  const n = Number(value);
  return (Number.isFinite(n) ? n : 0).toFixed(2);
}

/** 电量保留两位小数 */
function formatEnergy(value) {
  const n = Number(value);
  return (Number.isFinite(n) ? n : 0).toFixed(2);
}

/** 距离：<1km 用米展示 */
function formatDistance(km) {
  const n = Number(km);
  if (!Number.isFinite(n) || n < 0) return '--';
  if (n < 1) return `${Math.round(n * 1000)}m`;
  return `${n.toFixed(1)}km`;
}

/** 时间戳 -> YYYY-MM-DD HH:MM */
function formatDateTime(ts) {
  const d = new Date(Number(ts) || 0);
  return (
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ` +
    `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  );
}

/** 时间戳 -> MM-DD HH:MM */
function formatShortDateTime(ts) {
  const d = new Date(Number(ts) || 0);
  return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** 时间戳 -> HH:MM:SS */
function formatTime(ts) {
  const d = new Date(Number(ts) || 0);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

/** 手机号中间四位打码 */
function maskPhone(phone) {
  const str = String(phone || '');
  if (str.length !== 11) return str;
  return `${str.slice(0, 3)}****${str.slice(7)}`;
}

/**
 * 生成订单号：CD + yyyyMMddHHmmss + 4 位序列。
 * seq 由调用方（storage）提供，保证同一毫秒内也不重复。
 */
function buildOrderNo(ts, seq) {
  const d = new Date(Number(ts) || 0);
  const stamp =
    `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}` +
    `${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
  const tail = String(Math.abs(Math.floor(Number(seq) || 0)) % 10000).padStart(4, '0');
  return `CD${stamp}${tail}`;
}

module.exports = {
  pad2,
  formatDuration,
  formatDurationCn,
  formatMoney,
  formatEnergy,
  formatDistance,
  formatDateTime,
  formatShortDateTime,
  formatTime,
  maskPhone,
  buildOrderNo
};
