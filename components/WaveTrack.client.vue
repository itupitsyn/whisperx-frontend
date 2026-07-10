<script setup lang="ts">
import WaveSurfer from 'wavesurfer.js'
import RegionsPlugin, { type Region } from 'wavesurfer.js/plugins/regions'
import TimelinePlugin from 'wavesurfer.js/plugins/timeline'
import HoverPlugin from 'wavesurfer.js/plugins/hover'
import { ALL_GROUPS, classMeta } from '~/utils/speechClasses'
import type { Annotation } from '~/composables/useAnnotations'

// Волновая дорожка для разметки аудио-артефактов (вдох/щелчок/спазм),
// которые не попали в распознанный текст. Плеером остаётся внешний
// <audio>/<video> (проп media) — wavesurfer лишь рисует волну и синхронно
// показывает курсор, а регионы дают выделять куски дорожки.
const props = defineProps<{
  url: string
  media: HTMLMediaElement | null
  annos: Annotation[]
  // Спаны всех слов транскрипта по времени — для валидации вставки текста
  // (ошибка, если регион задевает больше одного слова).
  words?: { start: number; end: number }[]
}>()

const emit = defineEmits<{
  (e: 'add', a: { start: number; end: number; cls: string }): void
  (e: 'remove', index: number): void
  (e: 'play', range: { start: number; end: number }): void
  (
    e: 'transcribe',
    a: { start: number; end: number; cls: string; text: string }
  ): void
}>()

const container = ref<HTMLElement | null>(null)
const zoom = ref(80) // px в секунду
let ws: WaveSurfer | null = null
let regions: RegionsPlugin | null = null
let ready = false
let pending: Region | null = null

// Меню аудио-эффектов позиционируется через Floating UI (по элементу региона).
const {
  floating: menuEl,
  open: menuOpen,
  show: showMenu,
  hide: hideMenu
} = useFloatingMenu()
const groups = ALL_GROUPS

// Текст транскрипции для вставки в текст (необязательный) и ошибка валидации.
const insertText = ref('')
const menuError = ref('')

function colorFor(cls: string): string {
  return classMeta(cls)?.color ?? '#8b90a0'
}

