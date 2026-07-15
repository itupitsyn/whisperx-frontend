import type { Ref } from 'vue'
import type { RSeg } from '~/composables/useTranscriptDoc'

interface SpeakerPickerDeps {
  speakerEdits: Ref<Record<string, string>>
  customSpeakers: Ref<string[]>
}

// Пикер спикера (creatable select) над кнопкой сегмента. Позиционируется через
// useFloatingMenu; сам меняет speakerEdits и пополняет customSpeakers.
export function useSpeakerPicker({ speakerEdits, customSpeakers }: SpeakerPickerDeps) {
  const {
    floating: spkEl,
    open: spkOpen,
    show: showSpk,
    hide: hideSpk
  } = useFloatingMenu()
  const spkTargetKey = ref<string | null>(null)
  const spkInput = ref('')
  // Текущий спикер открытого сегмента — для подсветки активной опции.
  const spkCurrent = ref('')

  function openSpeakerPicker(seg: RSeg, anchor: HTMLElement) {
    spkTargetKey.value = seg.speakerKey
    spkCurrent.value = seg.speaker ?? ''
    // Предзаполняем текущим именем (v-focus его выделит — можно сразу перепечатать).
    spkInput.value = seg.speaker ?? ''
    showSpk(anchor)
  }
  function applySpeaker(name: string) {
    const key = spkTargetKey.value
    if (key == null) return
    const v = name.trim()
    // Запоминаем созданное имя, чтобы оно осталось в списке селекта.
    if (v && !customSpeakers.value.includes(v)) customSpeakers.value.push(v)
    speakerEdits.value[key] = v
    hideSpk()
  }
  function clearSpeaker() {
    const key = spkTargetKey.value
    if (key == null) return
    speakerEdits.value[key] = ''
    hideSpk()
  }

  return {
    spkEl,
    spkOpen,
    hideSpk,
    spkInput,
    spkCurrent,
    openSpeakerPicker,
    applySpeaker,
    clearSpeaker
  }
}
