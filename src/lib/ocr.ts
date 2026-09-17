import { createWorker, OEM, PSM, type Worker } from 'tesseract.js'
import type { QuestionType } from '../types'
import { cleanOcrText, selectBestCandidate, type OcrCandidate } from './ocr-parser'
import { preprocessForOcr } from './ocr-preprocess'

export type OcrProgress = { status: string; progress: number }

let workerPromise: Promise<Worker> | undefined
let progressListener: ((progress: OcrProgress) => void) | undefined
let recognitionQueue: Promise<unknown> = Promise.resolve()

const assetUrl = (path: string) => new URL(path, window.location.href).href

const createOcrWorker = () => createWorker(['chi_sim', 'eng'], OEM.LSTM_ONLY, {
  workerPath: assetUrl('ocr/worker.min.js'),
  corePath: assetUrl('ocr/core'),
  langPath: assetUrl('ocr/lang'),
  logger: ({ status, progress }) => progressListener?.({ status, progress }),
}).then(async (worker) => {
  await worker.setParameters({ preserve_interword_spaces: '1' })
  return worker
})

export function normalizeRecognizedText(value: string) {
  return cleanOcrText(value)
}

export type RecognizedImage = { text: string; confidence: number; variant: OcrCandidate['variant'] }

const pageSegmentationFor = (type: QuestionType) => type === 'fill-blank' ? PSM.SINGLE_BLOCK : PSM.AUTO

async function runRecognition(dataUrl: string, type: QuestionType, onProgress?: (progress: OcrProgress) => void): Promise<RecognizedImage> {
  progressListener = onProgress
  try {
    workerPromise ??= createOcrWorker().catch((error) => {
      workerPromise = undefined
      throw error
    })
    const worker = await workerPromise
    await worker.setParameters({ tessedit_pageseg_mode: pageSegmentationFor(type), preserve_interword_spaces: '1' })
    const prepared = await preprocessForOcr(dataUrl).catch(() => [])
    const inputs: Array<{ dataUrl: string; variant: OcrCandidate['variant'] }> = [
      { dataUrl, variant: 'original' },
      ...prepared.map((entry) => ({ dataUrl: entry.dataUrl, variant: entry.kind })),
    ]
    const candidates: OcrCandidate[] = []
    for (let index = 0; index < inputs.length; index += 1) {
      progressListener = ({ status, progress }) => onProgress?.({ status, progress: (index + progress) / inputs.length })
      const result = await worker.recognize(inputs[index].dataUrl)
      candidates.push({
        text: normalizeRecognizedText(result.data.text),
        confidence: Number(result.data.confidence) || 0,
        variant: inputs[index].variant,
      })
    }
    return selectBestCandidate(candidates, type)
  } finally {
    progressListener = undefined
  }
}

export function recognizeTypedImage(dataUrl: string, type: QuestionType, onProgress?: (progress: OcrProgress) => void) {
  const task = recognitionQueue.then(() => runRecognition(dataUrl, type, onProgress))
  recognitionQueue = task.catch(() => undefined)
  return task
}

export async function recognizeImage(dataUrl: string, onProgress?: (progress: OcrProgress) => void) {
  return (await recognizeTypedImage(dataUrl, 'short-answer', onProgress)).text
}
