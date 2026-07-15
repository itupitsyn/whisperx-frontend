<script setup lang="ts">
import { sha256File } from '~/utils/fileHash'
import { ALL_GROUPS } from '~/utils/speechClasses'
import type { RWord } from '~/composables/useTranscriptDoc'

type PickCtx = { kind: 'create' } | { kind: 'edit'; index: number }

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

const {
  mediaEl,
  speed,
  SPEEDS,
  seek,
  playRange,
  playMedia,
  pauseMedia,
  onTimeUpdate,
  onMediaPlay,
  currentTime
} = usePlayer()

// Модель транскрипта: слова, правки текста, оверрайды спикеров, подсветка.
const {
  edits,
  speakerEdits,
  customSpeakers,
  editingKey,
  editValue,
  wordSpans,
  renderSegments,
  activeWordIdx,
  wordRunsMap,
  speakerOptions,
  plainText,
  hasEdits,
  startEdit,
  commitEdit,
  cancelEdit,
  buildSegments,
  changeSpeakerForSelection,
  onAudioTranscribe,
  resetSession
} = useTranscriptDoc({ result, annos, addAnno, annosSaved, currentTime })

// Пикер спикера над кнопкой сегмента.
const {
  spkEl,
  spkOpen,
  hideSpk,
  spkInput,
  spkCurrent,
  openSpeakerPicker,
  applySpeaker,
  clearSpeaker
} = useSpeakerPicker({ speakerEdits, customSpeakers })

// ---- клик/двойной тап по слову ----
// Одиночный клик/тап — перемотка (откладываем), двойной — правка слова. Двойной
// определяем вручную по времени между тапами одного и того же слова: работает и
// мышью, и на тач-устройствах, где событие dblclick не срабатывает.
const TAP_MS = 300
let clickTimer: ReturnType<typeof setTimeout> | null = null
let lastTap = { idx: -1, t: 0 }
// Войти в правку слова: отменяем отложенную перемотку и ставим на паузу, чтобы
// редактировать в тишине без дёрганья стейта.
function beginEdit(w: RWord) {
  if (clickTimer) {
    clearTimeout(clickTimer)
    clickTimer = null
  }
  pauseMedia()
  startEdit(w)
}
function onWordClick(w: RWord) {
  const now = Date.now()
  // Двойной тап проверяем ПЕРВЫМ: на десктопе он выделяет слово браузером,
  // и проверка выделения ниже иначе съела бы событие до входа в правку.
  if (w.idx === lastTap.idx && now - lastTap.t < TAP_MS) {
    lastTap = { idx: -1, t: 0 }
    beginEdit(w)
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
    // Клик по слову проигрывает только его и останавливается на конце слова.
    // Если у слова нет конца — обычная перемотка (играет дальше).
    if (w.end != null) playRange(w.start, w.end)
    else seek(w.start)
  }, TAP_MS)
}

// ---- меню классов (Floating UI): создание и переклассификация ----
const transcriptRef = ref<{ $el: HTMLElement } | null>(null)
const {
  floating: pickerEl,
  open: pickerOpen,
  show: showPicker,
  hide: hidePicker
} = useFloatingMenu()
const pickCtx = ref<PickCtx>({ kind: 'create' })
const pending = ref<{ start: number; end: number; text: string } | null>(null)
const pickerGroups = ALL_GROUPS
// Имя нового спикера в меню выделения (сбрасываем при смене выделения).
const selSpkInput = ref('')

