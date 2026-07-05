import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs'
import { join } from 'node:path'

// Хранилище разметки: один JSON-файл на исходный файл, имя = его контент-хеш.
// Почему не SQLite: прод-рантайм — Bun (bun:sqlite), а dev-сервер Nitro крутится
// под Node 20 (нет node:sqlite), better-sqlite3 конфликтует с alpine + ignore-scripts.
// Файловый стор работает одинаково в обоих рантаймах, персистентен на volume и
// достаточен для нашего масштаба (короткие клипы, низкая частота записи).
function baseDir(): string {
  return process.env.ANNOTATIONS_DIR || 'data/annotations'
}

// Хеш приходит извне — пускаем только hex, чтобы исключить обход путей.
export function isValidHash(hash: unknown): hash is string {
  return typeof hash === 'string' && /^[a-f0-9]{16,128}$/i.test(hash)
}

function fileFor(hash: string): string {
  return join(baseDir(), `${hash.toLowerCase()}.json`)
}

export interface AnnoRow {
  start: number
  end: number
  text: string
  class: string
  source: string
}

// Структура транскрипта: слова с таймингами и финальным (уже отредактированным)
// текстом. Источник истины при повторном открытии — рендерим из неё, WhisperX
// не гоняем, так что тайминги и разметка остаются точно теми же.
export interface SavedWord {
  text: string
  start: number | null
  end: number | null
}
export interface SavedSegment {
  speaker: string | null
  start: number | null
  words: SavedWord[]
}

export interface Markup {
  annotations: AnnoRow[]
  transcript: string // плоский текст — для чтения/выгрузки
  segments: SavedSegment[] // структура — для надёжного восстановления
  filename?: string | null
  jobId?: string | null
}

interface FileRecord extends Markup {
  fileHash: string
  updatedAt: string
}

// Сохранение = полная замена разметки и транскрипта файла (атомарно: пишем во
// временный файл и переименовываем), как работает кнопка «Сохранить».
export function saveMarkup(fileHash: string, m: Markup): number {
  mkdirSync(baseDir(), { recursive: true })
  const record: FileRecord = {
    fileHash,
    filename: m.filename ?? null,
    jobId: m.jobId ?? null,
    updatedAt: new Date().toISOString(),
    annotations: m.annotations,
    transcript: m.transcript,
    segments: m.segments
  }
  const target = fileFor(fileHash)
  const tmp = `${target}.tmp`
  writeFileSync(tmp, JSON.stringify(record))
  renameSync(tmp, target)
  return m.annotations.length
}

export function loadFileMarkup(
  fileHash: string
): { annotations: AnnoRow[]; transcript: string; segments: SavedSegment[] } {
  const empty = { annotations: [], transcript: '', segments: [] }
  const f = fileFor(fileHash)
  if (!existsSync(f)) return empty
  try {
    const record = JSON.parse(readFileSync(f, 'utf8')) as FileRecord
    return {
      annotations: Array.isArray(record.annotations) ? record.annotations : [],
      transcript: typeof record.transcript === 'string' ? record.transcript : '',
      segments: Array.isArray(record.segments) ? record.segments : []
    }
  } catch {
    return empty
  }
}
