import { supabase } from './supabase'
import { uid } from './id'

/** Supabase Storage bucket for recipe photos (created by migration 0010). */
export const PHOTO_BUCKET = 'recipe-photos'

/** Load any browser-readable image file (camera JPEG, PNG, HEIC converted by Safari…). */
const loadImage = (file: File) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image')) }
    img.src = url
  })

/** Downscale so the longest side is at most `max` px and re-encode as JPEG. */
async function shrink(file: File, max: number): Promise<HTMLCanvasElement> {
  const img = await loadImage(file)
  const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(img.naturalWidth * scale)
  canvas.height = Math.round(img.naturalHeight * scale)
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
  return canvas
}

const toBlob = (c: HTMLCanvasElement, quality: number) =>
  new Promise<Blob>((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode photo'))), 'image/jpeg', quality))

/** Small inline copy for local-only mode (kept in localStorage, so it must stay small). */
const toDataUrl = async (file: File) => (await shrink(file, 720)).toDataURL('image/jpeg', 0.72)

/**
 * Turn a photo into an image URL for a recipe. Signed in: uploaded to Supabase Storage under the
 * user's own folder. Local-only (or when the upload fails): an inline data URL, plus a warning.
 */
export async function savePhoto(file: File): Promise<{ url: string; warning?: string }> {
  const user = supabase ? (await supabase.auth.getUser()).data.user : null
  if (!supabase || !user) return { url: await toDataUrl(file) }
  try {
    const blob = await toBlob(await shrink(file, 1280), 0.82)
    const path = `${user.id}/${uid()}.jpg`
    const { error } = await supabase.storage.from(PHOTO_BUCKET).upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000' })
    if (error) throw error
    return { url: supabase.storage.from(PHOTO_BUCKET).getPublicUrl(path).data.publicUrl }
  } catch (e) {
    console.error('[photos] upload failed', e)
    const msg = e instanceof Error ? e.message : String(e)
    return {
      url: await toDataUrl(file),
      warning: /bucket not found/i.test(msg)
        ? 'Photo saved on the recipe only: run supabase/migrations/0010_recipe_photos.sql to enable photo uploads'
        : `Photo upload failed (${msg}), saved a smaller copy on the recipe instead`,
    }
  }
}

/** Delete an uploaded photo from Storage. Ignores Krónan images and inline data URLs. */
export function removePhoto(url: string | null | undefined) {
  if (!supabase || !url) return
  const marker = `/storage/v1/object/public/${PHOTO_BUCKET}/`
  const i = url.indexOf(marker)
  if (i < 0) return
  void supabase.storage.from(PHOTO_BUCKET).remove([decodeURIComponent(url.slice(i + marker.length))])
    .then(({ error }) => { if (error) console.warn('[photos] remove failed', error) })
}
