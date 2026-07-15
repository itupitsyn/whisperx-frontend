<script setup lang="ts">
import type { RSeg, RWord, WordRun } from '~/composables/useTranscriptDoc'
import { wordKey } from '~/composables/useTranscriptDoc'
import { fmt } from '~/utils/format'

// Транскрипт по словам: клик по времени/слову, инлайн-правка слова и кнопка
// смены спикера. Модель (renderSegments, подсветка, правки) приходит пропсами —
// компонент только рендерит и эмитит намерения.
const props = defineProps<{
  segments: RSeg[]
  activeWordIdx: number
  wordRunsMap: Record<number, WordRun[]>
  editingKey: string | null
  // Слой правок текста — чтобы показать исправленное слово и пометку «edited».
  edits: Record<string, string>
}>()
const emit = defineEmits<{
  (e: 'seek', t?: number): void
  (e: 'word-click', w: RWord): void
  (e: 'open-speaker', seg: RSeg, anchor: HTMLElement): void
  (e: 'commit-edit', w: RWord): void
  (e: 'cancel-edit'): void
}>()
// Буфер редактируемого слова (двусторонняя связь с родителем).
const editValue = defineModel<string>('editValue', { required: true })

// Автофокус для инлайн-редактора слова.
const vFocus = {
  mounted: (el: HTMLInputElement) => {
    el.focus()
    el.select()
  }
}

function wordText(w: RWord) {
  return props.edits[wordKey(w)] ?? w.text
}
function isEdited(w: RWord) {
  const v = props.edits[wordKey(w)]
  return v != null && v !== w.text
}
</script>

<template>
  <div>
    <p class="mark-hint">
      Выделите текст → выберите класс нарушения. Тап/клик по слову —
      проиграть его, двойной тап/клик — исправить слово.
    </p>
    <div class="segments">
      <div v-for="seg in segments" :key="seg.key" class="segment">
        <span class="time" @click="emit('seek', seg.start)">{{ fmt(seg.start) }}</span>
        <button
          class="speaker"
          :class="{ 'speaker-empty': !seg.speaker }"
          title="Изменить спикера"
          @click="emit('open-speaker', seg, $event.currentTarget as HTMLElement)"
        >{{ seg.speaker || '＋' }}</button>
        <span class="words">
          <template v-for="w in seg.words" :key="w.idx">
            <input
              v-if="editingKey === wordKey(w)"
              v-model="editValue"
              v-focus
              class="word-input"
              @keydown.enter.prevent="emit('commit-edit', w)"
              @keydown.esc.prevent="emit('cancel-edit')"
              @blur="emit('commit-edit', w)"
              @mousedown.stop
              @mouseup.stop
            />
            <span
              v-else
              class="word"
              :class="{
                active: w.idx === activeWordIdx,
                edited: isEdited(w)
              }"
              :data-start="w.start"
              :data-end="w.end"
              @click="emit('word-click', w)"
              ><span
                v-for="(run, ri) in wordRunsMap[w.idx]"
                :key="ri"
                class="run"
                :class="{ 'run-annotated': !!run.color }"
                :style="run.color ? { borderBottomColor: run.color } : undefined"
                >{{ run.text }}</span
              >{{ ' ' }}</span
            >
          </template>
        </span>
      </div>
    </div>
  </div>
</template>

<style>
.mark-hint {
  margin: 0;
  padding: 10px 20px;
  font-size: 12px;
  color: var(--muted);
  border-bottom: 1px solid var(--border);
}
.segments {
  padding: 8px 0;
}
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
.time:hover {
  color: var(--accent);
}
.speaker {
  color: var(--accent);
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  font-family: inherit;
  background: none;
  border: 1px solid transparent;
  border-radius: 6px;
  padding: 1px 6px;
  cursor: pointer;
  transition: 0.12s;
}
.speaker:hover {
  border-color: var(--accent);
  background: #1d2030;
}
.speaker-empty {
  color: var(--muted);
  font-weight: 400;
  opacity: 0.55;
}
.speaker-empty:hover {
  opacity: 1;
}
.words {
  line-height: 1.7;
  /* явно разрешаем выделение текста (важно для iOS Safari) */
  -webkit-user-select: text;
  user-select: text;
}
.word {
  cursor: pointer;
  transition: background 0.1s;
  /* убирает зум по двойному тапу и 300мс-задержку клика на мобилке */
  touch-action: manipulation;
}
.word:hover {
  background: #262a38;
}
.word.active {
  background: #2a3350;
  color: #fff;
}
.word.edited {
  color: #ffd166;
}
/* Подсветка размеченной части слова живёт на «руне», а не на всём слове,
   чтобы можно было подчеркнуть отдельный слог/букву. */
.run {
  border-bottom: 2px solid transparent;
}
.run-annotated {
  border-bottom-style: solid;
}
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
</style>
