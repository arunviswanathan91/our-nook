export function safeMusicUrl(value: string): string | null {
  try {
    const url = new URL(value)
    const domains = ['open.spotify.com','music.apple.com','youtube.com','www.youtube.com','music.youtube.com','youtu.be','soundcloud.com','www.soundcloud.com','bandcamp.com']
    return url.href.length <= 2048 && url.protocol === 'https:' && !url.username && !url.password && (domains.includes(url.hostname) || url.hostname.endsWith('.bandcamp.com')) ? url.href : null
  } catch { return null }
}

export function imageType(bytes: Uint8Array): { mime: string; extension: string } | null {
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return { mime: 'image/jpeg', extension: 'jpg' }
  if (bytes.length >= 8 && [137,80,78,71,13,10,26,10].every((b,i) => bytes[i] === b)) return { mime: 'image/png', extension: 'png' }
  if (bytes.length >= 12 && new TextDecoder().decode(bytes.slice(0,4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8,12)) === 'WEBP') return { mime: 'image/webp', extension: 'webp' }
  return null
}