// Функциональные ref: всплывающие меню — компоненты, а Floating UI нужен их
// корневой DOM-элемент ($el одно-корневого компонента).
function setPickerEl(c: any) {
  pickerEl.value = c?.$el ?? null
}
function setSpkEl(c: any) {
  spkEl.value = c?.$el ?? null
}

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
  const c = transcriptRef.value?.$el
  if (!c || !c.contains(range.commonAncestorContainer)) return

  // Считаем тайминги с точностью до символа. У WhisperX тайминги только
  // пословные, поэтому для частично выделенного слова (слог/буква) время
  // интерполируем линейно по доле символов внутри слова. Для слов, выделенных
  // целиком, границы совпадают с их start/end.
  const times: number[] = []
  for (const el of Array.from(c.querySelectorAll<HTMLElement>('.word'))) {
    const wr = document.createRange()
    wr.selectNodeContents(el)
    const overlaps =
      range.compareBoundaryPoints(Range.END_TO_START, wr) < 0 &&
      range.compareBoundaryPoints(Range.START_TO_END, wr) > 0
    wr.detach()
    if (!overlaps) continue

    const ws = parseFloat(el.dataset.start ?? '')
    const we = parseFloat(el.dataset.end ?? '')
    if (isNaN(ws) || isNaN(we)) continue

    // Длина без хвостового пробела (в спане текст «слово »).
    const L = (el.textContent ?? '').trimEnd().length
    // Символьное смещение границы выделения от начала слова. Считаем через
    // Range.toString(), поэтому устойчиво к вложенным span-«рунам» внутри слова.
    // null — граница вне слова (тогда: начало → 0, конец → L, слово задето целиком).
    const boundaryChar = (node: Node, off: number): number | null => {
      if (!(el === node || el.contains(node))) return null
      const rr = document.createRange()
      rr.selectNodeContents(el)
      try {
        rr.setEnd(node, off)
      } catch {
        return null
      }
      return Math.min(rr.toString().length, L)
    }
    const a = boundaryChar(range.startContainer, range.startOffset) ?? 0
    const b = boundaryChar(range.endContainer, range.endOffset) ?? L
    const at = (ch: number) => (L > 0 ? ws + (ch / L) * (we - ws) : ws)
    times.push(at(a), at(b))
  }
  if (!times.length) return

  pending.value = {
    start: Math.min(...times),
    end: Math.max(...times),
    text: sel.toString().trim()
  }
  pickCtx.value = { kind: 'create' }
  selSpkInput.value = ''
  // Виртуальный якорь считает rect выделения «вживую» — меню следует за скроллом.
  showPicker({ getBoundingClientRect: () => range.getBoundingClientRect() })
}

