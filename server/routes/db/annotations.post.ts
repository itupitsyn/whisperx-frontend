import {
  saveMarkup,
  isValidHash,
  type AnnoRow,
  type SavedSegment
} from '../../utils/annotationsDb'

// POST /db/annotations — сохранить разметку и транскрипт файла.
// Живёт на /db/**, а не /api/**, потому что /api/** проксируется на WhisperX.
export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const fileHash = body?.fileHash

  if (!isValidHash(fileHash)) {
    throw createError({ statusCode: 400, statusMessage: 'Некорректный fileHash' })
  }

  const rows: AnnoRow[] = (Array.isArray(body?.annotations) ? body.annotations : [])
    .map((a: any) => ({
      start: Number(a?.start),
      end: Number(a?.end),
      text: String(a?.text ?? ''),
      class: String(a?.class ?? a?.cls ?? ''),
      source: a?.source === 'audio' ? 'audio' : 'text'
    }))
    .filter(
      (a: AnnoRow) =>
        Number.isFinite(a.start) && Number.isFinite(a.end) && a.class.length > 0
    )

  const num = (v: any): number | null => (Number.isFinite(Number(v)) ? Number(v) : null)
  const segments: SavedSegment[] = (Array.isArray(body?.segments) ? body.segments : [])
    .map((s: any) => ({
      speaker: s?.speaker != null ? String(s.speaker) : null,
      start: num(s?.start),
      words: (Array.isArray(s?.words) ? s.words : []).map((w: any) => ({
        text: String(w?.text ?? ''),
        start: num(w?.start),
        end: num(w?.end)
      }))
    }))

  const transcript = String(body?.transcript ?? '')

  const count = saveMarkup(fileHash, {
    annotations: rows,
    transcript,
    segments,
    filename: body?.filename ?? null,
    jobId: body?.jobId ?? null
  })

  return { ok: true, count }
})
