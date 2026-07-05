<script setup lang="ts">
import type { Segment } from '~/composables/useTranscription'
import type { SavedSegment } from '~/composables/useAnnotations'
import { sha256File } from '~/utils/fileHash'
import { SPEECH_GROUPS, AUDIO_EFFECTS, classMeta } from '~/utils/speechClasses'

// Автофокус для инлайн-редактора слова
const vFocus = {
  mounted: (el: HTMLInputElement) => {
    el.focus()
    el.select()
  }
}

const {
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
} = useTranscription()

const {
  items: annos,
  saving: savingAnnos,
  saved: annosSaved,
  error: annosError,
  add: addAnno,
  remove: removeAnno,
  changeClass,
  clear: clearAnnos,
  save: saveAnnos,
  load: loadAnnos
} = useAnnotations()

// Правки распознанного текста: ключ — время начала слова (стабильно между
// одинаковыми транскрипциями), значение — исправленное слово.
// Правки распознанного текста (in-session слой поверх слов). При переоткрытии
// не восстанавливаются наложением — источник истины уже финальный текст в
// сохранённой структуре, а edits нужны только для текущего сеанса правок.
const edits = ref<Record<string, string>>({})

// Правки текста тоже «расхолаживают» кнопку сохранения (разметку это делает
// сама useAnnotations через add/remove/changeClass).
watch(edits, () => (annosSaved.value = false), { deep: true })

const dragging = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

// ---- проигрыватель ----
const mediaEl = ref<HTMLMediaElement | null>(null)
const currentTime = ref(0)

// Скорость воспроизведения. Замедление помогает расслышать артефакты речи.
// preservesPitch держим включённым, чтобы тон не «плыл» при 0.25–0.5×.
const SPEEDS = [0.25, 0.5, 0.75, 1]
const speed = ref(1)
function applySpeed() {
  const el = mediaEl.value
  if (!el) return
  el.playbackRate = speed.value
  // @ts-ignore — вендорные варианты для старых браузеров
  el.preservesPitch = el.mozPreservesPitch = el.webkitPreservesPitch = true
}
watch([speed, mediaEl], applySpeed)

function onTimeUpdate() {
  currentTime.value = mediaEl.value?.currentTime ?? 0
}

function seek(t?: number) {
  if (t == null || !mediaEl.value) return
  mediaEl.value.currentTime = t
  mediaEl.value.play()
}

// Одиночный клик/тап по слову — перемотка (откладываем), двойной — правка слова.
// Двойной определяем вручную по времени между тапами одного и того же слова:
// работает и мышью, и на тач-устройствах, где событие dblclick не срабатывает.
const TAP_MS = 300
let clickTimer: ReturnType<typeof setTimeout> | null = null
let lastTap = { idx: -1, t: 0 }
function onWordClick(w: RWord) {
  const now = Date.now()
  // Двойной тап проверяем ПЕРВЫМ: на десктопе он выделяет слово браузером,
  // и проверка выделения ниже иначе съела бы событие до входа в правку.
  if (w.idx === lastTap.idx && now - lastTap.t < TAP_MS) {
    lastTap = { idx: -1, t: 0 }
    startEdit(w) // сам отменит отложенную перемотку и снимет выделение
    return
  }
  // Одиночный: если есть выделение (пользователь выделяет текст для разметки) —
  // не перематываем.
  const sel = window.getSelection()
  if (sel && !sel.isCollapsed) return
  lastTap = { idx: w.idx, t: now }
  if (clickTimer) clearTimeout(clickTimer)
  clickTimer = setTimeout(() => {
    clickTimer = null
    seek(w.start)
  }, TAP_MS)
}

// ---- транскрипт по словам ----
const segments = computed<Segment[]>(() => result.value?.segments ?? [])

interface RWord {
  idx: number
  text: string
  start?: number
  end?: number
}
interface RSeg {
  key: number
  start?: number
  speaker?: string
  words: RWord[]
}

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
    return { key, start: words[0]?.start ?? seg.start, speaker: seg.speaker, words }
  })
})

