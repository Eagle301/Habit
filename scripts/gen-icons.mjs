// Generates PWA icons (PNG) without any native deps: a rounded gradient tile with a check mark.
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'

const crcTable = new Int32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c
})
const crc32 = (buf) => {
  let c = -1
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

function png(size, draw) {
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = draw(x, y)
      const o = y * (size * 4 + 1) + 1 + x * 4
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ])
}

const lerp = (a, b, t) => a + (b - a) * t
const mix = (c1, c2, t) => c1.map((v, i) => Math.round(lerp(v, c2[i], t)))

function tile(size, opaque) {
  const r = size * 0.22
  return (x, y) => {
    // rounded-rect mask
    const dx = Math.max(r - x, x - (size - 1 - r), 0)
    const dy = Math.max(r - y, y - (size - 1 - r), 0)
    const inside = dx * dx + dy * dy <= r * r
    if (!inside && !opaque) return [0, 0, 0, 0]
    const t = (x + y) / (2 * size)
    let [R, G, B] = mix([99, 102, 241], [168, 85, 247], t)
    // check mark: two thick line segments
    const p = [x / size, y / size]
    const seg = (ax, ay, bx, by) => {
      const vx = bx - ax, vy = by - ay
      const tt = Math.max(0, Math.min(1, ((p[0] - ax) * vx + (p[1] - ay) * vy) / (vx * vx + vy * vy)))
      const cx = ax + vx * tt, cy = ay + vy * tt
      return Math.hypot(p[0] - cx, p[1] - cy)
    }
    const d = Math.min(seg(0.3, 0.52, 0.45, 0.67), seg(0.45, 0.67, 0.72, 0.36))
    const w = 0.065
    if (d < w) {
      const aa = Math.min(1, (w - d) / (1.5 / size))
      R = Math.round(lerp(R, 255, aa)); G = Math.round(lerp(G, 255, aa)); B = Math.round(lerp(B, 255, aa))
    }
    return [R, G, B, 255]
  }
}

mkdirSync('public/icons', { recursive: true })
writeFileSync('public/icons/icon-192.png', png(192, tile(192, false)))
writeFileSync('public/icons/icon-512.png', png(512, tile(512, true)))
writeFileSync('public/icons/apple-touch-icon.png', png(180, tile(180, true)))
writeFileSync(
  'public/icons/favicon.svg',
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6366f1"/><stop offset="1" stop-color="#a855f7"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#g)"/><path d="M19 33l9 9 17-19" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
)
console.log('icons written to public/icons')
