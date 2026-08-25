/**
 * 本地 id 生成。
 *
 * 订单、流水、发票此前各写一份 `${prefix}-${Date.now()}-${random}`：
 * 同一毫秒内批量生成（例如一次提交多笔发票）时有概率撞号，撞号后
 * 列表按 id 去重就会吞掉记录。这里叠加一个进程内自增序列杜绝这种情况。
 */

let seq = 0;

/** @param {string} prefix 业务前缀，如 od / tx / iv */
function createId(prefix) {
  seq = (seq + 1) % 1000000;
  return `${prefix || 'id'}-${Date.now()}-${seq}`;
}

module.exports = { createId };