// Слово, играющее прямо сейчас
const activeWordIdx = computed(() => {
  const t = currentTime.value
  for (const s of renderSegments.value) {
    for (const w of s.words) {
      if (w.start != null && w.end != null && t >= w.start && t < w.end) return w.idx
    }
  }
  return -1
})

// idx слова -> цвет класса (для подсветки размеченного).
// Привязка по СЕРЕДИНЕ слова: устойчива к сдвигу таймингов на несколько мс
// (напр. после повторного распознавания) — подсветка не слетает.
const wordColor = computed<Record<number, string>>(() => {
  const map: Record<number, string> = {}
  for (const s of renderSegments.value) {
    for (const w of s.words) {
      if (w.start == null || w.end == null) continue
      const mid = (w.start + w.end) / 2
      const a = annos.value.find(
        (an) => an.source === 'text' && mid >= an.start && mid <= an.end
      )
      if (a) map[w.idx] = classColor(a.cls)
    }
  }
  return map
})

// ---- редактирование распознанного текста ----
// Ключ правки — время начала слова; для слов без времени — по idx (не сохраняем).
function wordKey(w: RWord) {
  return w.start != null ? w.start.toFixed(3) : `idx-${w.idx}`
}
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
function startEdit(w: RWord) {
  // Отменяем отложенную перемотку от одиночного клика и ставим на паузу,
  // чтобы редактировать в тишине без дёрганья стейта.
  if (clickTimer) {
    clearTimeout(clickTimer)
    clickTimer = null
  }
  mediaEl.value?.pause()
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
    speaker: s.speaker ?? null,
    start: s.start ?? null,
    words: s.words.map((w) => ({
      text: wordText(w),
      start: w.start ?? null,
      end: w.end ?? null
    }))
  }))
}

// ---- меню классов (Floating UI): и создание, и переклассификация ----
const transcriptEl = ref<HTMLElement | null>(null)
const {
  floating: pickerEl,
  open: pickerOpen,
  show: showPicker,
  hide: hidePicker
} = useFloatingMenu()
const pickerMode = ref<'text' | 'audio'>('text')
type PickCtx = { kind: 'create' } | { kind: 'edit'; index: number }
const pickCtx = ref<PickCtx>({ kind: 'create' })
const pending = ref<{ start: number; end: number; text: string } | null>(null)

const pickerGroups = computed(() =>
  pickerMode.value === 'text'
    ? SPEECH_GROUPS
    : [{ group: 'Аудио', items: AUDIO_EFFECTS }]
)

// Реакция на изменение выделения. Слушаем document `selectionchange` (с
// дебаунсом) вместо mouseup — так работает и мышью на десктопе, и выделением
// пальцем на мобилке (где mouseup при выделении через лупу/маркеры не приходит).
let selTimer: ReturnType<typeof setTimeout> | null = null
function onSelectionChange() {
  if (selTimer) clearTimeout(selTimer)
  selTimer = setTimeout(evaluateSelection, 250)
}

function evaluateSelection() {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return

  const range = sel.getRangeAt(0)
  const c = transcriptEl.value
  if (!c || !c.contains(range.commonAncestorContainer)) return

  // Берём все слова, чей диапазон пересекается с выделением
  // (containsNode не годится: часть одного слова им не ловится).
  const chosen: HTMLElement[] = []
  for (const el of Array.from(c.querySelectorAll<HTMLElement>('.word'))) {
    const wr = document.createRange()
    wr.selectNodeContents(el)
    const overlaps =
      range.compareBoundaryPoints(Range.END_TO_START, wr) < 0 &&
      range.compareBoundaryPoints(Range.START_TO_END, wr) > 0
    wr.detach()
    if (overlaps) chosen.push(el)
  }
  const starts = chosen
    .map((el) => parseFloat(el.dataset.start ?? ''))
    .filter((n) => !isNaN(n))
  const ends = chosen
    .map((el) => parseFloat(el.dataset.end ?? ''))
    .filter((n) => !isNaN(n))
  if (!starts.length || !ends.length) return

  pending.value = {
    start: Math.min(...starts),
    end: Math.max(...ends),
    text: chosen
      .map((el) => el.textContent?.trim())
      .filter(Boolean)
      .join(' ')
  }
  pickerMode.value = 'text'
  pickCtx.value = { kind: 'create' }
  // Виртуальный якорь считает rect выделения «вживую» — меню следует за скроллом.
  showPicker({ getBoundingClientRect: () => range.getBoundingClientRect() })
}

