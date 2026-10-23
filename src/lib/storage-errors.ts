export function storageErrorMessage(error: unknown, fallback = '本地保存失败，请重试。若持续失败，请先导出备份后检查存储空间。') {
  const name = error && typeof error === 'object' && 'name' in error ? error.name : ''
  switch (name) {
    case 'QuotaExceededError':
      return '浏览器存储空间不足。请先导出备份，再移除不需要的图片，或使用桌面版。'
    case 'SecurityError':
    case 'NotAllowedError':
      return '浏览器禁止访问本地存储。请检查隐私设置，或使用允许本地存储的普通窗口重试。'
    case 'NotSupportedError':
      return '当前浏览器不支持所需的本地存储。请使用新版浏览器或桌面版。'
    case 'StorageBlockedError':
    case 'VersionError':
      return '错题本数据库暂时被其他页面占用。请关闭其他预览标签页后重试。'
    case 'AbortError':
    case 'InvalidStateError':
      return '本地存储操作被中断，原有数据未被替换。请重试，或关闭其他预览标签页后再打开。'
    default:
      return fallback
  }
}
