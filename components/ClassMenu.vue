<script setup lang="ts">
import type { SpeechGroup } from '~/utils/speechClasses'

// Контекст открытия меню: создать новую разметку из выделения либо сменить класс
// уже существующей (индекс в списке аннотаций).
type PickCtx = { kind: 'create' } | { kind: 'edit'; index: number }

// Меню классов: и создание разметки из выделения (+ прослушать / сменить
// спикера фрагмента), и переклассификация существующей. Позиционируется
// родителем через Floating UI (родитель держит ссылку на корневой элемент).
const props = defineProps<{
  pickCtx: PickCtx
  pending: { start: number; end: number; text: string } | null
  groups: SpeechGroup[]
  speakerOptions: string[]
}>()
const emit = defineEmits<{
  (e: 'play'): void
  (e: 'apply-class', cls: string): void
  (e: 'change-speaker', name: string): void
  (e: 'close'): void
}>()

// Имя нового спикера, вводимое прямо в меню выделения (создать и сразу назначить).
// Владеет им родитель (сбрасывает при смене выделения), поэтому v-model.
const selSpkInput = defineModel<string>('selSpkInput', { required: true })
const canCreateSelSpeaker = computed(() => {
  const v = selSpkInput.value.trim()
  return !!v && !props.speakerOptions.includes(v)
})
</script>

<template>
  <div class="ctx-menu" @mousedown.prevent.stop>
    <button
      v-if="pickCtx.kind === 'create' && pending"
      class="ctx-item ctx-play"
      @click="emit('play')"
    >
      <span class="ctx-play-icon">▶</span>
      <span class="ctx-label">Прослушать выделенное</span>
    </button>
    <div v-if="pickCtx.kind === 'create' && pending" class="ctx-spk">
      <div class="ctx-group">Сменить спикера</div>
      <div class="ctx-spk-chips">
        <button
          v-for="opt in speakerOptions"
          :key="opt"
          class="ctx-spk-chip"
          @click="emit('change-speaker', opt)"
        >
          {{ opt }}
        </button>
        <input
          v-model="selSpkInput"
          class="ctx-spk-new"
          placeholder="Новый спикер…"
          @mousedown.stop
          @mouseup.stop
          @keydown.enter.prevent="canCreateSelSpeaker && emit('change-speaker', selSpkInput)"
          @keydown.esc.prevent="emit('close')"
        />
        <button
          v-if="canCreateSelSpeaker"
          class="ctx-spk-chip ctx-spk-create"
          @click="emit('change-speaker', selSpkInput)"
        >
          ＋ {{ selSpkInput.trim() }}
        </button>
      </div>
    </div>
    <template v-for="g in groups" :key="g.group">
      <div class="ctx-group">{{ g.group }}</div>
      <button
        v-for="c in g.items"
        :key="c.id"
        class="ctx-item"
        :title="c.description"
        @click="emit('apply-class', c.id)"
      >
        <span class="dot" :style="{ background: c.color }" />
        <span class="ctx-text">
          <span class="ctx-label">{{ c.label }}</span>
          <span v-if="c.description" class="ctx-desc">{{ c.description }}</span>
        </span>
      </button>
    </template>
  </div>
</template>

<style>
.ctx-play {
  align-items: center;
  color: var(--accent);
  font-weight: 600;
  width: 100%;
  border-bottom: 1px solid var(--border);
  border-radius: 0;
  margin-bottom: 4px;
}
.ctx-play-icon {
  flex: 0 0 auto;
  font-size: 11px;
}
.ctx-spk {
  border-bottom: 1px solid var(--border);
  padding-bottom: 6px;
  margin-bottom: 4px;
}
.ctx-spk-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 2px 10px 4px;
}
.ctx-spk-chip {
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  color: var(--accent);
  background: #14161d;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 3px 10px;
  cursor: pointer;
  white-space: nowrap;
}
.ctx-spk-chip:hover {
  border-color: var(--accent);
  background: #1d2030;
}
.ctx-spk-new {
  font: inherit;
  font-size: 13px;
  color: var(--text);
  background: #14161d;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 3px 8px;
  width: 9ch;
  min-width: 7ch;
}
.ctx-spk-new:focus {
  outline: none;
  border-color: var(--accent);
}
.ctx-spk-create {
  color: #7ee0a0;
}
</style>
