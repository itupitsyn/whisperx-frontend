import { loadFileMarkup, isValidHash } from '../../utils/annotationsDb'

// GET /db/annotations?fileHash=... — вернуть разметку и правки текста файла.
export default defineEventHandler((event) => {
  const fileHash = getQuery(event).fileHash

  if (!isValidHash(fileHash)) {
    throw createError({ statusCode: 400, statusMessage: 'Некорректный fileHash' })
  }

  return loadFileMarkup(fileHash)
})
