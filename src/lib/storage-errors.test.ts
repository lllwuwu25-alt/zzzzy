import { describe, expect, it } from 'vitest'
import { storageErrorMessage } from './storage-errors'

describe('notebook storage errors', () => {
  it('explains browser quota without blaming workspace permissions', () => {
    const message = storageErrorMessage(new DOMException('raw error', 'QuotaExceededError'))
    expect(message).toContain('浏览器存储空间不足')
    expect(message).not.toContain('工作区权限')
    expect(message).not.toContain('raw error')
  })
  it('offers an actionable privacy-settings hint for denied storage', () => {
    expect(storageErrorMessage({ name: 'SecurityError' })).toContain('隐私设置')
  })
  it('explains blocked and interrupted writes separately', () => {
    expect(storageErrorMessage({ name: 'StorageBlockedError' })).toContain('其他预览标签页')
    expect(storageErrorMessage({ name: 'AbortError' })).toContain('未被替换')
  })
  it('does not expose arbitrary errors or replace the contextual fallback', () => {
    expect(storageErrorMessage(new Error('private details'), '请重试导入')).toBe('请重试导入')
    expect(storageErrorMessage(null)).toContain('本地保存失败')
  })
})
