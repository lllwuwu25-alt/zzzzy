export type TableAlignment = 'left' | 'center' | 'right'
export type QuestionBlock = { type: 'text'; text: string } | {
  type: 'table'; headers: string[]; rows: string[][]; alignments: TableAlignment[]
}
const separator = (cell: string) => /^:?-{3,}:?$/.test(cell.trim())

// Pipes inside formulas, code or escaped text are cell content, not column borders.
function scanPipes(text: string) {
  const pipes: number[] = [], escapes: number[] = []
  for (let i = 0; i < text.length; i++) {
    const open = text.startsWith('\\(', i) ? '\\(' : text.startsWith('\\[', i) ? '\\[' : text[i] === '$' ? text.startsWith('$$', i) ? '$$' : '$' : text[i] === '`' ? text.slice(i).match(/^`+/)![0] : ''
    if (open) {
      const close = open === '\\(' ? '\\)' : open === '\\[' ? '\\]' : open
      let end = text.indexOf(close, i + open.length)
      while (end >= 0 && text[end - 1] === '\\') end = text.indexOf(close, end + close.length)
      if (end >= 0) { i = end + close.length - 1; continue }
    }
    if (text[i] === '\\' && i + 1 < text.length) {
      if (text[i + 1] === '|') escapes.push(i)
      i++; continue
    }
    if (text[i] === '|') pipes.push(i)
  }
  return { pipes, escapes }
}

function cellText(text: string) {
  const { escapes } = scanPipes(text)
  const skipped = new Set(escapes)
  return text.split('').filter((_, index) => !skipped.has(index)).join('').trim()
}

function splitRow(line: string): string[] | null {
  const text = line.trim(), { pipes } = scanPipes(text)
  if (!pipes.length) return null
  const boundaries = [-1, ...pipes, text.length]
  const cells = boundaries.slice(1).map((end, index) => text.slice(boundaries[index] + 1, end))
  if (pipes[0] === 0) cells.shift()
  if (pipes.at(-1) === text.length - 1) cells.pop()
  return cells.map(cellText)
}

// Old AI responses sometimes collapsed every row into: | H | N | |---|---| | A | 6 |.
// Recover boundaries only when a real separator row and matching header/body exist.
function repairCollapsedLine(line: string) {
  const { pipes } = scanPipes(line), output: string[] = []
  const tableHeaders = new Set<number>()
  for (let start = 0; start < pipes.length - 1; start++) {
    let end = start
    while (end + 1 < pipes.length && separator(line.slice(pipes[end] + 1, pipes[end + 1]))) end++
    const headerEnd = start - 1, headerStart = headerEnd - (end - start)
    if (end > start && headerStart >= 0 && !line.slice(pipes[headerEnd] + 1, pipes[start]).trim()) tableHeaders.add(headerStart)
  }
  let cursor = 0
  for (let start = 0; start < pipes.length - 1; start++) {
    let end = start
    while (end + 1 < pipes.length && separator(line.slice(pipes[end] + 1, pipes[end + 1]))) end++
    const columns = end - start, headerEnd = start - 1, headerStart = headerEnd - columns
    if (!columns || headerStart < 0 || pipes[headerStart] < cursor || line.slice(pipes[headerEnd] + 1, pipes[start]).trim()) continue
    const rows = [line.slice(pipes[headerStart], pipes[headerEnd] + 1), line.slice(pipes[start], pipes[end] + 1)]
    let rowEnd = end
    while (rowEnd + columns + 1 < pipes.length && !line.slice(pipes[rowEnd] + 1, pipes[rowEnd + 1]).trim()) {
      const rowStart = rowEnd + 1
      if (tableHeaders.has(rowStart)) break
      rowEnd = rowStart + columns
      rows.push(line.slice(pipes[rowStart], pipes[rowEnd] + 1))
    }
    if (rows.length < 3) continue
    const prefix = line.slice(cursor, pipes[headerStart])
    output.push(prefix, prefix ? '\n' : '', rows.join('\n'), '\n')
    cursor = pipes[rowEnd] + 1
    start = rowEnd
  }
  return output.length ? output.join('') + line.slice(cursor) : line
}

export function normalizeQuestionTables(text: string) {
  return text.replace(/\r\n?/g, '\n').split('\n').map(repairCollapsedLine).join('\n')
}

export function parseQuestionContent(text: string): QuestionBlock[] {
  const lines = normalizeQuestionTables(text).split('\n'), blocks: QuestionBlock[] = []
  let pending: string[] = []
  const flush = () => { if (pending.some(line => line.trim())) blocks.push({ type: 'text', text: pending.join('\n') }); pending = [] }
  for (let index = 0; index < lines.length; index++) {
    const headers = splitRow(lines[index]), dividers = index + 1 < lines.length ? splitRow(lines[index + 1]) : null
    if (!headers || !dividers || headers.length !== dividers.length || !dividers.every(separator)) { pending.push(lines[index]); continue }
    flush()
    const rows: string[][] = []
    index++
    while (index + 1 < lines.length) {
      const row = splitRow(lines[index + 1])
      if (!row || row.length !== headers.length || row.every(separator)) break
      rows.push(row); index++
    }
    blocks.push({ type: 'table', headers, rows, alignments: dividers.map(cell => cell.startsWith(':') && cell.endsWith(':') ? 'center' : cell.endsWith(':') ? 'right' : 'left') })
  }
  flush()
  return blocks
}

export function hasQuestionTable(text: string) {
  return parseQuestionContent(text).some(block => block.type === 'table')
}

export function questionSummary(text: string) {
  const blocks = parseQuestionContent(text)
  if (!blocks.some(block => block.type === 'table')) return text.trim()
  const paragraph = blocks.find(block => block.type === 'text')
  if (paragraph?.type === 'text' && blocks[0] === paragraph) return paragraph.text.trim()
  const table = blocks.find(block => block.type === 'table')
  return table?.type === 'table' ? `表格题：${table.headers.join(' / ')}` : text.trim()
}
