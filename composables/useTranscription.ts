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
  const result = ref<TranscriptionResult | null>(null)
  const error = ref<string | null>(null)
  const fileName = ref<string | null>(null)
  const mediaUrl = ref<string | null>(null)
  const isVideo = ref(false)

  let stopped = false

  function revokeMedia() {
    if (mediaUrl.value) URL.revokeObjectURL(mediaUrl.value)
    mediaUrl.value = null
  }

  const isBusy = computed(
    () => status.value === 'uploading' || status.value === 'processing'
  )

  function reset() {
    stopped = true
    status.value = 'idle'
    jobId.value = null
    result.value = null
    error.value = null
    fileName.value = null
    revokeMedia()
  }

  async function transcribe(file: File) {
    stopped = false
    error.value = null
    result.value = null
    fileName.value = file.name
    revokeMedia()
    mediaUrl.value = URL.createObjectURL(file)
    isVideo.value = file.type.startsWith('video')
    status.value = 'uploading'

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
    result,
    error,
    fileName,
    mediaUrl,
    isVideo,
    isBusy,
    transcribe,
    reset
  }
}
