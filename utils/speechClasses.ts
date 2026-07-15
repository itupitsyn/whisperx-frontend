// Классы речевых нарушений для разметки.
// Значение enum (напр. stutter_clonic) уходит на бэкенд как поле "class".
// label — короткая подпись, group — раздел в меню, description — инструкция.
export enum SpeechClass {
  // Общее
  Repetition = 'repetition',
  Prolongation = 'prolongation',
  Block = 'block',
  Filler = 'filler',
  // Заикание
  StutterClonic = 'stutter_clonic',
  StutterTonic = 'stutter_tonic',
  // Шепелявость (сигматизм)
  LispInterdental = 'lisp_interdental',
  LispLateral = 'lisp_lateral',
  LispNasal = 'lisp_nasal',
  LispLabiodental = 'lisp_labiodental',
  // Дислексия
  Dyslexia = 'dyslexia',
  // Голос (спастическая дисфония)
  VoiceSpasm = 'voice_spasm',
  LarynxMicrospasm = 'larynx_microspasm'
}

export interface SpeechClassMeta {
  id: SpeechClass
  label: string
  group: string
  color: string
  description?: string
}

export const SPEECH_CLASSES: SpeechClassMeta[] = [
  // --- Общее ---
  { id: SpeechClass.Repetition, group: 'Общее', label: 'Повторы', color: '#ff8a5c' },
  { id: SpeechClass.Prolongation, group: 'Общее', label: 'Протяжки', color: '#ffd166' },
  { id: SpeechClass.Block, group: 'Общее', label: 'Паузы / блоки', color: '#c77dff' },
  { id: SpeechClass.Filler, group: 'Общее', label: 'Слова-паразиты', color: '#8b90a0' },

  // --- Заикание ---
  {
    id: SpeechClass.StutterClonic,
    group: 'Заикание',
    label: 'Клоническое',
    color: '#ff6b6b',
    description:
      'Быстрые ритмические повторения слогов или звуков. Напр.: «П-п-п-привет», «Ма-ма-ма-машина».'
  },
  {
    id: SpeechClass.StutterTonic,
    group: 'Заикание',
    label: 'Тоническое',
    color: '#ff4d94',
    description:
      'Длительное напряжённое застревание на звуке или пауза между словами; может сопровождаться напряжением в дыхании и мышцах шеи и лица. Напр.: «Ммммм…ама», длинная тяжёлая пауза перед словом.'
  },

  // --- Шепелявость (сигматизм) ---
  {
    id: SpeechClass.LispInterdental,
    group: 'Шепелявость',
    label: 'Межзубной (С, Ш)',
    color: '#4dd4ac',
    description:
      'Вместо чёткого С и Ш получается плоский, шумный звук, похожий на английское th.'
  },
  {
    id: SpeechClass.LispLateral,
    group: 'Шепелявость',
    label: 'Боковой (Л)',
    color: '#4db8d4',
    description: 'Хлюпающий, чавкающий звук, с призвуком буквы «Л».'
  },
  {
    id: SpeechClass.LispNasal,
    group: 'Шепелявость',
    label: 'Носовой',
    color: '#6c8cff',
    description: 'Вместо «С» слышится что-то вроде «Хн», голос гнусавый.'
  },
  {
    id: SpeechClass.LispLabiodental,
    group: 'Шепелявость',
    label: 'Губно-зубной (Ф)',
    color: '#a06cff',
    description:
      'Звук похож на Ф: «санки → фанки», «шапка → фапка».'
  },

  // --- Дислексия ---
  {
    id: SpeechClass.Dyslexia,
    group: 'Дислексия',
    label: 'Замены / перестановки',
    color: '#e0b040',
    description:
      'Путает слова или буквы в слове, меняет буквы на другие. Напр.: «молоко → момоко», перестановка букв/слогов.'
  },

  // --- Голос (спастическая дисфония) ---
  {
    id: SpeechClass.VoiceSpasm,
    group: 'Голос',
    label: 'Голосовой спазм',
    color: '#ff5c7a',
    description:
      'Спастическая дисфония: вставки звуков из-за нарушения координации дыхания и голоса — голос прерывистый, «зажатый», будто связки хлюпают.'
  },
  {
    id: SpeechClass.LarynxMicrospasm,
    group: 'Голос',
    label: 'Микросудороги гортани',
    color: '#b56cff',
    description:
      'Мелкие судорожные подёргивания гортани: короткие сбои и дрожание голоса без полного блока.'
  }
]

// Аудио-эффекты — размечаются прямо на дорожке (то, чего нет в тексте).
export enum AudioEffect {
  Breath = 'breath',
  Click = 'click',
  Spasm = 'spasm'
}

export const AUDIO_EFFECTS: SpeechClassMeta[] = [
  {
    id: AudioEffect.Breath as unknown as SpeechClass,
    group: 'Аудио',
    label: 'Вдох / дыхание',
    color: '#4dd4ac',
    description: 'Слышимый вдох или шумное дыхание.'
  },
  {
    id: AudioEffect.Click as unknown as SpeechClass,
    group: 'Аудио',
    label: 'Щелчок',
    color: '#ffd166',
    description: 'Щелчок, причмокивание, посторонний призвук.'
  },
  {
    id: AudioEffect.Spasm as unknown as SpeechClass,
    group: 'Аудио',
    label: 'Спазм',
    color: '#ff5c8a',
    description:
      'Спазм/зажим, не попавший в распознанный текст (напр. в начале записи).'
  }
]

export interface SpeechGroup {
  group: string
  items: SpeechClassMeta[]
}

// Сгруппированный список для меню (порядок групп — как встретились).
export const SPEECH_GROUPS: SpeechGroup[] = SPEECH_CLASSES.reduce(
  (acc, c) => {
    let g = acc.find((x) => x.group === c.group)
    if (!g) {
      g = { group: c.group, items: [] }
      acc.push(g)
    }
    g.items.push(c)
    return acc
  },
  [] as SpeechGroup[]
)

// Объединённый список для меню: речевые классы + аудио-эффекты одним набором.
// Используется и при разметке текста, и при разметке аудиодорожки — выбор
// нарушения в обоих местах идёт из общего списка.
export const ALL_GROUPS: SpeechGroup[] = [
  ...SPEECH_GROUPS,
  { group: 'Аудио', items: AUDIO_EFFECTS }
]

// Единый поиск меты по любому классу (текстовому или аудио).
export function classMeta(id: string): SpeechClassMeta | undefined {
  return (
    SPEECH_CLASSES.find((c) => c.id === id) ??
    AUDIO_EFFECTS.find((c) => c.id === id)
  )
}
