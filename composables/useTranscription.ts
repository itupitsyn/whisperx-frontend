import { sha256File } from '~/utils/fileHash'
import type { SavedSegment } from '~/composables/useAnnotations'

export type TranscriptionStatus =
  | 'idle'
  | 'uploading'
  | 'processing'
  | 'done'
  | 'error'

export interface Word {
  word?: string
  start?: number
  end?: number
  score?: number
  speaker?: string
}

export interface Segment {
  start?: number
  end?: number
  text?: string
  speaker?: string
  words?: Word[]
}

export interface TranscriptionResult {
  status: string
  segments?: Segment[]
  word_segments?: Word[]
  text?: string
  language?: string
  res?: any
  data?: any
  [key: string]: any
}

const POLL_INTERVAL = 1500

function normalize(status: unknown): string {
  return String(status ?? '').toLowerCase()
}

function errText(err: unknown): string {
  if (!err) return ''
  if (typeof err === 'string') return err
  if (typeof err === 'object') {
    const o = err as any
    return o.message || o.detail || JSON.stringify(o)
  }
  return String(err)
}

export function useTranscription() {
  const status = ref<TranscriptionStatus>('idle')
  const jobId = ref<string | null>(null)
  // Контент-хеш файла (SHA-256) — стабильный ключ для привязки разметки к файлу,
  // не зависящий от эфемерного jobId транскрипции.
  const fileHash = ref<string | null>(null)
  const result = ref<TranscriptionResult | null>(null)
  const error = ref<string | null>(null)
  const fileName = ref<string | null>(null)
  const mediaUrl = ref<string | null>(null)
  const isVideo = ref(false)

  let stopped = false
  // Держим исходный файл, чтобы можно было распознать заново (кнопка) без
  // повторного выбора файла пользователем.
  let lastFile: File | null = null

  function revokeMedia() {
    if (mediaUrl.value) URL.revokeObjectURL(mediaUrl.value)
    mediaUrl.value = null
  }

  const isBusy = computed(
    () => status.value === 'uploading' || status.value === 'processing'
  )

  // Готовим медиа (blob для плеера) под текущий файл.
  function setMedia(file: File) {
    revokeMedia()
    fileName.value = file.name
    mediaUrl.value = URL.createObjectURL(file)
    isVideo.value = file.type.startsWith('video')
  }

  function reset() {
    stopped = true
    status.value = 'idle'
    jobId.value = null
    fileHash.value = null
    result.value = null
    error.value = null
    fileName.value = null
    lastFile = null
    revokeMedia()
  }

  // Открыть файл из сохранённой структуры транскрипта — БЕЗ обращения к WhisperX.
  // Так тайминги и разметка остаются ровно те же, что при сохранении.
  function openSaved(file: File, hash: string, segments: SavedSegment[]) {
    stopped = true // на всякий случай гасим возможный поллинг
    lastFile = file
    error.value = null
    setMedia(file)
    fileHash.value = hash
    jobId.value = null
    result.value = {
      status: 'done',
      segments: segments.map((s) => ({
        speaker: s.speaker ?? undefined,
        start: s.start ?? undefined,
        words: s.words.map((w) => ({
          word: w.text,
          start: w.start ?? undefined,
          end: w.end ?? undefined
        }))
      })),
      text: segments
        .map((s) => s.words.map((w) => w.text).join(' ').replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .join('\n')
    }
    status.value = 'done'
  }

  // Повторно распознать текущий файл через WhisperX (кнопка «Распознать заново»).
  function retranscribe() {
    if (lastFile) transcribe(lastFile)
  }

  async function transcribe(file: File, precomputedHash?: string) {
    stopped = false
    lastFile = file
    error.value = null
    result.value = null
    setMedia(file)
    status.value = 'uploading'

    // Ключ файла нужен для загрузки/сохранения разметки. Если хеш уже посчитан
    // выше (при выборе файла) — берём его, иначе считаем параллельно.
    if (precomputedHash) fileHash.value = precomputedHash
    else sha256File(file).then((h) => (fileHash.value = h)).catch(() => {})

    try {
      const form = new FormData()
      form.append('file', file)

      const { id } = await $fetch<{ id: string }>('/api/transcription', {
        method: 'POST',
        body: form
      })

      jobId.value = id
      status.value = 'processing'
      await poll(id)
    } catch (e: any) {
      status.value = 'error'
      error.value = e?.data?.message || e?.message || 'Не удалось загрузить файл'
    }
  }

  async function poll(id: string) {
    while (!stopped) {
      await sleep(POLL_INTERVAL)
      if (stopped) return

      let res: TranscriptionResult | undefined
      try {
        res = await $fetch<TranscriptionResult>('/api/result', {
          query: { id }
        })
      } catch (e: any) {
        if (e?.status === 404 || e?.statusCode === 404) {
          status.value = 'error'
          error.value = 'Результат не найден (возможно, уже был получен).'
          return
        }
        continue
      }

      const payload = res?.res ?? res?.data ?? res
      const s = normalize(res?.status)

      if (payload?.error || s === 'error') {
        status.value = 'error'
        error.value = errText(payload?.error) || 'Ошибка обработки на сервере'
        return
      }
      if (s === 'done' || payload?.segments) {
        result.value = { ...res, ...payload }
        status.value = 'done'
        return
      }
    }
  }

  function sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms))
  }

  return {
    status,
    jobId,
    fileHash,
    result,
    error,
    fileName,
    mediaUrl,
    isVideo,
    isBusy,
    transcribe,
    openSaved,
    retranscribe,
    reset
  }
}