// Открыть меню, чтобы сменить класс уже существующей разметки (из панели).
function editAnnoClass(index: number, anchor: HTMLElement) {
  const a = annos.value[index]
  if (!a) return
  pickerMode.value = a.source === 'audio' ? 'audio' : 'text'
  pickCtx.value = { kind: 'edit', index }
  showPicker(anchor)
}

function applyClass(cls: string) {
  const ctx = pickCtx.value
  if (ctx.kind === 'create') {
    if (pending.value) addAnno({ ...pending.value, cls, source: 'text' })
    window.getSelection()?.removeAllRanges()
    pending.value = null
  } else {
    changeClass(ctx.index, cls)
  }
  hidePicker()
}

// Разметка артефакта прямо на аудиодорожке (вдох/щелчок/спазм)
function onAudioAdd(a: { start: number; end: number; cls: string }) {
  addAnno({ start: a.start, end: a.end, text: '', cls: a.cls, source: 'audio' })
}

function onDocMouseDown(e: MouseEvent) {
  if (!pickerOpen.value) return
  const f = pickerEl.value
  if (f && !f.contains(e.target as Node)) hidePicker()
}

onMounted(() => {
  document.addEventListener('mousedown', onDocMouseDown)
  document.addEventListener('selectionchange', onSelectionChange)
})
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocMouseDown)
  document.removeEventListener('selectionchange', onSelectionChange)
})

// ---- загрузка файла ----
function pick() {
  fileInput.value?.click()
}
// Открытие файла: считаем хеш, проверяем сохранённые данные. Если есть
// сохранённая структура транскрипта — рендерим из неё (WhisperX не гоняем,
// тайминги и разметка сохраняются). Иначе — распознаём заново.
async function openFile(file: File) {
  edits.value = {}
  editingKey.value = null
  const hash = await sha256File(file)
  const { segments } = await loadAnnos(hash) // заодно ставит разметку
  if (segments.length) openSaved(file, hash, segments)
  else transcribe(file, hash)
}
function onInput(e: Event) {
  const files = (e.target as HTMLInputElement).files
  if (files?.length) openFile(files[0])
}
function onDrop(e: DragEvent) {
  dragging.value = false
  const files = e.dataTransfer?.files
  if (files?.length) openFile(files[0])
}

// Распознать текущий файл заново через WhisperX. Правки текста при этом
// теряются (они привязаны к старым словам); разметка остаётся — она по
// абсолютному времени аудио.
function reRecognize() {
  if (
    !window.confirm(
      'Распознать заново? Правки текста будут потеряны. Разметка нарушений сохранится.'
    )
  )
    return
  edits.value = {}
  editingKey.value = null
  retranscribe()
}

// Сохранить разметку + транскрипт (плоский текст + структуру слов).
function doSave() {
  saveAnnos(fileHash.value, {
    filename: fileName.value,
    jobId: jobId.value,
    transcript: plainText.value,
    segments: buildSegments()
  })
}

function newFile() {
  clearAnnos()
  edits.value = {}
  editingKey.value = null
  reset()
}

// ---- прочее ----
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

const copied = ref(false)
async function copyText() {
  await navigator.clipboard.writeText(plainText.value)
  copied.value = true
  setTimeout(() => (copied.value = false), 1500)
}

function classColor(cls: string) {
  return classMeta(cls)?.color ?? '#888'
}
function classLabel(cls: string) {
  const m = classMeta(cls)
  if (!m) return cls
  return m.group === 'Общее' ? m.label : `${m.group}: ${m.label}`
}
function fmt(t?: number) {
  if (t == null) return ''
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}
</script>

