import {
  computePosition,
  offset,
  flip,
  shift,
  autoUpdate,
  type ReferenceElement
} from '@floating-ui/dom'

// Позиционирование всплывающего меню через Floating UI.
// Работает и с реальным элементом-якорем, и с виртуальным (прямоугольник
// выделения текста). flip/shift держат меню в пределах вьюпорта, autoUpdate
// пере-позиционирует при скролле/ресайзе (меню следует за якорем, а не исчезает).
export function useFloatingMenu() {
  const floating = ref<HTMLElement | null>(null)
  const open = ref(false)
  let reference: ReferenceElement | null = null
  let stop: (() => void) | null = null

  function reposition() {
    if (!reference || !floating.value) return
    computePosition(reference, floating.value, {
      strategy: 'fixed',
      placement: 'bottom',
      middleware: [offset(8), flip({ padding: 8 }), shift({ padding: 8 })]
    }).then(({ x, y }) => {
      if (floating.value) {
        floating.value.style.left = `${x}px`
        floating.value.style.top = `${y}px`
      }
    })
  }

  function show(ref: ReferenceElement) {
    reference = ref
    open.value = true
    nextTick(() => {
      if (!floating.value || !reference) return
      stop?.()
      stop = autoUpdate(reference, floating.value, reposition)
    })
  }

  function hide() {
    open.value = false
    stop?.()
    stop = null
    reference = null
  }

  onBeforeUnmount(() => stop?.())

  return { floating, open, show, hide }
}
