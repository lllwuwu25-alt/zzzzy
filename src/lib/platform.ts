import { isTauri } from '@tauri-apps/api/core'

export type AppPlatform = 'web' | 'desktop' | 'android-test'
export const platformForBuild = (native: boolean, androidFlag?: string): AppPlatform => !native ? 'web' : androidFlag === 'true' ? 'android-test' : 'desktop'
export const appPlatform = () => platformForBuild(isTauri(), import.meta.env.VITE_ANDROID_TEST)
export const nativeAndroidBuild = () => appPlatform() === 'android-test'
export const nativeDesktopBuild = () => appPlatform() === 'desktop'
export const cloudDeviceDescriptor = (platform: AppPlatform) => platform === 'desktop' ? { deviceName: '我的电脑', deviceType: 'desktop' } : { deviceName: platform === 'android-test' ? '我的安卓手机' : '手机浏览器', deviceType: 'mobile' }
export function parseBindingLink(value: string, gateway: string): { bindingId: string; token: string } {
  const url = new URL(value.trim()), base = new URL(gateway)
  const bindingId = url.searchParams.get('bind') ?? '', token = new URLSearchParams(url.hash.slice(1)).get('token') ?? ''
  if (url.origin !== base.origin || url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || !/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(bindingId) || !/^[A-Za-z0-9_-]{32,128}$/.test(token)) throw Error('这不是当前错题本服务的有效绑定二维码，请在电脑上重新生成。')
  return { bindingId, token }
}
