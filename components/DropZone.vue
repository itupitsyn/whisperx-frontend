<script setup lang="ts">
// Зона загрузки: drag&drop или клик по выбору файла. Наружу отдаёт только сам
// файл — что с ним делать (хеш, поиск сохранённого, распознавание) решает выше.
const emit = defineEmits<{ (e: 'select', file: File): void }>()

const dragging = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

function pick() {
  fileInput.value?.click()
}
function onInput(e: Event) {
  const files = (e.target as HTMLInputElement).files
  if (files?.length) emit('select', files[0])
}
function onDrop(e: DragEvent) {
  dragging.value = false
  const files = e.dataTransfer?.files
  if (files?.length) emit('select', files[0])
}
</script>

<template>
  <section
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
</template>

<style>
.dropzone {
  border: 2px dashed var(--border);
  border-radius: 16px;
  padding: 64px 24px;
  text-align: center;
  cursor: pointer;
  transition: 0.15s;
  background: var(--card);
}
.dropzone:hover,
.dropzone.dragging {
  border-color: var(--accent);
  background: #1d2030;
}
.dropzone .icon {
  font-size: 40px;
  margin-bottom: 12px;
}
.dropzone .hint {
  color: var(--muted);
  font-size: 14px;
}
</style>
