if (!Array.prototype.toReversed) {
  Array.prototype.toReversed = function () {
    return [...this].reverse()
  }
}
// 防止弹出系统级安全认证
Object.defineProperty(window, 'PublicKeyCredential', {
  get() {
    return undefined
  }
})
// 防止弹出系统级安全认证
Object.defineProperty(navigator, 'credentials', {
  value: {
    get: async () => {
      throw new Error('blocked')
    },

    create: async () => {
      throw new Error('blocked')
    }
  }
})

// window.PublicKeyCredential = undefined
