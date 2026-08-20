import { createWorker, OEM, PSM, type Worker } from 'tesseract.js'

export type OcrProgress = { status: string; progress: number }

let workerPromise: Promise<Worker> | undefined
let progressListener: ((progress: OcrProgress) => void) | undefined

const assetUrl = (path: string) => new URL(path, window.location.href).href

const createOcrWorker = () => createWorker(['chi_sim', 'eng'], OEM.LSTM_ONLY, {
  workerPath: assetUrl('ocr/worker.min.js'),
  corePath: assetUrl('ocr/core'),
  langPath: assetUrl('ocr/lang'),
  logger: ({ status, progress }) => progressListener?.({ status, progress }),
}).then(async (worker) => {
  await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO, preserve_interword_spaces: '1' })
  return worker
})

export function normalizeRecognizedText(value: string) {
  return value.replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

export async function recognizeImage(dataUrl: string, onProgress?: (progress: OcrProgress) => void) {
  progressListener = onProgress
  try {
    workerPromise ??= createOcrWorker().catch((error) => {
      workerPromise = undefined
      throw error
    })
    const worker = await workerPromise
    const result = await worker.recognize(dataUrl)
    return normalizeRecognizedText(result.data.text)
  } finally {
    progressListener = undefined
  }
}
