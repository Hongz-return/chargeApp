Component({
  properties: {
    /** app.wxss 中 .ic-* 图标名，例如 doc / plug / ticket / heart */
    icon: { type: String, value: 'doc' },
    text: { type: String, value: '暂无数据' },
    sub: { type: String, value: '' },
    actionText: { type: String, value: '' }
  },

  methods: {
    onAction() {
      this.triggerEvent('action');
    }
  }
});
