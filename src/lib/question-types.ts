import type {
  ChoiceContent,
  FillBlankContent,
  Mistake,
  QuestionType,
  ShortAnswerContent,
} from '../types'

export type ParsedQuestionPatch = {
  question: string
  answer: string
  confidence: number
  choice?: ChoiceContent
  fillBlank?: FillBlankContent
  shortAnswer?: ShortAnswerContent
}

export type ReviewResponse = {
  text?: string
  selectedOptionIds?: string[]
  blanks?: string[]
}

export function defaultTypeContent(type: QuestionType): Pick<Mistake, 'choice' | 'fillBlank' | 'shortAnswer'> {
  if (type === 'choice') {
    return { choice: { mode: 'single', options: [], correctOptionIds: [] }, fillBlank: undefined, shortAnswer: undefined }
  }
  if (type === 'fill-blank') {
    return { choice: undefined, fillBlank: { blanks: [] }, shortAnswer: undefined }
  }
  return { choice: undefined, fillBlank: undefined, shortAnswer: { keyPoints: [] } }
}

export function normalizeMistakeType(item: Mistake): Mistake {
  const questionType: QuestionType = item.questionType ?? 'short-answer'
  const defaults = defaultTypeContent(questionType)
  const recognition = item.recognition?.status === 'processing'
    ? { status: 'idle' as const, reviewed: false, message: '上次识别被中断，可以重新识别' }
    : item.recognition ?? { status: 'idle' as const, reviewed: true }
  return {
    ...item,
    questionType,
    choice: item.choice ?? defaults.choice,
    fillBlank: item.fillBlank ?? defaults.fillBlank,
    shortAnswer: item.shortAnswer ?? defaults.shortAnswer,
    recognition,
  }
}

export function answerTextFor(item: Mistake) {
  if (item.questionType === 'choice' && item.choice?.correctOptionIds.length) {
    return item.choice.correctOptionIds.join('、')
  }
  if (item.questionType === 'fill-blank' && item.fillBlank?.blanks.length) {
    return item.fillBlank.blanks.map((blank) => blank.answer.trim()).filter(Boolean).join('\n')
  }
  return item.answer
}

export function applyParsedQuestion(current: Mistake, parsed: ParsedQuestionPatch): Partial<Mistake> {
  const patch: Partial<Mistake> = {
    question: current.question.trim() ? current.question : parsed.question,
    answer: current.answer.trim() ? current.answer : parsed.answer,
    recognition: {
      status: 'done',
      confidence: parsed.confidence,
      reviewed: false,
      message: parsed.confidence < 70 ? '识别完成，部分内容建议校对' : '识别完成，请确认内容',
    },
  }
  if (current.questionType === 'choice' && !current.choice?.options.length && parsed.choice) patch.choice = parsed.choice
  if (current.questionType === 'fill-blank' && !current.fillBlank?.blanks.length && parsed.fillBlank) patch.fillBlank = parsed.fillBlank
  if (current.questionType === 'short-answer' && !current.shortAnswer?.keyPoints.length && parsed.shortAnswer) patch.shortAnswer = parsed.shortAnswer
  return patch
}

export function serializeResponse(item: Mistake, response: ReviewResponse) {
  if (item.questionType === 'choice') return (response.selectedOptionIds ?? []).join('、')
  if (item.questionType === 'fill-blank') return (response.blanks ?? []).map((value) => value.trim()).join('\n')
  return response.text ?? ''
}