<template>
  <div class="page">
    <header>
      <h1>WhisperX</h1>
      <p class="sub">Транскрипция и разметка речи</p>
    </header>

    <!-- Загрузка -->
    <section
      v-if="status === 'idle'"
      class="dropzone"
      :class="{ dragging }"
      @click="pick"
      @dragover.prevent="dragging = true"
      @dragleave.prevent="dragging = false"
      @drop.prevent="onDrop"
    >
      <input
        ref="fileInput"
        type="file"
        accept="audio/*,video/*"
        hidden
        @change="onInput"
      />
      <div class="icon">⬆</div>
      <p><strong>Перетащи файл сюда</strong> или кликни, чтобы выбрать</p>
      <p class="hint">аудио или видео</p>
    </section>

    <!-- Процесс -->
    <section v-else-if="isBusy" class="status-card">
      <div class="spinner" />
      <p class="status-text">
        {{ status === 'uploading' ? 'Загружаю файл…' : 'Распознаю речь…' }}
      </p>
      <p v-if="fileName" class="filename">{{ fileName }}</p>
      <p v-if="jobId" class="jobid">id: {{ jobId }}</p>

      <div v-if="mediaUrl" class="player">
        <video v-if="isVideo" :src="mediaUrl" controls />
        <audio v-else :src="mediaUrl" controls />
      </div>
    </section>

    <!-- Ошибка -->
    <section v-else-if="status === 'error'" class="status-card error">
      <div class="icon">⚠</div>
      <p class="status-text">Ошибка</p>
      <p class="err-msg">{{ error }}</p>
      <button class="btn" @click="newFile">Заново</button>
    </section>

    <!-- Результат -->
    <section v-else-if="status === 'done'" class="result">
      <div class="result-head">
        <div>
          <strong>{{ fileName }}</strong>
          <span v-if="result?.language" class="lang">{{ result.language }}</span>
        </div>
        <div class="actions">
          <button class="btn ghost" @click="copyText">
            {{ copied ? 'Скопировано ✓' : 'Копировать' }}
          </button>
          <button class="btn ghost" @click="reRecognize">Распознать заново</button>
          <button
            class="btn"
            :disabled="(!annos.length && !hasEdits) || savingAnnos"
            @click="doSave"
          >
            {{
              savingAnnos
                ? 'Сохраняю…'
                : annosSaved
                  ? 'Сохранено ✓'
                  : `Сохранить (${annos.length})`
            }}
          </button>
          <button class="btn ghost" @click="newFile">Новый файл</button>
        </div>
      </div>

      <div v-if="mediaUrl" class="player">
        <video
          v-if="isVideo"
          ref="mediaEl"
          :src="mediaUrl"
          controls
          @timeupdate="onTimeUpdate"
        />
        <audio
          v-else
          ref="mediaEl"
          :src="mediaUrl"
          controls
          @timeupdate="onTimeUpdate"
        />
        <div class="speed">
          <span class="speed-label">Скорость</span>
          <button
            v-for="s in SPEEDS"
            :key="s"
            class="speed-btn"
            :class="{ active: speed === s }"
            @click="speed = s"
          >
            {{ s }}×
          </button>
        </div>
      </div>

      <WaveTrack
        v-if="mediaUrl && mediaEl"
        :url="mediaUrl"
        :media="mediaEl"
        :annos="annos"
        @add="onAudioAdd"
        @remove="removeAnno"
      />

      <template v-if="renderSegments.length">
        <p class="mark-hint">
          Выделите текст → выберите класс нарушения. Тап/клик по слову —
          перемотка, двойной тап/клик — исправить слово.
        </p>
        <div ref="transcriptEl" class="segments">
          <div v-for="seg in renderSegments" :key="seg.key" class="segment">
            <span class="time" @click="seek(seg.start)">{{ fmt(seg.start) }}</span>
            <span v-if="seg.speaker" class="speaker">{{ seg.speaker }}</span>
            <span class="words">
              <template v-for="w in seg.words" :key="w.idx">
                <input
                  v-if="editingKey === wordKey(w)"
                  v-model="editValue"
                  v-focus
                  class="word-input"
                  @keydown.enter.prevent="commitEdit(w)"
                  @keydown.esc.prevent="cancelEdit()"
                  @blur="commitEdit(w)"
                  @mousedown.stop
                  @mouseup.stop
                />
                <span
                  v-else
                  class="word"
                  :class="{
                    active: w.idx === activeWordIdx,
                    annotated: !!wordColor[w.idx],
                    edited: isEdited(w)
                  }"
                  :data-start="w.start"
                  :data-end="w.end"
                  :style="wordColor[w.idx] ? { borderBottomColor: wordColor[w.idx] } : undefined"
                  @click="onWordClick(w)"
                  >{{ wordText(w) + ' ' }}</span
                >
              </template>
            </span>
          </div>
        </div>

        <!-- Панель разметки -->
        <div v-if="annos.length" class="annos">
          <div class="annos-head">Разметка · {{ annos.length }}</div>
          <div v-for="(a, i) in annos" :key="i" class="anno" @click="seek(a.start)">
            <span class="dot" :style="{ background: classColor(a.cls) }" />
            <span class="anno-label">{{ classLabel(a.cls) }}</span>
            <span class="anno-time">{{ fmt(a.start) }}–{{ fmt(a.end) }}</span>
            <span class="anno-text">{{ a.text }}</span>
            <button
              class="anno-edit"
              title="Сменить класс"
              @click.stop="editAnnoClass(i, ($event.currentTarget as HTMLElement))"
            >
              ✎
            </button>
            <button class="anno-del" title="Удалить" @click.stop="removeAnno(i)">
              ×
            </button>
          </div>
          <p v-if="annosError" class="anno-err">{{ annosError }}</p>
        </div>
      </template>

      <pre v-else-if="plainText" class="plain">{{ plainText }}</pre>
      <pre v-else class="plain raw">{{ JSON.stringify(result, null, 2) }}</pre>
    </section>

    <!-- Меню классов (позиционируется через Floating UI) -->
    <div
      v-if="pickerOpen"
      ref="pickerEl"
      class="ctx-menu"
      @mousedown.prevent.stop
    >
      <template v-for="g in pickerGroups" :key="g.group">
        <div class="ctx-group">{{ g.group }}</div>
        <button
          v-for="c in g.items"
          :key="c.id"
          class="ctx-item"
          :title="c.description"
          @click="applyClass(c.id)"
        >
          <span class="dot" :style="{ background: c.color }" />
          <span class="ctx-text">
            <span class="ctx-label">{{ c.label }}</span>
            <span v-if="c.description" class="ctx-desc">{{ c.description }}</span>
          </span>
        </button>
      </template>
    </div>
  </div>
