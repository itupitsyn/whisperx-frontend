<script setup lang="ts">
// Промежуточные состояния: загрузка/распознавание (mode='busy') и ошибка
// (mode='error'). В busy показываем плеер, если файл уже доступен по URL.
defineProps<{
  mode: 'busy' | 'error'
  status: string
  fileName?: string | null
  jobId?: string | null
  mediaUrl?: string | null
  isVideo?: boolean
  error?: string | null
}>()
const emit = defineEmits<{ (e: 'reset'): void }>()
</script>

<template>
  <section v-if="mode === 'busy'" class="status-card">
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

  <section v-else class="status-card error">
    <div class="icon">⚠</div>
    <p class="status-text">Ошибка</p>
    <p class="err-msg">{{ error }}</p>
    <button class="btn" @click="emit('reset')">Заново</button>
  </section>
</template>

<style>
.status-card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 48px 24px;
  text-align: center;
}
.status-card.error {
  border-color: var(--error);
}
.status-text {
  font-size: 18px;
  font-weight: 600;
  margin: 12px 0 4px;
}
.filename {
  color: var(--muted);
  margin: 4px 0;
}
.jobid {
  color: var(--muted);
  font-size: 12px;
  font-family: monospace;
}
.err-msg {
  color: var(--error);
  margin: 8px 0 20px;
}
.status-card .icon {
  font-size: 40px;
}
.spinner {
  width: 40px;
  height: 40px;
  margin: 0 auto;
  border: 3px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
