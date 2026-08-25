Component({
  properties: {
    icon: { type: String, value: '📭' },
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
