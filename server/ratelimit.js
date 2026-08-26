/**
 * 内存态固定窗口限流。
 *
 * 单实例够用：本服务的定位是「一台机器 + 反向代理」。要横向扩容就得换成
 * Redis 之类的共享计数器，那时替换点只有这个文件（docs/PRODUCTION.md 里记了这条）。
 *
 * 固定窗口在窗口交界处最坏会放过 2 倍的量，对「防脚本刷接口」这个目标足够；
 * 换滑动窗口要为每个 key 存时间戳数组，内存开销不划算。
 */

function createLimiter(options) {
  const opts = options || {};
  const windowMs = opts.windowMs > 0 ? opts.windowMs : 60000;
  const max = opts.max > 0 ? opts.max : 0; // 0 = 不限流
  /** key -> { count, resetAt } */
  const buckets = new Map();

  /** 顺手清掉过期桶，避免长时间运行后 Map 只增不减 */
  function sweep(now) {
    if (buckets.size < 1024) return;
    buckets.forEach((bucket, key) => {
      if (bucket.resetAt <= now) buckets.delete(key);
    });
  }

  /**
   * @returns {{allowed: boolean, remaining: number, retryAfterSec: number}}
   */
  function hit(key, now) {
    if (!max) return { allowed: true, remaining: Infinity, retryAfterSec: 0 };
    const at = now || Date.now();
    sweep(at);

    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= at) {
      bucket = { count: 0, resetAt: at + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count++;
    const allowed = bucket.count <= max;
    return {
      allowed,
      remaining: Math.max(0, max - bucket.count),
      retryAfterSec: allowed ? 0 : Math.max(1, Math.ceil((bucket.resetAt - at) / 1000))
    };
  }

  function reset() {
    buckets.clear();
  }

  return { hit, reset, windowMs, max, get size() { return buckets.size; } };
}

module.exports = { createLimiter };