</template>

<style>
:root {
  --bg: #0e0f13;
  --card: #191b22;
  --border: #2a2d38;
  --text: #e7e9ee;
  --muted: #8b90a0;
  --accent: #6c8cff;
  --error: #ff6b6b;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
}
.page {
  max-width: 760px;
  margin: 0 auto;
  padding: 48px 20px;
}
header { text-align: center; margin-bottom: 32px; }
h1 { margin: 0; font-size: 40px; letter-spacing: -1px; }
.sub { color: var(--muted); margin: 6px 0 0; }

.dropzone {
  border: 2px dashed var(--border);
  border-radius: 16px;
  padding: 64px 24px;
  text-align: center;
  cursor: pointer;
  transition: 0.15s;
  background: var(--card);
}
.dropzone:hover, .dropzone.dragging {
  border-color: var(--accent);
  background: #1d2030;
}
.dropzone .icon { font-size: 40px; margin-bottom: 12px; }
.dropzone .hint { color: var(--muted); font-size: 14px; }

.status-card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 48px 24px;
  text-align: center;
}
.status-card.error { border-color: var(--error); }
.status-text { font-size: 18px; font-weight: 600; margin: 12px 0 4px; }
.filename { color: var(--muted); margin: 4px 0; }
.jobid { color: var(--muted); font-size: 12px; font-family: monospace; }
.err-msg { color: var(--error); margin: 8px 0 20px; }
.status-card .icon { font-size: 40px; }

.spinner {
  width: 40px; height: 40px;
  margin: 0 auto;
  border: 3px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

.result {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 16px;
  overflow: hidden;
}
.result-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
  flex-wrap: wrap;
}
.lang {
  margin-left: 8px;
  font-size: 12px;
  color: var(--muted);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 2px 6px;
  text-transform: uppercase;
}
.actions { display: flex; gap: 8px; flex-wrap: wrap; }

