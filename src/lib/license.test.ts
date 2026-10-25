import { afterEach, expect, it, vi } from 'vitest'
const native = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => native)
import { activateLicense, canUseWorkbench, exportNotebookData, getLicenseStatus, makeActivationRequest, saveActivationRequest, saveNotebookBackup } from './license'
import { initialNotebook } from '../data'
import type { Notebook } from '../types'

afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs() })
const required = { state: 'unactivated', canWrite: false, machineCode: 'CTB1-' + Array(8).fill('11111111').join('-'), platform: 'macos', purchaseCode: null, licenseId: null, message: '尚未激活' } as const
it('keeps native authority required and does not trust a canWrite flag on an inactive state', async () => {
  native.isTauri.mockReturnValue(true)
  native.invoke.mockResolvedValue(required)
  expect(await getLicenseStatus()).toEqual(required)
  expect(canUseWorkbench({ ...required, canWrite: true })).toBe(false)
  native.invoke.mockRejectedValue('failed')
  expect((await getLicenseStatus()).canWrite).toBe(false)
})
it('labels browser preview without allowing production web to impersonate desktop activation', async () => {
  native.isTauri.mockReturnValue(false)
  vi.stubEnv('DEV', true)
  expect((await getLicenseStatus()).state).toBe('preview')
  await expect(activateLicense('{}')).rejects.toThrow('桌面')
  vi.stubEnv('DEV', false)
  expect((await getLicenseStatus()).canWrite).toBe(false)
})
it('limits imported certificate bytes and accepts only a successful native activation response', async () => {
  native.isTauri.mockReturnValue(true)
  await expect(activateLicense('字'.repeat(12000))).rejects.toThrow('32 KB')
  expect(native.invoke).not.toHaveBeenCalled()
  native.invoke.mockResolvedValue(required)
  await expect(activateLicense('{}')).rejects.toThrow()
  const active = { ...required, state: 'active', canWrite: true, purchaseCode: 'CTB-TEST', licenseId: 'synthetic-id' }
  native.invoke.mockResolvedValue(active)
  expect((await activateLicense('{}')).state).toBe('active')
  expect(native.invoke).toHaveBeenCalledWith('import_license', { contents: '{}' })
})
it('exports only notebook fields and an activation request never contains raw device identifiers', () => {
  const request = makeActivationRequest(required)
  expect(request).toEqual({ version: 1, product: 'mistake-notebook', machineCode: required.machineCode, platform: 'macos' })
  const contents = JSON.parse(exportNotebookData({ ...initialNotebook, license: 'must-not-export', workspacePath: '/private/user/path' } as never))
  expect(contents.items).toEqual([])
  expect(contents).not.toHaveProperty('license')
  expect(contents).not.toHaveProperty('workspacePath')
})
it('uses native save dialogs for desktop requests and read-only backups without needing activation', async () => {
  native.isTauri.mockReturnValue(true)
  native.invoke.mockResolvedValue('/chosen/backup.json')
  expect(await saveNotebookBackup(initialNotebook)).toContain('backup.json')
  expect(native.invoke).toHaveBeenCalledWith('export_notebook_backup', { contents: exportNotebookData(initialNotebook) })
  native.invoke.mockClear()
  expect(await saveActivationRequest(required)).toContain('backup.json')
  expect(native.invoke).toHaveBeenCalledWith('export_license_request')
})
it('never labels a backup complete when cloud originals have not been downloaded', () => {
  const notebook = { ...structuredClone(initialNotebook), items: [{ images: [{ id: 'missing-image', dataUrl: 'data:image/png;base64,' }] }] } as unknown as Notebook
  expect(() => exportNotebookData(notebook)).toThrow('原图')
})
