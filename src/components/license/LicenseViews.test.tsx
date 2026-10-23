import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ActivationView } from './ActivationView'
import { ReadonlyNotebook } from './ReadonlyNotebook'
import { initialNotebook } from '../../data'

const status = { state: 'unactivated', canWrite: false, machineCode: 'CTB1-' + Array(8).fill('11111111').join('-'), platform: 'macos', purchaseCode: null, licenseId: null, message: '尚未激活' } as const
it('explains offline activation and preserves a read/export path without a purchase login', () => {
  const html = renderToStaticMarkup(<ActivationView status={status} onActivated={() => {}} onReadonly={() => {}} onRetry={async () => {}} />)
  expect(html).toContain('永久离线授权')
  expect(html).toContain('复制机器码')
  expect(html).toContain('导入授权文件')
  expect(html).toContain('查看与导出已有资料')
  expect(html).not.toContain('type="password"')
})
it('never renders mutation controls in the unlicensed notebook viewer', () => {
  const html = renderToStaticMarkup(<ReadonlyNotebook notebook={initialNotebook} onActivate={() => {}} />)
  expect(html).toContain('只读模式')
  expect(html).toContain('导出完整备份')
  expect(html).not.toContain('收录截图')
  expect(html).not.toContain('保存修改')
  expect(html).not.toContain('显示答案')
})
