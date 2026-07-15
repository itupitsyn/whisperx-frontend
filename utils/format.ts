import { classMeta } from '~/utils/speechClasses'

// Цвет класса разметки (для точек/подчёркиваний). Неизвестный класс — серый.
export function classColor(cls: string) {
  return classMeta(cls)?.color ?? '#888'
}

// Подпись класса для панели разметки: «Группа: подпись» (кроме «Общее»).
export function classLabel(cls: string) {
  const m = classMeta(cls)
  if (!m) return cls
  return m.group === 'Общее' ? m.label : `${m.group}: ${m.label}`
}

// Тайминг в mm:ss.
export function fmt(t?: number) {
  if (t == null) return ''
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}