// hex (#rrggbb) -> rgba со своей прозрачностью
function rgba(hex: string, a: number): string {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${a})`
}

function init() {
  if (ws || !container.value || !props.media) return

  regions = RegionsPlugin.create()
  ws = WaveSurfer.create({
    container: container.value,
    media: props.media,
    height: 96,
    waveColor: '#3a3f52',
    progressColor: '#6c8cff',
    cursorColor: '#e7e9ee',
    minPxPerSec: zoom.value,
    autoScroll: true,
    plugins: [
      regions,
      TimelinePlugin.create({ height: 18, timeInterval: 1, primaryLabelInterval: 5 }),
      HoverPlugin.create({ lineColor: '#e7e9ee', labelBackground: '#1f2230' })
    ]
  })

  ws.on('ready', () => {
    ready = true
    renderAnnoRegions()
  })

  // Тянем по волне -> создаётся регион, ждущий выбора класса
  regions.enableDragSelection({ color: rgba('#6c8cff', 0.25) })

  regions.on('region-created', (region) => {
    if (region.id.startsWith('anno-')) return // программный регион разметки
    // отменяем предыдущий незавершённый выбор
    if (pending && pending !== region) pending.remove()
    pending = region
    insertText.value = ''
    menuError.value = ''
    if (region.element) showMenu(region.element)
  })

  // Клик по региону — проиграть его; двойной клик по сохранённому — удалить
  regions.on('region-clicked', (region, e) => {
    e.stopPropagation()
    if (region.id.startsWith('anno-')) region.play()
  })
  regions.on('region-double-clicked', (region, e) => {
    e.stopPropagation()
    if (region.id.startsWith('anno-')) {
      const i = Number(region.id.slice('anno-'.length))
      if (!Number.isNaN(i)) emit('remove', i)
    }
  })
}

function pick(cls: string) {
  if (!pending) return
  const text = insertText.value.trim()
  if (text) {
    // Вставка текста в транскрипт: регион не должен задевать больше одного
    // слова — иначе непонятно, куда вставлять.
    const hit = (props.words ?? []).filter(
      (w) => pending!.start < w.end && pending!.end > w.start
    ).length
    if (hit > 1) {
      menuError.value = 'Выделение задевает несколько слов — сузьте его.'
      return // регион и меню оставляем, чтобы можно было поправить
    }
    emit('transcribe', {
      start: pending.start,
      end: pending.end,
      cls,
      text
    })
  } else {
    emit('add', { start: pending.start, end: pending.end, cls })
  }
  pending.remove() // родитель добавит постоянную метку через props
  pending = null
  insertText.value = ''
  menuError.value = ''
  hideMenu()
}

function cancelPending() {
  if (pending) {
    pending.remove()
    pending = null
  }
  insertText.value = ''
  menuError.value = ''
  hideMenu()
}

// Прослушать выделенный участок дорожки в его пределах (родитель ограничит
// воспроизведение концом диапазона). Меню оставляем открытым.
function playPending() {
  if (pending) emit('play', { start: pending.start, end: pending.end })
}

// Пересобираем регионы сохранённой аудио-разметки из props
function renderAnnoRegions() {
  if (!regions || !ready) return
  for (const r of regions.getRegions()) {
    if (r.id.startsWith('anno-')) r.remove()
  }
  props.annos.forEach((a, i) => {
    if (a.source !== 'audio') return
    regions!.addRegion({
      id: `anno-${i}`,
      start: a.start,
      end: a.end,
      color: rgba(colorFor(a.cls), 0.3),
      drag: false,
      resize: false
    })
  })
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') cancelPending()
}
function onDocMouseDown(e: MouseEvent) {
  if (menuOpen.value && menuEl.value && !menuEl.value.contains(e.target as Node)) {
    cancelPending()
  }
}

watch(zoom, (v) => {
  if (ws && ready) ws.zoom(v)
})
watch(
  () => props.annos,
  () => renderAnnoRegions(),
  { deep: true }
)
watch(
  () => [props.media, props.url],
  () => init()
)

onMounted(() => {
  init()
  document.addEventListener('keydown', onKey)
  document.addEventListener('mousedown', onDocMouseDown)
})
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKey)
  document.removeEventListener('mousedown', onDocMouseDown)
  ws?.destroy()
  ws = null
})
</script>

<template>
  <div class="wt">
    <div class="wt-bar">
      <span class="wt-hint">Выдели участок дорожки → выбери нарушение. 2× клик по метке — удалить.</span>
      <label class="wt-zoom">
        Зум
        <input type="range" min="20" max="400" step="10" v-model.number="zoom" />
      </label>
    </div>

    <div ref="container" class="wt-wave" />

    <!-- Меню аудио-эффектов (позиционируется через Floating UI) -->
    <div v-if="menuOpen" ref="menuEl" class="wt-menu" @mousedown.prevent.stop>
      <button class="wt-item wt-play" @click="playPending">
        <span class="wt-play-icon">▶</span>
        <span class="wt-label">Прослушать выделенное</span>
      </button>
      <input
        v-model="insertText"
        class="wt-text-input"
        placeholder="Транскрипция (необязательно)…"
        @mousedown.stop
        @mouseup.stop
        @click.stop
      />
      <p v-if="menuError" class="wt-error">{{ menuError }}</p>
      <template v-for="g in groups" :key="g.group">
        <div class="wt-menu-head">{{ g.group }}</div>
        <button
          v-for="c in g.items"
          :key="c.id"
          class="wt-item"
          :title="c.description"
          @click="pick(c.id)"
        >
          <span class="wt-dot" :style="{ background: c.color }" />
          <span class="wt-text">
            <span class="wt-label">{{ c.label }}</span>
            <span v-if="c.description" class="wt-desc">{{ c.description }}</span>
          </span>
        </button>
      </template>
      <button class="wt-cancel" @click="cancelPending">Отмена</button>
    </div>
  </div>
</template>

<style scoped>
.wt {
  padding: 4px 20px 16px;
  border-bottom: 1px solid var(--border);
}
.wt-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
  flex-wrap: wrap;
}
.wt-hint {
  font-size: 12px;
  color: var(--muted);
}
.wt-zoom {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--muted);
}
.wt-zoom input {
  accent-color: var(--accent);
}
.wt-wave {
  background: #14161d;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 6px 4px;
}

.wt-menu {
  position: fixed;
  top: 0;
  left: 0;
  z-index: 60;
  background: #1f2230;
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 6px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
  width: 300px;
  max-height: 48vh;
  overflow-y: auto;
}
.wt-menu-head {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--muted);
  padding: 6px 10px 2px;
}
.wt-item {
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
.wt-item:hover {
  background: #2a3350;
}
.wt-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  margin-top: 4px;
  flex: 0 0 auto;
}
.wt-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.wt-label {
  font-size: 13px;
  font-weight: 600;
}
/* Описание — подсказка: максимум 2 строки, полный текст в тултипе (title). */
.wt-desc {
  font-size: 11px;
  color: var(--muted);
  line-height: 1.3;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.wt-play {
  align-items: center;
  color: var(--accent);
  font-weight: 600;
  border-bottom: 1px solid var(--border);
  border-radius: 0;
  margin-bottom: 4px;
}
.wt-play-icon { flex: 0 0 auto; font-size: 11px; }
.wt-text-input {
  font: inherit;
  font-size: 13px;
  color: var(--text);
  background: #14161d;
  border: 1px solid var(--accent);
  border-radius: 6px;
  padding: 6px 8px;
  margin: 4px 0;
  width: 100%;
}
.wt-error {
  margin: 2px 4px 6px;
  font-size: 12px;
  color: var(--error);
  line-height: 1.3;
}
.wt-cancel {
  background: none;
  border: none;
  border-top: 1px solid var(--border);
  margin-top: 4px;
  padding: 8px 10px;
  color: var(--muted);
  font-size: 13px;
  cursor: pointer;
  text-align: left;
}
.wt-cancel:hover {
  color: var(--text);
}
</style>
