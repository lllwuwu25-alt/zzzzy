import { describe, expect, it } from 'vitest'
import { platformForBuild, parseBindingLink, cloudDeviceDescriptor } from './platform'

describe('Android test runtime boundary', () => {
  it('never treats browser or desktop as an unlocked Android build', () => {
    expect(platformForBuild(false, 'true')).toBe('web')
    expect(platformForBuild(true, undefined)).toBe('desktop')
    expect(platformForBuild(true, 'true')).toBe('android-test')
  })
  it('uses mobile metadata for native Android, not desktop', () => {
    expect(cloudDeviceDescriptor('android-test')).toEqual({ deviceName: '我的安卓手机', deviceType: 'mobile' })
    expect(cloudDeviceDescriptor('desktop').deviceType).toBe('desktop')
  })
  it('accepts only a matching gateway binding URL with a strong token', () => {
    const id = '85abe390-5645-42a3-8030-0b50699c46e0', token = 'a'.repeat(43)
    expect(parseBindingLink(`https://sync.example.test/?bind=${id}#token=${token}`, 'https://sync.example.test')).toEqual({ bindingId: id, token })
    for (const input of [`https://evil.test/?bind=${id}#token=${token}`, `https://sync.example.test.evil.test/?bind=${id}#token=${token}`, `http://sync.example.test/?bind=${id}#token=${token}`, `https://user@sync.example.test/?bind=${id}#token=${token}`, `https://sync.example.test/other?bind=${id}#token=${token}`, `https://sync.example.test/?bind=${id}#token=x`, 'javascript:alert(1)']) expect(() => parseBindingLink(input, 'https://sync.example.test')).toThrow()
  })
})
