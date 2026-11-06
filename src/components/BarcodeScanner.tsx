import { useEffect, useRef, useState } from 'react'
import { Check, ScanBarcode } from 'lucide-react'

export interface ScanResult { ok: boolean; message: string }

/**
 * Live camera barcode scanner (EAN-13/8, UPC-A/E). Scans continuously so several products can be
 * added in a row; each code is handed to `onCode`, whose message is shown under the camera.
 * The decoder (@zxing) is loaded only when the scanner opens. A typed barcode works without a camera.
 */
export function BarcodeScanner({ onCode, onDone }: { onCode: (code: string) => Promise<ScanResult>; onDone: () => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const [status, setStatus] = useState<{ text: string; tone: 'info' | 'ok' | 'error' }>({ text: 'Starting camera…', tone: 'info' })
  const [manual, setManual] = useState('')
  const [count, setCount] = useState(0)
  const busy = useRef(false)
  const last = useRef<{ code: string; at: number } | null>(null)
  const onCodeRef = useRef(onCode)
  onCodeRef.current = onCode

  const handle = async (raw: string) => {
    const code = raw.replace(/\D/g, '')
    if (!code || busy.current) return
    // The camera reads the same code many times a second: ignore repeats for a few seconds.
    if (last.current && last.current.code === code && Date.now() - last.current.at < 3000) return
    last.current = { code, at: Date.now() }
    busy.current = true
    setStatus({ text: `Looking up ${code}…`, tone: 'info' })
    try {
      const r = await onCodeRef.current(code)
      if (r.ok) { setCount((n) => n + 1); navigator.vibrate?.(60) }
      setStatus({ text: r.message, tone: r.ok ? 'ok' : 'error' })
    } catch (e) {
      setStatus({ text: e instanceof Error ? e.message : 'Lookup failed', tone: 'error' })
    } finally {
      busy.current = false
    }
  }

  useEffect(() => {
    let stop: (() => void) | null = null
    let cancelled = false
    void (async () => {
      if (!navigator.mediaDevices?.getUserMedia) { setStatus({ text: 'No camera access in this browser. Type the barcode below.', tone: 'error' }); return }
      try {
        const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([import('@zxing/browser'), import('@zxing/library')])
        const hints = new Map([[DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E]]])
        const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 150 })
        if (cancelled || !video.current) return
        const controls = await reader.decodeFromConstraints(
          { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } },
          video.current,
          (result) => { if (result) void handle(result.getText()) },
        )
        if (cancelled) { controls.stop(); return }
        stop = () => controls.stop()
        setStatus({ text: 'Point the camera at a barcode', tone: 'info' })
      } catch (e) {
        const name = e instanceof Error ? e.name : ''
        setStatus({
          text: name === 'NotAllowedError' ? 'Camera permission was denied. Allow it in your browser settings, or type the barcode below.'
            : name === 'NotFoundError' ? 'No camera found. Type the barcode below.'
              : `Camera could not start (${e instanceof Error ? e.message : e}). Type the barcode below.`,
          tone: 'error',
        })
      }
    })()
    return () => { cancelled = true; stop?.() }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const color = status.tone === 'ok' ? '#22c55e' : status.tone === 'error' ? '#ef4444' : 'var(--text-2)'
  return (
    <div className="flex flex-col gap-3">
      {/* Square view with a square aiming guide in the middle, so a barcode is easy to line up. */}
      <div className="relative w-full aspect-square rounded-2xl overflow-hidden bg-black">
        <video ref={video} className="w-full h-full object-cover" playsInline muted autoPlay />
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[70%] aspect-square rounded-2xl pointer-events-none" style={{ border: '2px solid rgba(255,255,255,0.9)', boxShadow: '0 0 0 9999px rgba(0,0,0,0.35)' }} />
      </div>
      <div className="text-sm font-medium text-center min-h-[1.25rem]" style={{ color }} role="status">{status.text}</div>
      <div className="flex gap-2">
        <input className="field" inputMode="numeric" placeholder="Or type the barcode" value={manual} onChange={(e) => setManual(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && manual.trim()) { last.current = null; void handle(manual); setManual('') } }} aria-label="Barcode number" />
        <button className="btn" onClick={() => { last.current = null; void handle(manual); setManual('') }} disabled={!manual.trim()}><ScanBarcode size={16} /> Look up</button>
      </div>
      <button className="btn btn-primary py-3" onClick={onDone}><Check size={18} /> Done{count ? ` · ${count} added` : ''}</button>
    </div>
  )
}
