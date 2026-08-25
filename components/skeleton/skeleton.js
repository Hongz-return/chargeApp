Component({
  properties: {
    /** 骨架卡片数量 */
    count: { type: Number, value: 3 }
  },

  data: {
    items: [0, 1, 2]
  },

  observers: {
    count(value) {
      const n = Math.max(1, Math.min(10, Number(value) || 3));
      this.setData({ items: Array.from({ length: n }, (_, i) => i) });
    }
  }
});