.player {
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
}
.player audio { width: 100%; }
.player video {
  width: 100%;
  max-height: 320px;
  border-radius: 8px;
  background: #000;
}
.speed {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 10px;
}
.speed-label {
  font-size: 12px;
  color: var(--muted);
  margin-right: 4px;
}
.speed-btn {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--muted);
  border-radius: 6px;
  padding: 3px 10px;
  font-size: 13px;
  cursor: pointer;
}
.speed-btn:hover { color: var(--text); }
.speed-btn.active {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

.mark-hint {
  margin: 0;
  padding: 10px 20px;
  font-size: 12px;
  color: var(--muted);
  border-bottom: 1px solid var(--border);
}

.segments { padding: 8px 0; }
.segment {
  display: grid;
  grid-template-columns: 52px auto 1fr;
  gap: 10px;
  padding: 8px 20px;
  align-items: baseline;
}
.time {
  color: var(--muted);
  font-size: 12px;
  font-family: monospace;
  cursor: pointer;
}
.time:hover { color: var(--accent); }
.speaker {
  color: var(--accent);
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}
.words {
  line-height: 1.7;
  /* явно разрешаем выделение текста (важно для iOS Safari) */
  -webkit-user-select: text;
  user-select: text;
}
.word {
  cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: background 0.1s;
  /* убирает зум по двойному тапу и 300мс-задержку клика на мобилке */
  touch-action: manipulation;
}
.word:hover { background: #262a38; }
.word.active {
  background: #2a3350;
  color: #fff;
}
.word.annotated { border-bottom-style: solid; }
.word.edited { color: #ffd166; }
.word-input {
  font: inherit;
  color: #fff;
  background: #14161d;
  border: 1px solid var(--accent);
  border-radius: 4px;
  padding: 0 4px;
  margin-right: 4px;
  width: 8ch;
  min-width: 4ch;
  touch-action: manipulation;
}

.plain {
  margin: 0;
  padding: 20px;
  white-space: pre-wrap;
  line-height: 1.6;
  font-family: inherit;
}
.plain.raw { font-family: monospace; font-size: 12px; color: var(--muted); }

.annos {
  border-top: 1px solid var(--border);
  padding: 12px 20px 4px;
}
.annos-head {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--muted);
  margin-bottom: 8px;
}
.anno {
  display: grid;
  grid-template-columns: 12px auto auto 1fr auto auto;
  gap: 10px;
  align-items: center;
  padding: 6px 0;
  cursor: pointer;
  border-bottom: 1px solid var(--border);
}
.anno:last-of-type { border-bottom: none; }
.anno:hover { background: #1d2030; }
.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  display: inline-block;
}
.anno-label { font-size: 13px; font-weight: 600; }
.anno-time { font-size: 12px; font-family: monospace; color: var(--muted); }
.anno-text {
  font-size: 13px;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.anno-edit,
.anno-del {
  background: none;
  border: none;
  color: var(--muted);
  font-size: 16px;
  cursor: pointer;
  line-height: 1;
}
.anno-del { font-size: 18px; }
.anno-edit:hover { color: var(--accent); }
.anno-del:hover { color: var(--error); }
.anno-err { color: var(--error); font-size: 13px; margin: 8px 0; }

.ctx-menu {
  position: fixed;
  top: 0;
  left: 0;
  z-index: 50;
  background: #1f2230;
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 6px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
  width: 320px;
  max-height: 60vh;
  overflow-y: auto;
}
.ctx-group {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--muted);
  padding: 8px 10px 4px;
}
.ctx-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  background: none;
  border: none;
  color: var(--text);
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
  text-align: left;
}
.ctx-item:hover { background: #2a3350; }
.ctx-item .dot { margin-top: 4px; flex: 0 0 auto; }
.ctx-text { display: flex; flex-direction: column; gap: 2px; }
.ctx-label { font-size: 14px; font-weight: 600; }
.ctx-desc { font-size: 12px; color: var(--muted); line-height: 1.35; }

.btn {
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: 8px;
  padding: 8px 16px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}
.btn:hover { filter: brightness(1.1); }
.btn:disabled { opacity: 0.5; cursor: default; filter: none; }
.btn.ghost {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text);
}
</style>
