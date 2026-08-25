Component({
  properties: {
    station: { type: Object, value: null },
    /** 展示右上角收藏心形 */
    favorite: { type: Boolean, value: false },
    showFavorite: { type: Boolean, value: false }
  },

  methods: {
    // 事件名刻意避开 tap：自定义组件上的 bind:tap 会同时收到冒泡的原生 tap，导致重复触发
    onTap() {
      this.triggerEvent('select', { id: this.data.station && this.data.station.id });
    },

    onFavoriteTap() {
      this.triggerEvent('favorite', { id: this.data.station && this.data.station.id });
    }
  }
});
