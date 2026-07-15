import type { Ref } from 'vue'
import type { Segment, TranscriptionResult } from '~/composables/useTranscription'
import type { Annotation, SavedSegment } from '~/composables/useAnnotations'
import { classColor } from '~/utils/format'

// Слово транскрипта со сквозным индексом (idx общий по всем сегментам).
export interface RWord {
  idx: number
  text: string
  start?: number
  end?: number
}
export interface RSeg {
  key: number
  start?: number
  speaker?: string
  speakerKey: string
  words: RWord[]
}
// Непрерывный отрезок символов слова с одним цветом разметки (или без).
export interface WordRun {
  text: string
  color: string | null
}

// Ключ правки/оверрайда — время начала слова (стабильно между одинаковыми
// транскрипциями); для слов без времени — по idx (такие не сохраняются).
export function wordKey(w: RWord) {
  return w.start != null ? w.start.toFixed(3) : `idx-${w.idx}`
}

interface DocDeps {
  result: Ref<TranscriptionResult | null>
  annos: Ref<Annotation[]>
  addAnno: (a: Annotation) => void
  annosSaved: Ref<boolean>
  currentTime: Ref<number>
}

// Модель транскрипта: разворачивание сегментов в слова, правки текста, оверрайды
// спикеров, подсветка разметки и сборка структуры для сохранения. DOM и меню
// сюда не заезжают — только данные.
export function useTranscriptDoc({
  result,
  annos,
  addAnno,
  annosSaved,
  currentTime
}: DocDeps) {
  // Правки распознанного текста (in-session слой поверх слов). При переоткрытии
  // не восстанавливаются наложением — источник истины уже финальный текст в
  // сохранённой структуре, а edits нужны только для текущего сеанса правок.
  const edits = ref<Record<string, string>>({})
  // Правки текста «расхолаживают» кнопку сохранения (разметку это делает сама
  // useAnnotations через add/remove/changeClass).
  watch(edits, () => (annosSaved.value = false), { deep: true })

  // Ручное переназначение спикеров: диаризация часто лепит всё в один SPEAKER_00,
  // поэтому даём править спикера посегментно. Ключ — стабильный ключ сегмента
  // (время начала), значение — имя ('' = спикер снят). Пустой оверрайд отличается
  // от «нет оверрайда» (undefined), поэтому храним '' явно.
  const speakerEdits = ref<Record<string, string>>({})
  watch(speakerEdits, () => (annosSaved.value = false), { deep: true })

  // Имена, созданные пользователем в этой сессии. Держим отдельно от назначенных
  // на сегменты, чтобы созданное имя не исчезало из списка, если его временно ни
  // на одном сегменте нет (напр. переназначили сегмент дальше).
  const customSpeakers = ref<string[]>([])

  const segments = computed<Segment[]>(() => result.value?.segments ?? [])

  // Спаны всех слов — для валидации вставки текста с дорожки (передаём в
  // WaveTrack). Ошибку показываем, если регион задевает больше одного слова.
  const wordSpans = computed<{ start: number; end: number }[]>(() => {
    const out: { start: number; end: number }[] = []
    for (const s of segments.value) {
      for (const w of s.words ?? []) {
        if (w.start != null && w.end != null) out.push({ start: w.start, end: w.end })
      }
    }
    return out
  })

  // Разворачиваем сегменты в слова со сквозным индексом.
  // Если у сегмента нет word-level разметки — весь текст как одно «слово».
  const renderSegments = computed<RSeg[]>(() => {
    let idx = 0
    return segments.value.map((seg, key) => {
      let words: RWord[]
      if (seg.words?.length) {
        words = seg.words.map((w) => ({
          idx: idx++,
          text: (w.word ?? '').trim(),
          start: w.start,
          end: w.end
        }))
      } else {
        words = [{ idx: idx++, text: seg.text ?? '', start: seg.start, end: seg.end }]
      }
      const start = words[0]?.start ?? seg.start
      // Стабильный ключ сегмента для оверрайда спикера (по времени, как правки слов).
      const speakerKey = start != null ? start.toFixed(3) : `idx-${key}`
      const override = speakerEdits.value[speakerKey]
      return {
        key,
        start,
        speakerKey,
        speaker: override !== undefined ? override : seg.speaker,
        words
      }
    })
  })

  // Слово, играющее прямо сейчас.
  const activeWordIdx = computed(() => {
    const t = currentTime.value
    for (const s of renderSegments.value) {
      for (const w of s.words) {
        if (w.start != null && w.end != null && t >= w.start && t < w.end) return w.idx
      }
    }
    return -1
  })

  // Слово разбиваем на «руны» — непрерывные отрезки символов с одним цветом
  // разметки (или без). Так подсветка ложится только на размеченную часть слова
  // (слог/букву), а не на слово целиком. Границы аннотации внутри слова находим
  // обратной интерполяцией времени в символы (у WhisperX тайминги пословные).
  const wordRunsMap = computed<Record<number, WordRun[]>>(() => {
    const map: Record<number, WordRun[]> = {}
    const textAnnos = annos.value.filter((an) => an.source === 'text')
    for (const s of renderSegments.value) {
      for (const w of s.words) {
        const text = wordText(w)
        const L = text.length
        if (w.start == null || w.end == null || L === 0) {
          map[w.idx] = [{ text, color: null }]
          continue
        }
        const ws = w.start
        const we = w.end
        const denom = we - ws
        const colors: (string | null)[] = new Array(L).fill(null)
        for (const an of textAnnos) {
          if (!(ws < an.end && we > an.start)) continue // не пересекается со словом
          let c0 = denom > 0 ? Math.round(((an.start - ws) / denom) * L) : 0
          let c1 = denom > 0 ? Math.round(((an.end - ws) / denom) * L) : L
          c0 = Math.max(0, Math.min(L, c0))
          c1 = Math.max(0, Math.min(L, c1))
          if (c1 <= c0) {
            // Слишком узкий диапазон — подсветим хотя бы один символ в пределах слова.
            c0 = Math.min(c0, L - 1)
            c1 = c0 + 1
          }
          const col = classColor(an.cls)
          for (let i = c0; i < c1; i++) if (colors[i] == null) colors[i] = col
        }
        // Схлопываем соседние символы одного цвета в непрерывные руны.
        const runs: WordRun[] = []
        for (let i = 0; i < L; ) {
          const col = colors[i]
          let j = i + 1
          while (j < L && colors[j] === col) j++
          runs.push({ text: text.slice(i, j), color: col })
          i = j
        }
        map[w.idx] = runs
      }
    }
    return map
  })

  // ---- редактирование распознанного текста ----
  function wordText(w: RWord) {
    return edits.value[wordKey(w)] ?? w.text
  }
  function isEdited(w: RWord) {
    const v = edits.value[wordKey(w)]
    return v != null && v !== w.text
  }

  const editingKey = ref<string | null>(null)
  // Буфер редактируемого слова: инпут привязан к нему через v-model, поэтому
  // ре-рендеры (тики timeupdate во время проигрывания) не сбрасывают ввод.
  const editValue = ref('')
  // Начать правку слова (пауза медиа и отмена отложенной перемотки — на стороне
  // вызывающего, здесь только состояние редактора).
  function startEdit(w: RWord) {
    // Двойной клик выделяет слово браузером — снимаем, чтобы не всплыло меню классов.
    window.getSelection()?.removeAllRanges()
    editValue.value = wordText(w)
    editingKey.value = wordKey(w)
  }
  function commitEdit(w: RWord) {
    const v = editValue.value.trim()
    const k = wordKey(w)
    if (v && v !== w.text) edits.value[k] = v
    else delete edits.value[k]
    editingKey.value = null
  }
  function cancelEdit() {
    editingKey.value = null
  }

  // Есть ли правки текста (для доступности кнопки «Сохранить»).
  const hasEdits = computed(() => Object.keys(edits.value).length > 0)

  // Структура транскрипта для сохранения: слова с таймингами и финальным текстом.
  function buildSegments(): SavedSegment[] {
    return renderSegments.value.map((s) => ({
      speaker: s.speaker || null,
      start: s.start ?? null,
      words: s.words.map((w) => ({
        text: wordText(w),
        start: w.start ?? null,
        end: w.end ?? null
      }))
    }))
  }

  // Текст для копирования — с учётом правок распознавания.
  const plainText = computed(() => {
    if (renderSegments.value.length) {
      return renderSegments.value
        .map((s) => s.words.map((w) => wordText(w)).join(' ').replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .join('\n')
    }
    if (result.value?.text) return result.value.text
    return segments.value.map((s) => s.text?.trim()).filter(Boolean).join('\n')
  })

  // ---- спикеры ----
  // Опции селекта: имена, назначенные на сегменты, ∪ созданные в сессии.
  const speakerOptions = computed(() => {
    const set = new Set<string>()
    for (const s of renderSegments.value) if (s.speaker) set.add(s.speaker)
    for (const n of customSpeakers.value) set.add(n)
    return [...set].sort()
  })

  // Слова, попавшие в выделение [start, end]. Слово считаем выделенным, если
  // диапазон покрывает хотя бы половину его длительности (частичное касание края
  // не тащит лишнее слово). Если по этому правилу не попало ни одно слово (напр.
  // выделен слог) — берём одно слово с наибольшим перекрытием, чтобы действие
  // всегда что-то делало. Возвращаем сквозные idx слов (как в renderSegments).
  function selectedWordIdxs(start: number, end: number): Set<number> {
    const sel = new Set<number>()
    let best = { idx: -1, ov: 0 }
    for (const s of renderSegments.value) {
      for (const w of s.words) {
        if (w.start == null) continue
        const we = w.end ?? w.start
        const dur = we - w.start
        const ov = Math.min(end, we) - Math.max(start, w.start)
        if (ov <= 0) continue
        if (ov > best.ov) best = { idx: w.idx, ov }
        if (dur <= 0 || ov / dur >= 0.5) sel.add(w.idx)
      }
    }
    if (!sel.size && best.idx >= 0) sel.add(best.idx)
    return sel
  }

  // Назначить выделенному фрагменту спикера name. Разбиваем затронутые сегменты
  // на непрерывные отрезки [до | выделенное | после]: выделенному отрезку — новый
  // спикер, остальным — прежний эффективный. Эффективного спикера (оверрайд ∪
  // seg.speaker) запекаем во все сегменты сразу, после чего speakerEdits можно
  // очистить целиком — ключи по времени старта всё равно поехали из-за разбиения.
  // Возвращает true, если что-то изменилось (для очистки выделения вызывающим).
  function changeSpeakerForSelection(name: string, range: { start: number; end: number }) {
    const res = result.value
    if (!res?.segments) return false
    const newSpk = name.trim()
    const sel = selectedWordIdxs(range.start, range.end)
    const rsegs = renderSegments.value
    const out: Segment[] = []
    let changed = false

    res.segments.forEach((seg, i) => {
      const rseg = rsegs[i]
      const eff = rseg?.speaker
      const words = seg.words ?? []
      if (!words.length || !rseg) {
        out.push({ ...seg, speaker: eff || undefined })
        return
      }
      const flags = words.map((_, wi) => sel.has(rseg.words[wi].idx))
      if (!flags.some(Boolean)) {
        out.push({ ...seg, speaker: eff || undefined })
        return
      }
      changed = true
      // Режем на непрерывные отрезки одинакового флага выделения.
      let from = 0
      for (let wi = 1; wi <= words.length; wi++) {
        if (wi === words.length || flags[wi] !== flags[from]) {
          const slice = words.slice(from, wi)
          out.push({
            ...seg,
            start: slice[0].start ?? seg.start,
            speaker: (flags[from] ? newSpk : eff) || undefined,
            words: slice
          })
          from = wi
        }
      }
    })

    if (changed) {
      if (newSpk && !customSpeakers.value.includes(newSpk)) customSpeakers.value.push(newSpk)
      result.value = { ...res, segments: out }
      speakerEdits.value = {}
      annosSaved.value = false
    }
    return changed
  }

  // Спан сегмента по времени: от начала первого слова до конца последнего.
  function segSpan(s: Segment): { st: number; en: number } {
    const st = s.words?.[0]?.start ?? s.start ?? 0
    const last = s.words?.length ? s.words[s.words.length - 1] : undefined
    const en = last?.end ?? last?.start ?? s.end ?? st
    return { st, en }
  }

  // Вставка транскрипции с дорожки: новое слово попадает в текст транскрипта на
  // нужное по времени место, класс вешается разметкой (подсветит слово).
  // Существующие слова не трогаем; при пересечении >1 сегмента WaveTrack не даёт
  // сюда дойти (валидирует заранее), но подстрахуемся и здесь.
  function onAudioTranscribe(a: { start: number; end: number; cls: string; text: string }) {
    const res = result.value
    if (!res?.segments) return

    // Работаем с копией, затем переприсваиваем result — гарантированная реактивность.
    const segs: Segment[] = res.segments.map((s) => ({
      ...s,
      words: s.words ? [...s.words] : []
    }))

    // Ищем сегмент с наибольшим пересечением по времени (ошибку про >1 слово уже
    // отсеял WaveTrack). Если пересечений нет — регион в тишине, новый сегмент.
    let target = -1
    let best = 0
    segs.forEach((s, i) => {
      const { st, en } = segSpan(s)
      const ov = Math.min(a.end, en) - Math.max(a.start, st)
      if (ov > best) {
        best = ov
        target = i
      }
    })

    const newWord = { word: a.text, start: a.start, end: a.end }
    if (target >= 0) {
      // Вставляем слово в сегмент по возрастанию времени начала.
      const words = segs[target].words!
      const idx = words.findIndex((w) => (w.start ?? 0) > a.start)
      if (idx === -1) words.push(newWord)
      else words.splice(idx, 0, newWord)
    } else {
      // Регион в тишине между сегментами — новый сегмент на нужном месте.
      const newSeg: Segment = { start: a.start, words: [newWord] }
      const idx = segs.findIndex((s) => segSpan(s).st > a.start)
      if (idx === -1) segs.push(newSeg)
      else segs.splice(idx, 0, newSeg)
    }

    result.value = { ...res, segments: segs }
    // Класс — текстовой разметкой: подсветит вставленное слово и попадёт в панель.
    addAnno({ start: a.start, end: a.end, text: a.text, cls: a.cls, source: 'text' })
  }

  // Сброс сессионного слоя правок (при открытии/новом файле/переспознавании).
  function resetSession() {
    edits.value = {}
    speakerEdits.value = {}
    editingKey.value = null
    customSpeakers.value = []
  }

  return {
    // состояние
    edits,
    speakerEdits,
    customSpeakers,
    editingKey,
    editValue,
    // данные
    segments,
    wordSpans,
    renderSegments,
    activeWordIdx,
    wordRunsMap,
    speakerOptions,
    plainText,
    hasEdits,
    // хелперы слов
    wordText,
    isEdited,
    // действия
    startEdit,
    commitEdit,
    cancelEdit,
    buildSegments,
    selectedWordIdxs,
    changeSpeakerForSelection,
    onAudioTranscribe,
    resetSession
  }
}
