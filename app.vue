<script setup lang="ts">
import type { Segment } from '~/composables/useTranscription'

const {
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
} = useTranscription()

const dragging = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

const mediaEl = ref<HTMLMediaElement | null>(null)
const currentTime = ref(0)

function onTimeUpdate() {
  currentTime.value = mediaEl.value?.currentTime ?? 0
}

function seek(t?: number) {
  if (t == null || !mediaEl.value) return
  mediaEl.value.currentTime = t
  mediaEl.value.play()
}

const activeIndex = computed(() => {
  const t = currentTime.value
  return segments.value.findIndex(
    (s) => s.start != null && s.end != null && t >= s.start && t < s.end
  )
})

function pick() {
  fileInput.value?.click()
}

function onInput(e: Event) {
  const files = (e.target as HTMLInputElement).files
  if (files?.length) transcribe(files[0])
}

function onDrop(e: DragEvent) {
  dragging.value = false
  const files = e.dataTransfer?.files
  if (files?.length) transcribe(files[0])
}

const segments = computed<Segment[]>(() => result.value?.segments ?? [])
const plainText = computed(() => {
  if (result.value?.text) return result.value.text
  return segments.value.map((s) => s.text?.trim()).filter(Boolean).join('\n')
})

const copied = ref(false)
async function copyText() {
  await navigator.clipboard.writeText(plainText.value)
  copied.value = true
  setTimeout(() => (copied.value = false), 1500)
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
      <p class="sub">Транскрипция аудио и видео</p>
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
      <button class="btn" @click="reset">Заново</button>
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
          <button class="btn" @click="reset">Новый файл</button>
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
      </div>

      <div v-if="segments.length" class="segments">
        <div
          v-for="(seg, i) in segments"
          :key="i"
          class="segment"
          :class="{ active: i === activeIndex, clickable: seg.start != null }"
          @click="seek(seg.start)"
        >
          <span class="time">{{ fmt(seg.start) }}</span>
          <span v-if="seg.speaker" class="speaker">{{ seg.speaker }}</span>
          <span class="seg-text">{{ seg.text }}</span>
        </div>
      </div>

      <pre v-else-if="plainText" class="plain">{{ plainText }}</pre>

      <pre v-else class="plain raw">{{ JSON.stringify(result, null, 2) }}</pre>
    </section>
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
.actions { display: flex; gap: 8px; }

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

.segments { padding: 8px 0; }
.segment {
  display: grid;
  grid-template-columns: 52px auto 1fr;
  gap: 10px;
  padding: 8px 20px;
  align-items: baseline;
  border-left: 2px solid transparent;
}
.segment.clickable { cursor: pointer; }
.segment:hover { background: #1d2030; }
.segment.active {
  background: #1d2030;
  border-left-color: var(--accent);
}
.segment.active .seg-text { color: #fff; }
.time { color: var(--muted); font-size: 12px; font-family: monospace; }
.speaker {
  color: var(--accent);
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}
.seg-text { line-height: 1.5; }

.plain {
  margin: 0;
  padding: 20px;
  white-space: pre-wrap;
  line-height: 1.6;
  font-family: inherit;
}
.plain.raw { font-family: monospace; font-size: 12px; color: var(--muted); }

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
.btn.ghost {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text);
}
</style>
