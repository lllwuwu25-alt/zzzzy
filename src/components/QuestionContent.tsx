import { memo } from 'react'
import { parseQuestionContent } from '../lib/question-content'
import { MathText } from './MathText'
import './question-content.css'

function CellContent({ text }: { text: string }) {
  const parts = text.split(/(`+[^`]+`+)/g)
  return <>{parts.map((part, index) => /^`+[^`]+`+$/.test(part)
    ? <code key={index}>{part.replace(/^`+|`+$/g, '')}</code>
    : <MathText key={index} text={part} />)}</>
}

export const QuestionContent = memo(function QuestionContent({ text, headingFirst = false }: { text: string; headingFirst?: boolean }) {
  const blocks = parseQuestionContent(text)
  return <div className="question-content">
    {headingFirst && blocks[0]?.type !== 'text' && <h1 className="question-content-sr">题目</h1>}
    {blocks.map((block, index) => block.type === 'text'
      ? headingFirst && index === 0 ? <h1 key={index}><MathText text={block.text} /></h1> : <div className="question-content-text" key={index}><MathText text={block.text} /></div>
      : <div className="question-table-scroll" key={index} tabIndex={0} role="region" aria-label="题目表格，可左右滚动">
        <table><thead><tr>{block.headers.map((cell, col) => <th key={col} scope="col" style={{ textAlign: block.alignments[col] }}><CellContent text={cell} /></th>)}</tr></thead>
          <tbody>{block.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, col) => <td key={col} style={{ textAlign: block.alignments[col] }}><CellContent text={cell} /></td>)}</tr>)}</tbody>
        </table>
      </div>)}
  </div>
})
