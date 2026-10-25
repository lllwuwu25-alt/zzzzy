import { describe, expect, it } from 'vitest'
import { initialNotebook } from '../data'
import { attachNotebook, type MaybeSyncNotebook } from './model'
import { SyncRunner, type SyncTransport } from './engine'
import { CloudError } from './client'

describe('durable sync runner', () => {
  it('does not acknowledge local operations when the gateway fails', async () => {
    let notebook: MaybeSyncNotebook = attachNotebook({ ...structuredClone(initialNotebook), reviewSettings: { mode: 'custom', intervals: { again: 1, hard: 2, good: 3, easy: 4 } } }, { accountId: 'a', libraryId: 'l', environment: 'staging' }, 'd')
    const count = notebook.sync!.outbox.length
    const transport: SyncTransport = { request: async () => { throw new CloudError('REAUTH_REQUIRED', '请重新连接') }, downloadAsset: async () => { throw Error() } }
    const runner = new SyncRunner(transport, { read: () => notebook, commit: async (build) => { notebook = build(notebook) } })
    await expect(runner.run()).rejects.toMatchObject({ code: 'REAUTH_REQUIRED' })
    expect(notebook.sync!.outbox).toHaveLength(count)
    expect(notebook.sync!.lastSuccess).toBeUndefined()
    expect(notebook.sync!.paused).toBe(true)
    expect(notebook.sync!.blocked?.code).toBe('REAUTH_REQUIRED')
  })
  it('only records success when all pages are durable and every pending operation is acknowledged', async () => {
    let notebook: MaybeSyncNotebook = attachNotebook(structuredClone(initialNotebook), { accountId: 'a', libraryId: 'l', environment: 'staging' }, 'd')
    const paths: string[] = []
    const transport: SyncTransport = { request: async <T,>(_method: string, path: string) => {
      paths.push(path)
      if (path.startsWith('/v1/sync/snapshot')) return { epoch: 'epoch-a', cursor: 0, entities: [], hasMore: false } as T
      return { epoch: 'epoch-a', cursor: 0, changes: [], hasMore: false } as T
    }, downloadAsset: async () => { throw Error() } }
    const runner = new SyncRunner(transport, { read: () => notebook, commit: async (build) => { notebook = build(notebook) } })
    await runner.run()
    expect(notebook.sync!.epoch).toBe('epoch-a')
    expect(notebook.sync!.cursor).toBe('0')
    expect(notebook.sync!.lastSuccess).toMatch(/^\d{4}-/)
    expect(paths.every((path) => new URL(path, 'https://example.test').searchParams.get('scope_account') === 'a')).toBe(true)
    expect(paths.every((path) => new URL(path, 'https://example.test').searchParams.get('scope_library') === 'l')).toBe(true)
  })
  it('refuses downloaded bytes that do not match the confirmed image hash', async () => {
    let notebook: MaybeSyncNotebook = attachNotebook(structuredClone(initialNotebook), { accountId: 'a', libraryId: 'l', environment: 'staging' }, 'd')
    const id = 'ffbb8e8e-0111-4111-8111-123456789abc'
    notebook.sync!.entities[`asset:${id}`] = { kind: 'asset', id, revision: 1, payload: { schemaVersion: 1, status: 'ready', sha256: '0'.repeat(64) } }
    const runner = new SyncRunner({ request: async <T,>() => ({} as T), downloadAsset: async () => 'data:image/png;base64,YWJj' }, { read: () => notebook, commit: async (build) => { notebook = build(notebook) } })
    await expect(runner.downloadOne(id)).rejects.toMatchObject({ code: 'ATTACHMENT_HASH_MISMATCH' })
    expect(notebook.sync!.assetCache[id]).toBeUndefined()
  })
  it('does not download an asset that no committed question references', async () => {
    const notebook = attachNotebook(structuredClone(initialNotebook), { accountId: 'a', libraryId: 'l', environment: 'staging' }, 'd')
    const id = 'ffbb8e8e-0111-4111-8111-123456789abc'
    notebook.sync.entities[`asset:${id}`] = { kind: 'asset', id, revision: 1, payload: { schemaVersion: 1, status: 'ready' } }
    const runner = new SyncRunner({ request: async <T,>() => ({} as T), downloadAsset: async () => { throw Error('draft asset must not be fetched') } }, { read: () => notebook, commit: async () => {} })
    await expect(runner.downloadAll()).resolves.toBeUndefined()
  })
})
