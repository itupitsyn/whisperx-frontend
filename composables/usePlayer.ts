// Проигрыватель медиа: перемотка, скорость и ограничение воспроизведения
// диапазоном (чтобы прослушивать выделенный фрагмент, а не «убегать» дальше).
export function usePlayer() {
  const mediaEl = ref<HTMLMediaElement | null>(null)
  const currentTime = ref(0)
  // Верхняя граница воспроизведения: доиграв до неё, ставим на паузу.
  const playBound = ref<number | null>(null)

  // Скорость воспроизведения. Замедление помогает расслышать артефакты речи.
  // preservesPitch держим включённым, чтобы тон не «плыл» при 0.25–0.5×.
  const SPEEDS = [0.25, 0.5, 0.75, 1]
  const speed = ref(1)
  function applySpeed() {
    const el = mediaEl.value
    if (!el) return
    el.playbackRate = speed.value
    // @ts-ignore — вендорные варианты для старых браузеров
    el.preservesPitch = el.mozPreservesPitch = el.webkitPreservesPitch = true
  }
  watch([speed, mediaEl], applySpeed)

  function onTimeUpdate() {
    const el = mediaEl.value
    currentTime.value = el?.currentTime ?? 0
    // Дошли до конца выделенного фрагмента — останавливаемся.
    if (playBound.value != null && el && el.currentTime >= playBound.value) {
      el.pause()
      playBound.value = null
    }
  }

  function seek(t?: number) {
    if (t == null || !mediaEl.value) return
    playBound.value = null // ручная перемотка снимает ограничение выделением
    stopBoundWatch()
    mediaEl.value.currentTime = t
    mediaEl.value.play()
  }

  // Слежение за верхней границей через requestAnimationFrame (~60 Гц). Событие
  // timeupdate тикает лишь ~4 раза в секунду и проскакивает конец слова на ~250мс
  // (заезжает в следующее) — rAF даёт точность ~16мс.
  let boundRaf: number | null = null
  function stopBoundWatch() {
    if (boundRaf != null) {
      cancelAnimationFrame(boundRaf)
      boundRaf = null
    }
  }
  function boundTick() {
    const el = mediaEl.value
    if (playBound.value == null || !el || el.paused || el.ended) {
      boundRaf = null
      return
    }
    if (el.currentTime >= playBound.value) {
      el.pause()
      playBound.value = null
      boundRaf = null
      return
    }
    boundRaf = requestAnimationFrame(boundTick)
  }
  function startBoundWatch() {
    stopBoundWatch()
    boundRaf = requestAnimationFrame(boundTick)
  }

  // Проиграть только диапазон [start, end] и остановиться на конце.
  function playRange(start?: number, end?: number) {
    const el = mediaEl.value
    if (!el || start == null || end == null || end <= start) return
    el.currentTime = start
    playBound.value = end
    el.play()
    startBoundWatch()
  }

  // Возобновление воспроизведения (в т.ч. нативной кнопкой) — если ограничение
  // ещё активно, поднимаем точный watch заново.
  function onMediaPlay() {
    if (playBound.value != null) startBoundWatch()
  }

  function playMedia() {
    playBound.value = null // обычное воспроизведение — без ограничения выделением
    stopBoundWatch()
    mediaEl.value?.play()
  }
  function pauseMedia() {
    mediaEl.value?.pause()
  }

  onBeforeUnmount(stopBoundWatch)

  return {
    mediaEl,
    currentTime,
    speed,
    SPEEDS,
    seek,
    playRange,
    playMedia,
    pauseMedia,
    onTimeUpdate,
    onMediaPlay
  }
}