// Открыть меню, чтобы сменить класс уже существующей разметки (из панели).
function editAnnoClass(index: number, anchor: HTMLElement) {
  const a = annos.value[index]
  if (!a) return
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

// Прослушать текущее выделение (меню не закрываем — можно переслушать/разметить).
function playSelection() {
  if (pending.value) playRange(pending.value.start, pending.value.end)
}

// Сменить спикера у выделенного фрагмента (разбиение сегментов — в модели).
function onChangeSpeaker(name: string) {
  const p = pending.value
  if (p) changeSpeakerForSelection(name, p)
  window.getSelection()?.removeAllRanges()
  pending.value = null
  selSpkInput.value = ''
  hidePicker()
}

// Разметка артефакта прямо на аудиодорожке (вдох/щелчок/спазм).
function onAudioAdd(a: { start: number; end: number; cls: string }) {
  addAnno({ start: a.start, end: a.end, text: '', cls: a.cls, source: 'audio' })
}

function onDocMouseDown(e: MouseEvent) {
  const t = e.target as Node
  if (pickerOpen.value) {
    const f = pickerEl.value
    if (f && !f.contains(t)) hidePicker()
  }
  if (spkOpen.value) {
    const f = spkEl.value
    if (f && !f.contains(t)) hideSpk()
  }
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
// Открытие файла: считаем хеш, проверяем сохранённые данные. Если есть
// сохранённая структура транскрипта — рендерим из неё (WhisperX не гоняем,
// тайминги и разметка сохраняются). Иначе — распознаём заново.
async function onSelectFile(file: File) {
  resetSession()
  const hash = await sha256File(file)
  const { segments: saved } = await loadAnnos(hash) // заодно ставит разметку
  if (saved.length) openSaved(file, hash, saved)
  else transcribe(file, hash)
}

// Распознать текущий файл заново через WhisperX. Правки текста при этом теряются
// (они привязаны к старым словам); разметка остаётся — она по абсолютному времени.
function reRecognize() {
  if (
    !window.confirm(
      'Распознать заново? Правки текста будут потеряны. Разметка нарушений сохранится.'
    )
  )
    return
  resetSession()
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
  resetSession()
  reset()
}

// ---- копирование текста ----
const copied = ref(false)
async function copyText() {
  await navigator.clipboard.writeText(plainText.value)
  copied.value = true
  setTimeout(() => (copied.value = false), 1500)
}
</script>

<template>
  <div class="page">
    <header>
      <h1>WhisperX</h1>
      <p class="sub">Транскрипция и разметка речи</p>
    </header>

    <!-- Загрузка -->
    <DropZone v-if="status === 'idle'" @select="onSelectFile" />

    <!-- Процесс -->
    <TranscribeStatus
      v-else-if="isBusy"
      mode="busy"
      :status="status"
      :file-name="fileName"
      :job-id="jobId"
      :media-url="mediaUrl"
      :is-video="isVideo"
    />

    <!-- Ошибка -->
    <TranscribeStatus
      v-else-if="status === 'error'"
      mode="error"
      :status="status"
      :error="error"
      @reset="newFile"
    />

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
          @play="onMediaPlay"
        />
        <audio
          v-else
          ref="mediaEl"
          :src="mediaUrl"
          controls
          @timeupdate="onTimeUpdate"
          @play="onMediaPlay"
        />
        <div class="speed">
          <button class="speed-btn" title="Воспроизвести" @click="playMedia">▶</button>
          <button class="speed-btn" title="Пауза" @click="pauseMedia">⏸</button>
          <span class="speed-divider" />
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
        :words="wordSpans"
        @add="onAudioAdd"
        @remove="removeAnno"
        @play="playRange($event.start, $event.end)"
        @transcribe="onAudioTranscribe"
      />

      <template v-if="renderSegments.length">
        <TranscriptView
          ref="transcriptRef"
          :segments="renderSegments"
          :active-word-idx="activeWordIdx"
          :word-runs-map="wordRunsMap"
          :editing-key="editingKey"
          :edits="edits"
          v-model:edit-value="editValue"
          @seek="seek"
          @word-click="onWordClick"
          @open-speaker="openSpeakerPicker"
          @commit-edit="commitEdit"
          @cancel-edit="cancelEdit"
        />

        <AnnotationsPanel
          v-if="annos.length"
          :annos="annos"
          :error="annosError"
          @seek="seek"
          @edit-class="editAnnoClass"
          @remove="removeAnno"
        />
      </template>

      <pre v-else-if="plainText" class="plain">{{ plainText }}</pre>
      <pre v-else class="plain raw">{{ JSON.stringify(result, null, 2) }}</pre>
    </section>

    <!-- Меню классов (позиционируется через Floating UI) -->
    <ClassMenu
      v-if="pickerOpen"
      :ref="setPickerEl"
      :pick-ctx="pickCtx"
      :pending="pending"
      :groups="pickerGroups"
      :speaker-options="speakerOptions"
      v-model:sel-spk-input="selSpkInput"
      @play="playSelection"
      @apply-class="applyClass"
      @change-speaker="onChangeSpeaker"
      @close="hidePicker"
    />

    <!-- Пикер спикера (creatable select), позиционируется через Floating UI -->
    <SpeakerMenu
      v-if="spkOpen"
      :ref="setSpkEl"
      :speaker-options="speakerOptions"
      :current="spkCurrent"
      v-model:input="spkInput"
      @apply="applySpeaker"
      @clear="clearSpeaker"
      @close="hideSpk"
    />
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
.speed-divider {
  width: 1px;
  height: 18px;
  background: var(--border);
  margin: 0 4px;
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

.plain {
  margin: 0;
  padding: 20px;
  white-space: pre-wrap;
  line-height: 1.6;
  font-family: inherit;
}
.plain.raw { font-family: monospace; font-size: 12px; color: var(--muted); }

/* Точка-маркер класса (в панели разметки и в меню классов). */
.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  display: inline-block;
}

/* Базовый каркас всплывающих меню (классы + спикер). Специфика — в компонентах. */
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
  max-height: 48vh;
  overflow-y: auto;
}
.ctx-group {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--muted);
  padding: 6px 10px 2px;
}
.ctx-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  background: none;
  border: none;
  color: var(--text);
  padding: 5px 10px;
  border-radius: 6px;
  cursor: pointer;
  text-align: left;
}
.ctx-item:hover { background: #2a3350; }
.ctx-item .dot { margin-top: 4px; flex: 0 0 auto; }
.ctx-text { display: flex; flex-direction: column; gap: 1px; }
.ctx-label { font-size: 13px; font-weight: 600; }
/* Описание — подсказка: не больше 2 строк, дальше многоточие; полный текст
   остаётся в нативном тултипе (title). Это заметно снижает высоту меню. */
.ctx-desc {
  font-size: 11px;
  color: var(--muted);
  line-height: 1.3;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

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
