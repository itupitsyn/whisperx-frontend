<script setup lang="ts">
import type { Annotation } from '~/composables/useAnnotations'
import { classColor, classLabel, fmt } from '~/utils/format'

// Панель размеченных нарушений: перемотка на клик, смена класса и удаление.
defineProps<{
  annos: Annotation[]
  error?: string | null
}>()
const emit = defineEmits<{
  (e: 'seek', t: number): void
  (e: 'edit-class', index: number, anchor: HTMLElement): void
  (e: 'remove', index: number): void
}>()
</script>

<template>
  <div class="annos">
    <div class="annos-head">Разметка · {{ annos.length }}</div>
    <div v-for="(a, i) in annos" :key="i" class="anno" @click="emit('seek', a.start)">
      <span class="dot" :style="{ background: classColor(a.cls) }" />
      <span class="anno-label">{{ classLabel(a.cls) }}</span>
      <span class="anno-time">{{ fmt(a.start) }}–{{ fmt(a.end) }}</span>
      <span class="anno-text">{{ a.text }}</span>
      <button
        class="anno-edit"
        title="Сменить класс"
        @click.stop="emit('edit-class', i, $event.currentTarget as HTMLElement)"
      >
        ✎
      </button>
      <button class="anno-del" title="Удалить" @click.stop="emit('remove', i)">
        ×
      </button>
    </div>
    <p v-if="error" class="anno-err">{{ error }}</p>
  </div>
</template>

<style>
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
.anno:last-of-type {
  border-bottom: none;
}
.anno:hover {
  background: #1d2030;
}
.anno-label {
  font-size: 13px;
  font-weight: 600;
}
.anno-time {
  font-size: 12px;
  font-family: monospace;
  color: var(--muted);
}
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
.anno-del {
  font-size: 18px;
}
.anno-edit:hover {
  color: var(--accent);
}
.anno-del:hover {
  color: var(--error);
}
.anno-err {
  color: var(--error);
  font-size: 13px;
  margin: 8px 0;
}
</style>
