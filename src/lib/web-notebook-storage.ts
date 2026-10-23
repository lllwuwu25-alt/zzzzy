const DATABASE = 'mistake-notebook'
const STORE = 'notebooks'
const RECORD = 'current'

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new DOMException('IndexedDB is unavailable', 'NotSupportedError'))
      return
    }
    const request = indexedDB.open(DATABASE, 1)
    let settled = false
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE)
    }
    request.onerror = () => { settled = true; reject(request.error) }
    request.onblocked = () => {
      settled = true
      reject(new DOMException('Close other notebook tabs and retry', 'StorageBlockedError'))
    }
    request.onsuccess = () => {
      const database = request.result
      if (settled) { database.close(); return }
      database.onversionchange = () => database.close()
      resolve(database)
    }
  })
}

async function transact(mode: IDBTransactionMode, contents?: string, insertOnly = false): Promise<string | null> {
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    let result: string | null = null
    try {
      const transaction = database.transaction(STORE, mode)
      const store = transaction.objectStore(STORE)
      transaction.oncomplete = () => { database.close(); resolve(result) }
      transaction.onabort = () => {
        database.close()
        reject(transaction.error ?? new DOMException('Notebook transaction was aborted', 'AbortError'))
      }
      // Request errors abort the transaction; only its completion means a durable save.
      if (mode === 'readwrite' && !insertOnly) store.put(contents, RECORD)
      else {
        const request = store.get(RECORD)
        request.onsuccess = () => {
          if (request.result !== undefined && typeof request.result !== 'string') {
            transaction.abort()
            return
          }
          result = request.result ?? null
          if (insertOnly && request.result === undefined) {
            store.put(contents, RECORD)
            result = contents!
          }
        }
      }
    } catch (error) {
      database.close()
      reject(error)
    }
  })
}

export function readWebNotebook(): Promise<string | null> {
  return transact('readonly')
}

export async function writeWebNotebook(contents: string): Promise<void> {
  await transact('readwrite', contents)
}

export async function migrateWebNotebook(contents: string): Promise<string> {
  // Another tab may have finished migration since the initial read. Never replace it.
  return (await transact('readwrite', contents, true))!
}
