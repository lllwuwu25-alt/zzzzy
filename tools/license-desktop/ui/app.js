const root = document.querySelector('#app'), actions = document.querySelector('#vault-actions')
const status = document.querySelector('#status'), error = document.querySelector('#error')
let state = { unlocked: false, vaultName: null, purchases: [] }, mode = 'welcome', selected = '', replacement = null, busy = false
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
const button = (label, action, className = '', extra = '') => `<button type="button" data-action="${action}" class="${className}" ${extra}>${label}</button>`
const machine = id => `CTB1-${id.toUpperCase().match(/.{8}/g).join('-')}`
const date = value => new Date(value).toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' })
function notice(message, failed = false) {
  error.hidden = !failed; error.textContent = failed ? message : ''
  status.textContent = failed ? '' : message
}
function setBusy(value) {
  busy = value; root.setAttribute('aria-busy', String(value))
  document.querySelectorAll('button,input,textarea').forEach(control => { control.disabled = value })
}
function render() {
  actions.innerHTML = state.unlocked ? `<span class="vault-name">${escape(state.vaultName)}</span>${button('锁定保险库', 'lock')}` : '<span class="local-badge">保险库已锁定</span>'
  if (!state.unlocked) renderUnlock()
  else renderWorkbench()
}
function renderUnlock() {
  if (mode === 'welcome') {
    root.innerHTML = `<section class="welcome"><span class="seal" aria-hidden="true">钥</span><h2>授权有据，密钥在你手中。</h2><p>为每笔购买记录管理两台设备。保险库加密保存在本机，<br>不需要服务器，也不会上传用户的机器码。</p><div class="welcome-actions">${button('打开已有保险库', 'open', 'primary')}${button('创建加密保险库', 'create')}</div><p class="small caution">仅供商家使用。请勿把发码器、保险库或密码发给买家。</p></section>`
    return
  }
  const create = mode === 'create'
  root.innerHTML = `<section class="unlock">${button('返回', 'back', 'quiet')}<h2>${create ? '创建加密保险库' : '解锁你的保险库'}</h2><p>${create ? '仅首次使用时创建。已有保险库请返回并打开原文件，避免生成不同的发行密钥。' : '输入密码后选择原保险库文件。密码错误不会重置或覆盖原文件。'}</p><form id="unlock-form" novalidate><label>${create ? '设置密码' : '保险库密码'}<input type="password" name="password" maxlength="1024" autocomplete="off" spellcheck="false"></label>${create ? '<label>再次输入密码<input type="password" name="confirmation" maxlength="1024" autocomplete="off"></label><p class="small">至少 12 个字符。密码无法找回，请与保险库分别离线备份。</p><label class="check"><input type="checkbox" name="acknowledged">我确认首次创建，并会分别备份保险库和密码</label>' : ''}<button type="submit" class="primary">${create ? '选择位置并创建' : '选择文件并解锁'}</button></form></section>`
  root.querySelector('input')?.focus()
}
function renderWorkbench() {
  let order = state.purchases.find(item => item.purchaseCode === selected)
  if (!order) { order = state.purchases.at(-1); selected = order?.purchaseCode ?? '' }
  root.innerHTML = `<div class="workbench"><aside class="orders"><div class="section-heading"><h2>购买记录</h2><span>${state.purchases.length} 笔</span></div><form id="order-form" novalidate><label>订单备注<input name="label" maxlength="120" placeholder="例如：订单尾号 0624"></label><button type="submit">新建购买记录</button></form><nav aria-label="购买记录">${state.purchases.map(item => `<button type="button" data-action="select" data-code="${escape(item.purchaseCode)}" class="order ${item.purchaseCode === selected ? 'selected' : ''}" ${item.purchaseCode === selected ? 'aria-current="true"' : ''}><strong>${escape(item.label)}</strong><span>已签发 ${item.active.length}/2 台</span><small>${escape(date(item.createdAt))}</small></button>`).join('') || '<p class="empty">先新建一笔购买记录，<br>再为用户的设备签发授权。</p>'}</nav></aside><section class="details">${order ? orderMarkup(order) : '<div class="empty-detail"><h2>从第一笔购买记录开始</h2><p>每笔记录最多签发两台设备，同一机器码重新导出不占新名额。</p></div>'}</section></div><section class="vault-tools"><div><h3>保险库与发行密钥</h3><p>只使用一份主账本签发，不要在多个备份副本上同时发码。</p></div><div class="tool-actions">${button('导出发行公钥', 'public')}${button('备份保险库', 'backup')}</div></section>`
}
function orderMarkup(order) {
  const replaceEntry = order.active.find(entry => entry.deviceId === replacement)
  return `<div class="detail-heading"><h2>${escape(order.label)}</h2><span class="count">已用 ${order.active.length} / 2 个名额</span></div><p class="small">购买编号</p><code class="purchase-code">${escape(order.purchaseCode)}</code><section class="issue-section"><h3>${replaceEntry ? '人工换机' : '签发设备授权'}</h3>${replaceEntry ? `<p class="warning"><strong>旧离线授权不能远程撤销</strong><br>旧设备仍可能继续使用。这里只更新发码账本并保留换机历史。</p><p class="small">原设备：${escape(replaceEntry.label || '未备注设备')}</p>` : '<p>粘贴完整机器码，或选择用户导出的激活申请文件。</p>'}<form id="issue-form" novalidate><label>${replaceEntry ? '新机器码' : '用户机器码'}<textarea name="machineCode" rows="3" maxlength="160" spellcheck="false" placeholder="CTB1-…"></textarea></label><div class="inline-actions">${button('导入激活申请', 'request', 'quiet')}</div><label>设备备注<input name="label" maxlength="120" placeholder="可选，例如：个人 MacBook"></label>${replaceEntry ? '<label>换机原因<textarea name="reason" rows="2" maxlength="500" placeholder="至少 3 个字，便于后续核查"></textarea></label><label class="check"><input type="checkbox" name="acknowledged">我理解旧设备上的离线授权仍可能继续使用</label>' : ''}<div class="form-actions">${replaceEntry ? button('取消换机', 'cancel-replace') : ''}<button type="submit" class="primary">${replaceEntry ? '确认换机并导出' : '签发并导出'}</button></div></form></section><section class="devices"><h3>已授权设备 · ${order.active.length} 台</h3>${order.active.map(entry => `<article class="device"><div class="device-heading"><strong>${escape(entry.label || '未备注设备')}</strong><span>${escape(date(entry.issuedAt))}</span></div><code>${escape(machine(entry.deviceId))}</code><div class="device-actions">${button('重新导出', 'reexport', '', `data-device="${entry.deviceId}"`)}${button('人工换机', 'replace', 'quiet', `data-device="${entry.deviceId}"`)}</div></article>`).join('') || '<p>尚未签发设备授权。取消保存选择不会占用名额。</p>'}</section>${order.retired.length ? `<details class="history" open><summary>换机历史 · ${order.retired.length} 条</summary>${order.retired.map(entry => `<article><strong>${escape(entry.label || '未备注设备')}</strong><p>${escape(entry.reason)}</p><code>${escape(machine(entry.deviceId))}</code><p class="small">${escape(date(entry.retiredAt))} · 原授权仍可能离线使用</p></article>`).join('')}</details>` : ''}`
}
async function call(method, args, options = {}) {
  if (busy) return
  setBusy(true); notice('正在处理，请稍候…')
  try {
    const result = await window.issuer[method](args)
    if (!result.ok) throw Error(result.error)
    if (result.value.cancelled) { notice('已取消，没有新增签发操作。'); return }
    if (result.value.snapshot) state = result.value.snapshot
    if (options.after) options.after(result.value)
    if (options.render !== false) render()
    notice(result.value.outputPath ? `已保存：${result.value.outputPath}` : (options.message || '操作已完成。'))
  } catch (failure) {
    // A certificate can already be committed even when its output file failed.
    // Show the durable ledger, so recovery is possible through “重新导出”.
    try {
      const current = await window.issuer.snapshot()
      if (current.ok && JSON.stringify(current.value) !== JSON.stringify(state)) { state = current.value; render() }
    } catch { /* Preserve the original actionable error if a vault requires reopening. */ }
    notice(failure.message || '操作未完成，请重试。', true)
  }
  finally { setBusy(false) }
}
document.addEventListener('click', event => {
  const control = event.target.closest('button[data-action]')
  if (!control || busy) return
  const action = control.dataset.action
  if (['open', 'create', 'back'].includes(action)) { mode = action === 'back' ? 'welcome' : action; notice('保险库仅保存在本机。'); render(); return }
  if (action === 'select') { selected = control.dataset.code; replacement = null; render(); return }
  if (action === 'replace') { replacement = control.dataset.device; render(); root.querySelector('textarea')?.focus(); return }
  if (action === 'cancel-replace') { replacement = null; render(); return }
  if (action === 'lock') { call('lock', undefined, { after: () => { mode = 'welcome'; selected = ''; replacement = null }, message: '保险库已锁定。' }); return }
  if (action === 'public') { call('exportPublicConfig'); return }
  if (action === 'backup') { call('backupVault'); return }
  if (action === 'request') {
    call('readRequest', undefined, { render: false, after: value => { root.querySelector('[name="machineCode"]').value = value.machineCode }, message: '激活申请已读取，请核对机器码后签发。' }); return
  }
  if (action === 'reexport') call('issue', { purchaseCode: selected, machineCode: machine(control.dataset.device), label: '' })
})
root.addEventListener('submit', event => {
  event.preventDefault(); if (busy) return
  const form = event.target, data = new FormData(form), text = key => String(data.get(key) ?? '')
  if (form.id === 'unlock-form') {
    const args = mode === 'create' ? { password: text('password'), confirmation: text('confirmation'), acknowledged: data.has('acknowledged') } : { password: text('password') }
    form.querySelectorAll('input[type="password"]').forEach(input => { input.value = '' })
    call(mode === 'create' ? 'createVault' : 'openVault', args, { message: '保险库已解锁。请先备份保险库，再导出发行公钥。' })
  } else if (form.id === 'order-form') {
    call('createPurchase', { label: text('label') }, { after: () => { selected = state.purchases.at(-1)?.purchaseCode ?? ''; replacement = null }, message: '购买记录已创建，可签发两台设备。' })
  } else if (form.id === 'issue-form') {
    const args = { purchaseCode: selected, machineCode: text('machineCode'), label: text('label') }
    if (replacement) Object.assign(args, { oldMachineCode: machine(replacement), reason: text('reason'), acknowledged: data.has('acknowledged') })
    call(replacement ? 'replace' : 'issue', args, { after: () => { replacement = null } })
  }
})
render()
if (!window.issuer) notice('无法连接本地发码服务，请通过独立程序打开。', true)
else window.issuer.snapshot().then(result => { if (result.ok) { state = result.value; render() } else notice(result.error, true) }).catch(() => notice('无法读取保险库状态，请重开程序。', true))
