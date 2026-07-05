export interface Annotation {
  start: number
  end: number
  text: string
  cls: string // SpeechClass | AudioEffect
  source: 'text' | 'audio'
}

export interface SavedWord {
  text: string
  start: number | null
  end: number | null
}
export interface SavedSegment {
  speaker: string | null
  start: number | null
  words: SavedWord[]
}

export function useAnnotations() {
  const items = ref<Annotation[]>([])
  const saving = ref(false)
  const saved = ref(false)
  const error = ref<string | null>(null)

  function add(a: Annotation) {
    items.value.push(a)
    saved.value = false
  }

  function remove(i: number) {
    items.value.splice(i, 1)
    saved.value = false
  }

  // Сменить класс существующей разметки (переклассификация без перевыделения).
  function changeClass(i: number, cls: string) {
    const a = items.value[i]
    if (a && a.cls !== cls) {
      a.cls = cls
      saved.value = false
    }
  }

  function clear() {
    items.value = []
    saved.value = false
    error.value = null
  }

  // Сохраняем разметку + транскрипт (плоский текст + структуру слов с таймингами)
  // в локальную БД по контент-хешу файла. filename/jobId — метаданные-справка.
  async function save(
    fileHash: string | null,
    payload: {
      filename?: string | null
      jobId?: string | null
      transcript?: string
      segments?: SavedSegment[]
    } = {}
  ) {
    const transcript = payload.transcript ?? ''
    if (!fileHash || (!items.value.length && !transcript)) return
    saving.value = true
    error.value = null
    saved.value = false
    try {
      await $fetch('/db/annotations', {
        method: 'POST',
        body: {
          fileHash,
          filename: payload.filename ?? null,
          jobId: payload.jobId ?? null,
          annotations: items.value.map((a) => ({
            start: a.start,
            end: a.end,
            text: a.text,
            class: a.cls,
            source: a.source
          })),
          transcript,
          segments: payload.segments ?? []
        }
      })
      saved.value = true
    } catch (e: any) {
      error.value =
        e?.data?.message || e?.message || 'Не удалось сохранить разметку'
    } finally {
      saving.value = false
    }
  }

  // Подтягиваем сохранённую разметку файла. Возвращаем сохранённую структуру
  // транскрипта (источник истины при переоткрытии) и плоский текст.
  async function load(
    fileHash: string | null
  ): Promise<{ transcript: string; segments: SavedSegment[] }> {
    if (!fileHash) return { transcript: '', segments: [] }
    try {
      const { annotations, transcript, segments } = await $fetch<{
        annotations: any[]
        transcript: string
        segments: SavedSegment[]
      }>('/db/annotations', { query: { fileHash } })
      items.value = (annotations ?? []).map((a) => ({
        start: a.start,
        end: a.end,
        text: a.text ?? '',
        cls: a.class,
        source: a.source
      }))
      // Загрузка — не сохранение: кнопка должна остаться «Сохранить»,
      // «Сохранено ✓» показываем только после реального нажатия.
      saved.value = false
      return { transcript: transcript ?? '', segments: segments ?? [] }
    } catch {
      // нет сохранённой разметки / бэкенд недоступен — начинаем с чистого листа
      return { transcript: '', segments: [] }
    }
  }

  return { items, saving, saved, error, add, remove, changeClass, clear, save, load }
}
