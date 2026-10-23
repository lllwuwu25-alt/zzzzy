import { createRequire } from 'node:module'
const require = createRequire('/Users/qichen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')
const { chromium } = require('playwright')
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const url = 'http://127.0.0.1:5174/'
const assert = (condition, message) => { if (!condition) throw new Error(message) }
const smallPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nS8AAAAASUVORK5CYII=', 'base64')

try {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(url)
  await page.getByRole('button', { name: '今日复习', exact: true }).waitFor()
  const legacy = await page.evaluate(() => {
    const now = new Date().toISOString()
    const notebook = { version: 1, workspaceName: '迁移测试', taxonomy: { exams: [{ name: '高考', subjects: [{ name: '数学', chapters: ['三角函数'] }] }] }, reviewSettings: { mode: 'custom', intervals: { again: 1, hard: 3, good: 5, easy: 9 } }, reviews: [], items: [{ id: 'legacy', status: 'inbox', question: '保留旧题目', questionType: 'short-answer', answer: '保留答案', cause: '保留错因', note: '保留笔记', tags: ['旧数据'], images: [], exam: '高考', subject: '数学', chapter: '三角函数', createdAt: now, updatedAt: now, schedule: { due: now, stability: 1, difficulty: 5, reps: 0, lapses: 0 } }] }
    const contents = JSON.stringify(notebook)
    localStorage.setItem('mistake-notebook-v1', contents)
    return contents
  })
  await page.reload()
  await page.getByRole('button', { name: '收集箱', exact: true }).click()
  assert(await page.getByRole('textbox', { name: '题干', exact: true }).inputValue() === '保留旧题目', 'Legacy question was lost')

  // A real, decodable PNG large enough to exceed the old localStorage quota.
  const largePng = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 1600; canvas.height = 1200
    const ctx = canvas.getContext('2d'), pixels = ctx.createImageData(canvas.width, canvas.height)
    let seed = 42
    for (let i = 0; i < pixels.data.length; i += 4) {
      for (let c = 0; c < 3; c++) { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; pixels.data[i + c] = seed & 255 }
      pixels.data[i + 3] = 255
    }
    ctx.putImageData(pixels, 0, 0)
    return canvas.toDataURL('image/png').split(',')[1]
  })
  const create = async (buffer, name) => {
    await page.locator('.topbar input[type=file]').setInputFiles({ name, mimeType: 'image/png', buffer })
    const dialog = page.getByRole('dialog')
    await dialog.locator('.question-type-options label').filter({ hasText: '简答题' }).click()
    await dialog.getByRole('button', { name: '创建 1 道错题', exact: true }).click()
    return dialog
  }
  let dialog = await create(Buffer.from(largePng, 'base64'), '大图测试.png')
  await page.waitForFunction(() => !document.querySelector('.capture-dialog') || !!document.querySelector('.capture-dialog [role=alert]'))
  assert(!await dialog.count(), 'Large image import still fails at browser storage quota')
  await page.reload()
  await page.getByRole('button', { name: '收集箱', exact: true }).click()
  const saved = await page.evaluate(async () => {
    const { readWebNotebook } = await import('/src/lib/web-notebook-storage.ts')
    return { contents: await readWebNotebook(), legacy: localStorage.getItem('mistake-notebook-v1') }
  })
  const notebook = JSON.parse(saved.contents)
  assert(saved.legacy === legacy, 'Legacy backup was modified or deleted')
  assert(notebook.items.length === 2, 'Imported question disappeared after reload')
  assert(notebook.items[0].images[0].dataUrl === 'data:image/png;base64,' + largePng, 'Original image changed')
  assert(notebook.items[1].answer === '保留答案' && notebook.items[1].note === '保留笔记', 'Migration dropped existing fields')
  assert(notebook.reviewSettings.intervals.good === 5, 'Migration lost review settings')
  const protectedMigration = await page.evaluate(async legacy => {
    const { readWebNotebook, migrateWebNotebook } = await import('/src/lib/web-notebook-storage.ts')
    const before = await readWebNotebook()
    return await migrateWebNotebook(legacy) === before && await readWebNotebook() === before
  }, legacy)
  assert(protectedMigration, 'A delayed migration overwrote an already saved notebook')

  const aborted = await page.evaluate(async () => {
    const moduleUrl = performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === '/src/store.ts').name
    const { useNotebook } = await import(moduleUrl)
    const { readWebNotebook } = await import('/src/lib/web-notebook-storage.ts')
    const before = await readWebNotebook(), original = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (...args) {
      IDBObjectStore.prototype.put = original
      const request = original.apply(this, args)
      request.addEventListener('success', () => this.transaction.abort())
      return request
    }
    try { await useNotebook.getState().updateItemNow('legacy', { question: '不得提交的内容' }); return false }
    catch { return await readWebNotebook() === before && useNotebook.getState().items.find(item => item.id === 'legacy').question === '保留旧题目' }
  })
  assert(aborted, 'Aborted transaction was reported as saved or altered the notebook')

  const overlapping = await page.evaluate(async () => {
    const moduleUrl = performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === '/src/store.ts').name
    const { useNotebook } = await import(moduleUrl)
    const { readWebNotebook } = await import('/src/lib/web-notebook-storage.ts')
    const saving = useNotebook.getState().updateItemNow('legacy', { question: '编辑后立即删除' })
    await new Promise(resolve => setTimeout(resolve, 0))
    useNotebook.getState().trashItem('legacy')
    await saving
    await new Promise(resolve => setTimeout(resolve, 250))
    const disk = JSON.parse(await readWebNotebook()).items.find(item => item.id === 'legacy')
    const memory = useNotebook.getState().items.find(item => item.id === 'legacy')
    return disk.status === 'trashed' && memory.status === 'trashed' && disk.question === '编辑后立即删除' && memory.question === disk.question
  })
  assert(overlapping, 'Overlapping autosave and trash lost edits or resurrected a question')

  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (...args) {
      IDBObjectStore.prototype.put = put
      throw new DOMException('storage test', 'QuotaExceededError')
    }
  })
  dialog = await create(smallPng, '重试测试.png')
  await dialog.getByRole('alert').waitFor()
  assert((await dialog.getByRole('alert').textContent()).includes('浏览器存储'), 'Quota error incorrectly describes workspace permissions')
  const failedCount = await page.evaluate(async () => JSON.parse(await (await import('/src/lib/web-notebook-storage.ts')).readWebNotebook()).items.length)
  assert(failedCount === 2, `Failed save left a partial question: expected 2, got ${failedCount}`)
  await dialog.getByRole('button', { name: '创建 1 道错题', exact: true }).click()
  await dialog.waitFor({ state: 'detached' })
  assert((await page.evaluate(async () => JSON.parse(await (await import('/src/lib/web-notebook-storage.ts')).readWebNotebook()).items.length)) === 3, 'Retry duplicated or lost a question')

  const migrationContext = await browser.newContext(), migrationPage = await migrationContext.newPage()
  await migrationPage.goto(url)
  await migrationPage.getByRole('button', { name: '今日复习', exact: true }).waitFor()
  await migrationPage.evaluate(contents => localStorage.setItem('mistake-notebook-v1', contents), legacy)
  await migrationPage.addInitScript(() => {
    if (sessionStorage.getItem('qa-migration-failed')) return
    const put = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (...args) {
      IDBObjectStore.prototype.put = put
      sessionStorage.setItem('qa-migration-failed', 'true')
      throw new DOMException('migration test', 'QuotaExceededError')
    }
  })
  await migrationPage.reload()
  await migrationPage.getByRole('heading', { name: '暂时无法读取错题本' }).waitFor()
  assert(await migrationPage.evaluate(() => localStorage.getItem('mistake-notebook-v1')) === legacy, 'Failed migration deleted old data')
  await migrationPage.getByRole('button', { name: '重试读取', exact: true }).click()
  await migrationPage.getByRole('button', { name: '收集箱', exact: true }).click()
  assert(await migrationPage.getByRole('textbox', { name: '题干', exact: true }).inputValue() === '保留旧题目', 'Retry did not recover migration')
  await migrationPage.evaluate(async () => (await import('/src/lib/web-notebook-storage.ts')).writeWebNotebook('{bad-json'))
  await migrationPage.reload()
  await migrationPage.getByRole('heading', { name: '暂时无法读取错题本' }).waitFor()
  assert(await migrationPage.evaluate(async () => (await import('/src/lib/web-notebook-storage.ts')).readWebNotebook()) === '{bad-json', 'Corrupt data was silently overwritten')
  await migrationPage.evaluate(async () => (await import('/src/lib/web-notebook-storage.ts')).writeWebNotebook('{}'))
  await migrationPage.reload()
  await migrationPage.getByRole('heading', { name: '暂时无法读取错题本' }).waitFor({ timeout: 4000 })
  assert(await migrationPage.evaluate(async () => (await import('/src/lib/web-notebook-storage.ts')).readWebNotebook()) === '{}', 'Invalid notebook structure was silently normalized into an empty notebook')
  await migrationPage.screenshot({ path: '/tmp/notebook-storage-recovery.png' })

  const deniedContext = await browser.newContext(), deniedPage = await deniedContext.newPage()
  await deniedPage.addInitScript(() => {
    IDBFactory.prototype.open = () => { throw new DOMException('denied', 'SecurityError') }
  })
  await deniedPage.goto(url)
  await deniedPage.getByRole('heading', { name: '暂时无法读取错题本' }).waitFor()
  assert((await deniedPage.getByRole('alert').textContent()).includes('隐私设置'), 'Denied browser storage is not explained')
  assert(await deniedPage.getByRole('button', { name: '重试读取', exact: true }).isEnabled(), 'Recovery has no retry action')
  await deniedPage.setViewportSize({ width: 390, height: 844 })
  assert(!await deniedPage.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), 'Recovery UI overflows narrow viewport')

  const concurrentContext = await browser.newContext(), concurrentPage = await concurrentContext.newPage()
  await concurrentPage.goto(url)
  await concurrentPage.getByRole('button', { name: '今日复习', exact: true }).waitFor()
  const concurrent = await concurrentPage.evaluate(async () => {
    const moduleUrl = performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === '/src/store.ts').name
    const { useNotebook } = await import(moduleUrl)
    const { readWebNotebook } = await import('/src/lib/web-notebook-storage.ts')
    const store = useNotebook.getState(), id = await store.addCapture([])
    const saving = store.updateItemNow(id, { question: '并发编辑保留' })
    const first = store.addCapture([]), second = store.addCapture([])
    store.addExam('自定义考试'); store.addSubject('自定义考试', '数学'); store.addChapter('自定义考试', '数学', '章节一')
    store.setReviewSettings({ mode: 'custom', intervals: { again: 1, hard: 2, good: 6, easy: 10 } })
    const ids = await Promise.all([first, second])
    await saving
    await store.updateItemNow(id, { exam: '自定义考试', subject: '数学', chapter: '章节一' })
    const disk = JSON.parse(await readWebNotebook()), memory = useNotebook.getState()
    const complete = disk.items.length === 3 && ids.every(id => disk.items.some(item => item.id === id)) && disk.items.find(item => item.id === id).question === '并发编辑保留' && disk.taxonomy.exams[0].subjects[0].chapters[0] === '章节一' && disk.reviewSettings.intervals.good === 6 && JSON.stringify(disk.items) === JSON.stringify(memory.items)
    const original = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (...args) { IDBObjectStore.prototype.put = original; throw new DOMException('rollback test', 'QuotaExceededError') }
    store.trashItem(id)
    await store.updateItemNow(id, { note: '失败后继续保存' })
    const recovered = JSON.parse(await readWebNotebook()).items.find(item => item.id === id)
    return complete && recovered.status === 'inbox' && recovered.note === '失败后继续保存' && useNotebook.getState().items.find(item => item.id === id).status === 'inbox'
  })
  assert(concurrent, 'Concurrent import/catalog changes or optimistic failure rollback lost data')

  const blockedContext = await browser.newContext(), holderPage = await blockedContext.newPage()
  await holderPage.goto(url)
  await holderPage.getByRole('button', { name: '今日复习', exact: true }).waitFor()
  await holderPage.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('mistake-notebook', 1)
    request.onsuccess = () => { window.qaHeldDatabase = request.result; resolve() }
    request.onerror = () => reject(request.error)
  }))
  const blockedPage = await blockedContext.newPage()
  await blockedPage.addInitScript(() => {
    const open = IDBFactory.prototype.open
    IDBFactory.prototype.open = function (name, version) { return open.call(this, name, name === 'mistake-notebook' ? 2 : version) }
  })
  await blockedPage.goto(url)
  await blockedPage.getByRole('heading', { name: '暂时无法读取错题本' }).waitFor()
  assert((await blockedPage.getByRole('alert').textContent()).includes('其他预览标签页'), 'Actual blocked-open event has no actionable explanation')
  await holderPage.close()
  await blockedPage.getByRole('button', { name: '重试读取', exact: true }).click()
  await blockedPage.getByRole('button', { name: '今日复习', exact: true }).waitFor()
  console.log(JSON.stringify({ passed: true, largeImageBytes: Buffer.byteLength(largePng, 'base64'), migration: true, reload: true, failedSaveRetry: true, abortedCommitProtected: true, corruptDataProtected: true, deniedStorageRecovery: true, blockedOpenRecovery: true, concurrentMutations: true }))
} finally {
  await browser.close()
}
