import { supabase } from './supabase.js'

export const LOGO_BUCKET = 'school-logos'
const TYPES = ['image/png', 'image/jpeg', 'image/webp']
const MAX_INPUT_BYTES = 8 * 1024 * 1024
const MAX_SIDE = 256

/** Public URL of a stored logo, or null. */
export function logoUrl(path) {
  if (!path) return null
  return supabase.storage.from(LOGO_BUCKET).getPublicUrl(path).data.publicUrl
}

/** Shrink the chosen image to at most 256 px on its longest side and return it as a small PNG. */
export async function prepareLogo(file) {
  if (!TYPES.includes(file.type)) throw new Error('Choose a PNG, JPG or WebP image.')
  if (file.size > MAX_INPUT_BYTES) throw new Error('That image is larger than 8 MB. Choose a smaller one.')
  let bitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error('That image could not be read. Try a different file.')
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('That image could not be processed. Try a different file.')
  return blob
}

/** Upload a new logo, point the school at it, then delete the previous file. */
export async function saveLogo(school, file) {
  const blob = await prepareLogo(file)
  const path = `${school.id}/logo-${Date.now()}.png`
  const up = await supabase.storage.from(LOGO_BUCKET).upload(path, blob, { contentType: 'image/png', cacheControl: '3600', upsert: false })
  if (up.error) throw up.error
  const upd = await supabase.from('schools').update({ logo_path: path }).eq('id', school.id)
  if (upd.error) {
    await supabase.storage.from(LOGO_BUCKET).remove([path])
    throw upd.error
  }
  if (school.logo_path) await supabase.storage.from(LOGO_BUCKET).remove([school.logo_path])
}

export async function removeLogo(school) {
  const upd = await supabase.from('schools').update({ logo_path: null }).eq('id', school.id)
  if (upd.error) throw upd.error
  if (school.logo_path) await supabase.storage.from(LOGO_BUCKET).remove([school.logo_path])
}
