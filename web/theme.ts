import type { CircleTheme, CircleThemePattern } from './circle-client'
import { assertTagline } from './text-rules'

export const THEME_MAX_EMBLEM_BYTES = 12 * 1024
export const THEME_EMBLEM_SIZE = 128
export const THEME_PATTERNS: CircleThemePattern[] = ['None', 'Dots', 'Grid', 'Waves', 'Rays']

export type ThemeFormPrefix = 'new-circle' | 'design'

function input<T extends HTMLInputElement | HTMLSelectElement>(prefix: ThemeFormPrefix, field: string): T {
  return document.querySelector(`#${prefix}-${field}`) as T
}

function rawBytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  return btoa(binary)
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality))
}

function loadImage(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') return createImageBitmap(file)
  return new Promise((resolve, reject) => {
    const image = new Image()
    const url = URL.createObjectURL(file)
    image.onload = () => { URL.revokeObjectURL(url); resolve(image) }
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('The emblem image could not be decoded.')) }
    image.src = url
  })
}

/** Resize an uploaded raster image to a square contract-safe emblem payload. */
export async function encodeThemeEmblem(file: File): Promise<{ base64: string; mime: 'image/webp' | 'image/png'; bytes: number }> {
  if (file.type === 'image/svg+xml' || /\.svg$/i.test(file.name)) throw new Error('SVG emblems are not allowed.')
  if (!['image/png', 'image/webp', 'image/jpeg', 'image/gif'].includes(file.type)) {
    throw new Error('Choose a PNG, WebP, JPEG, or GIF emblem.')
  }

  const image = await loadImage(file)
  const canvas = document.createElement('canvas')
  canvas.width = THEME_EMBLEM_SIZE
  canvas.height = THEME_EMBLEM_SIZE
  const context = canvas.getContext('2d')
  if (!context) throw new Error('This browser cannot prepare an emblem.')
  context.clearRect(0, 0, THEME_EMBLEM_SIZE, THEME_EMBLEM_SIZE)
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  const sourceWidth = 'width' in image ? image.width : 0
  const sourceHeight = 'height' in image ? image.height : 0
  if (!sourceWidth || !sourceHeight) throw new Error('The emblem image has no usable dimensions.')
  const scale = Math.min(THEME_EMBLEM_SIZE / sourceWidth, THEME_EMBLEM_SIZE / sourceHeight)
  const width = Math.max(1, Math.round(sourceWidth * scale))
  const height = Math.max(1, Math.round(sourceHeight * scale))
  context.drawImage(image, Math.round((THEME_EMBLEM_SIZE - width) / 2), Math.round((THEME_EMBLEM_SIZE - height) / 2), width, height)
  if ('close' in image) image.close()

  for (const quality of [0.88, 0.75, 0.62, 0.5, 0.35, 0.2]) {
    const blob = await canvasBlob(canvas, 'image/webp', quality)
    if (blob && blob.type === 'image/webp' && blob.size <= THEME_MAX_EMBLEM_BYTES) {
      return { base64: rawBytesToBase64(new Uint8Array(await blob.arrayBuffer())), mime: 'image/webp', bytes: blob.size }
    }
  }

  const png = await canvasBlob(canvas, 'image/png')
  if (png && png.size <= THEME_MAX_EMBLEM_BYTES) {
    return { base64: rawBytesToBase64(new Uint8Array(await png.arrayBuffer())), mime: 'image/png', bytes: png.size }
  }
  throw new Error('The resized emblem is still larger than 12 KiB. Choose a simpler image.')
}

export function readThemeForm(prefix: ThemeFormPrefix): CircleTheme {
  const emblemInput = input<HTMLInputElement>(prefix, 'emblem')
  const tagline = input<HTMLInputElement>(prefix, 'tagline').value.trim()
  const colors = ['background', 'accent', 'text'].map((field) => input<HTMLInputElement>(prefix, field).value)
  assertTagline(tagline)
  if (colors.some((color) => !/^#[0-9A-Fa-f]{6}$/.test(color))) throw new Error('Colours must use #RRGGBB.')
  const pattern = input<HTMLSelectElement>(prefix, 'pattern').value as CircleThemePattern
  if (!THEME_PATTERNS.includes(pattern)) throw new Error('Choose a supported passport pattern.')
  return {
    tagline: tagline || null,
    background: colors[0],
    accent: colors[1],
    text: colors[2],
    pattern,
    emblem: emblemInput.dataset.emblem ?? null,
  }
}

export function renderThemePreview(prefix: ThemeFormPrefix, target: HTMLElement, title: string): void {
  const theme = readThemeForm(prefix)
  target.replaceChildren()
  target.style.background = theme.background ?? '#1D3557'
  target.style.color = theme.text ?? '#FFFFFF'
  target.style.borderColor = theme.accent ?? '#A8DADC'
  const heading = document.createElement('strong')
  heading.textContent = title
  const tagline = document.createElement('span')
  tagline.textContent = theme.tagline || 'Circle of members'
  const pattern = document.createElement('small')
  pattern.textContent = `${theme.pattern ?? 'Dots'} pattern · ${theme.accent ?? '#A8DADC'} accent`
  target.append(heading, tagline, pattern)
  if (theme.emblem) {
    const image = document.createElement('img')
    image.alt = 'Uploaded emblem preview'
    image.width = THEME_EMBLEM_SIZE
    image.height = THEME_EMBLEM_SIZE
    image.src = `data:${input<HTMLInputElement>(prefix, 'emblem').dataset.mime ?? 'image/png'};base64,${theme.emblem}`
    target.prepend(image)
  }
}

export function bindThemeForm(prefix: ThemeFormPrefix, title: () => string, onError: (error: unknown) => void): void {
  const emblemInput = input<HTMLInputElement>(prefix, 'emblem')
  const preview = document.querySelector(`#${prefix}-preview`) as HTMLElement
  const update = () => renderThemePreview(prefix, preview, title())
  for (const field of ['tagline', 'background', 'accent', 'text', 'pattern']) {
    input<HTMLInputElement | HTMLSelectElement>(prefix, field).addEventListener('input', update)
    input<HTMLInputElement | HTMLSelectElement>(prefix, field).addEventListener('change', update)
  }
  emblemInput.addEventListener('change', () => {
    const file = emblemInput.files?.[0]
    if (!file) {
      delete emblemInput.dataset.emblem
      delete emblemInput.dataset.mime
      delete emblemInput.dataset.bytes
      update()
      return
    }
    void encodeThemeEmblem(file).then((encoded) => {
      emblemInput.dataset.emblem = encoded.base64
      emblemInput.dataset.mime = encoded.mime
      emblemInput.dataset.bytes = String(encoded.bytes)
      update()
    }).catch((error) => {
      emblemInput.value = ''
      delete emblemInput.dataset.emblem
      delete emblemInput.dataset.mime
      delete emblemInput.dataset.bytes
      onError(error)
    })
  })
  update()
}
