export type Page = 'review' | 'inbox' | 'library' | 'history' | 'settings'
export type Rating = 'again' | 'hard' | 'good' | 'easy'
export type Tool = 'select' | 'pen' | 'highlighter' | 'text' | 'arrow' | 'rect' | 'ellipse' | 'mask' | 'eraser'

export type Annotation = {
  id: string
  tool: Exclude<Tool, 'select' | 'eraser'>
  color: string
  width: number
  points: number[]
  text?: string
  fontSize?: number
  opacity?: number
  coordinateSpace?: 'source'
}

export type ImageAsset = {
  id: string
  name: string
  dataUrl: string
  rotation: number
  crop?: { x: number; y: number; width: number; height: number }
  annotations: Annotation[]
  editorVersion?: 2
  sourceWidth?: number
  sourceHeight?: number
}

export type Schedule = {
  due: string
  stability: number
  difficulty: number
  reps: number
  lapses: number
  lastReview?: string
}

export type Mistake = {
  id: string
  status: 'inbox' | 'ready' | 'trashed'
  exam: string
  subject: string
  chapter: string
  question: string
  answer: string
  cause: string
  note: string
  tags: string[]
  images: ImageAsset[]
  createdAt: string
  updatedAt: string
  deletedAt?: string
  schedule: Schedule
}

export type Review = {
  id: string
  mistakeId: string
  rating: Rating
  answerText: string
  reviewedAt: string
  durationSeconds: number
  before: Schedule
  after: Schedule
}

export type Taxonomy = {
  exams: Array<{ name: string; subjects: Array<{ name: string; chapters: string[] }> }>
}

export type Notebook = {
  version: 1
  items: Mistake[]
  reviews: Review[]
  taxonomy: Taxonomy
  workspaceName: string
  workspacePath?: string
  workspaceUpdatedAt?: string
}
