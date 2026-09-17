import type { QuestionType } from '../types'
import type { ParsedQuestionPatch } from './question-types'

export type OcrVariant = 'original' | 'enhanced' | 'binary'

export type OcrCandidate = {
  text: string
  confidence: number
  variant: OcrVariant
}

const answerHeading = /^(?:参考答案|正确答案|答案|解析|解答)\s*[:：]?\s*/m
const optionPrefix = /^\s*[（(]?([A-H])[）)]?\s*(?:[.．、:：]\s*)?/gm
const blankMarker = /_{2,}|[（(]\s*[）)]|□+/g

export function cleanOcrText(value: string) {
  return value
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function splitAnswerSection(value: string) {
  const match = answerHeading.exec(value)
  if (!match || match.index === undefined) return { body: value.trim(), answer: '' }
  return {
    body: value.slice(0, match.index).trim(),
    answer: value.slice(match.index + match[0].length).trim(),
  }
}

function parseChoice(body: string, printedAnswer: string) {
  const matches = Array.from(body.matchAll(optionPrefix))
  if (!matches.length) {
    return {
      question: body,
      choice: { mode: 'single' as const, options: [], correctOptionIds: [] },
    }
  }
  const question = body.slice(0, matches[0].index).trim()
  const options = matches.map((match, index) => {
    const start = (match.index ?? 0) + match[0].length
    const end = matches[index + 1]?.index ?? body.length
    const label = match[1].toUpperCase()
    return { id: label, label, text: body.slice(start, end).trim() }
  }).filter((option) => option.text)
  const valid = new Set(options.map((option) => option.id))
  const correctOptionIds = Array.from(new Set((printedAnswer.toUpperCase().match(/[A-H]/g) ?? []).filter((id) => valid.has(id))))
  return {
    question,
    choice: {
      mode: correctOptionIds.length > 1 ? 'multiple' as const : 'single' as const,
      options,
      correctOptionIds,
    },
  }
}

function parsePrintedBlankAnswers(answer: string) {
  if (!answer) return []
  return answer.split(/[\n；;、,，]+/)
    .map((entry) => entry.replace(/^\s*(?:\d+[.、)]|[（(]\d+[）)])\s*/, '').trim())
    .filter(Boolean)
}

function parseKeyPoints(answer: string) {
  const numbered = answer.split('\n')
    .map((entry) => entry.match(/^\s*(?:\d+[.、)]|[（(]\d+[）)])\s*(.+)$/)?.[1]?.trim())
    .filter((entry): entry is string => Boolean(entry))
  return numbered.length ? numbered : []
}

export function parseRecognizedQuestion(value: string, type: QuestionType, confidence = 0): ParsedQuestionPatch {
  const text = cleanOcrText(value)
  const { body, answer } = splitAnswerSection(text)
  if (type === 'choice') {
    const parsed = parseChoice(body, answer)
    const formattedAnswer = parsed.choice.correctOptionIds.join('、')
    return { ...parsed, answer: formattedAnswer, confidence }
  }
  if (type === 'fill-blank') {
    const count = Math.max(1, Array.from(body.matchAll(blankMarker)).length)
    const printed = parsePrintedBlankAnswers(answer)
    const blanks = Array.from({ length: count }, (_, index) => ({ id: `blank-${index + 1}`, answer: printed[index] ?? '' }))
    return { question: body, answer: blanks.map((blank) => blank.answer).filter(Boolean).join('\n'), confidence, fillBlank: { blanks } }
  }
  return {
    question: body,
    answer,
    confidence,
    shortAnswer: { keyPoints: parseKeyPoints(answer) },
  }
}

export function scoreOcrCandidate(candidate: OcrCandidate, type: QuestionType) {
  const text = cleanOcrText(candidate.text)
  const meaningfulCharacters = text.replace(/\s/g, '').length
  let structure = 0
  if (type === 'choice') structure = Array.from(text.matchAll(optionPrefix)).length * 16
  if (type === 'fill-blank') structure = Array.from(text.matchAll(blankMarker)).length * 10
  if (type === 'short-answer' && answerHeading.test(text)) structure = 12
  return candidate.confidence + Math.min(meaningfulCharacters, 40) + structure
}

export function selectBestCandidate(candidates: OcrCandidate[], type: QuestionType) {
  if (!candidates.length) throw new Error('没有可用的识别结果')
  return [...candidates].sort((a, b) => scoreOcrCandidate(b, type) - scoreOcrCandidate(a, type))[0]
}
