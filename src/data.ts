import type { Notebook } from './types'
import { initialSchedule } from './lib/fsrs'

const now = new Date()
const stamp = now.toISOString()

export const initialNotebook: Notebook = {
  version: 1,
  workspaceName: '我的错题本',
  workspacePath: '',
  taxonomy: {
    exams: [
      { name: '考研', subjects: [
        { name: '数学', chapters: ['函数、极限与连续', '一元函数微分学', '线性代数'] },
        { name: '英语', chapters: ['阅读理解', '翻译', '写作'] },
      ] },
    ],
  },
  reviews: [],
  items: [
    {
      id: 'demo-limit',
      status: 'ready',
      exam: '考研',
      subject: '数学',
      chapter: '函数、极限与连续',
      question: '求极限：当 x → 0 时，(ln(1+x) - x + x²/2) / x³。',
      answer: '使用泰勒展开 ln(1+x)=x-x²/2+x³/3+o(x³)，所以极限为 1/3。',
      cause: '展开到二阶就停止，忽略了分母为三次方。',
      note: '先观察分母阶数，再决定展开到哪一阶。',
      tags: ['泰勒展开', '易错'],
      images: [],
      createdAt: stamp,
      updatedAt: stamp,
      schedule: initialSchedule(now),
    },
    {
      id: 'demo-inbox',
      status: 'inbox',
      exam: '',
      subject: '',
      chapter: '',
      question: '导数综合题截图',
      answer: '',
      cause: '',
      note: '',
      tags: [],
      images: [],
      createdAt: stamp,
      updatedAt: stamp,
      schedule: initialSchedule(now),
    },
  ],
}
