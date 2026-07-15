<script setup lang="ts">
// Пикер спикера (creatable select). Позиционируется родителем через Floating UI.
const props = defineProps<{
  speakerOptions: string[]
  // Текущий спикер сегмента — для подсветки активной опции.
  current: string
}>()
const emit = defineEmits<{
  (e: 'apply', name: string): void
  (e: 'clear'): void
  (e: 'close'): void
}>()
const input = defineModel<string>('input', { required: true })

// Показываем «Создать …», только если введённого имени ещё нет в списке.
const canCreate = computed(() => {
  const v = input.value.trim()
  return !!v && !props.speakerOptions.includes(v)
})

// Автофокус на поле ввода имени.
const vFocus = {
  mounted: (el: HTMLInputElement) => {
    el.focus()
    el.select()
  }
}
</script>

<template>
  <div class="ctx-menu spk-menu">
    <input
      v-model="input"
      v-focus
      class="spk-input"
      placeholder="Имя спикера…"
      @keydown.enter.prevent="emit('apply', input)"
      @keydown.esc.prevent="emit('close')"
    />
    <div class="spk-list">
      <button
        v-for="opt in speakerOptions"
        :key="opt"
        class="ctx-item spk-item"
        :class="{ 'spk-active': opt === current }"
        @click="emit('apply', opt)"
      >
        <span class="spk-check">{{ opt === current ? '✓' : '' }}</span>
        {{ opt }}
      </button>
      <button
        v-if="canCreate"
        class="ctx-item spk-item spk-create"
        @click="emit('apply', input)"
      >
        ＋ Создать «{{ input.trim() }}»
      </button>
      <button class="ctx-item spk-item spk-clear" @click="emit('clear')">
        Убрать спикера
      </button>
    </div>
  </div>
</template>

<style>
.spk-menu {
  width: 240px;
}
.spk-input {
  font: inherit;
  color: var(--text);
  background: #14161d;
  border: 1px solid var(--accent);
  border-radius: 6px;
  padding: 6px 8px;
  margin-bottom: 6px;
  width: 100%;
}
.spk-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.spk-item {
  align-items: center;
  font-size: 14px;
  font-weight: 600;
}
.spk-check {
  width: 12px;
  flex: 0 0 auto;
  color: var(--accent);
  font-size: 12px;
}
.spk-active {
  color: var(--accent);
}
.spk-create {
  color: var(--accent);
}
.spk-clear {
  color: var(--muted);
  font-weight: 400;
  border-top: 1px solid var(--border);
  border-radius: 0;
  margin-top: 4px;
}
</style>
