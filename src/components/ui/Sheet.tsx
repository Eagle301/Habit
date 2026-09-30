import { AnimatePresence, motion, useIsPresent } from 'framer-motion'
import { useEffect } from 'react'
import { X } from 'lucide-react'

interface Props {
  open: boolean
  onClose: () => void
  title?: string
  children: React.ReactNode
  /** Full-height sheet (for editors) vs. compact drawer. */
  tall?: boolean
}

/** iOS-style bottom sheet with drag-to-dismiss. */
export function Sheet({ open, onClose, title, children, tall }: Props) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = '' }
  }, [open, onClose])

  return (
    <AnimatePresence>
      {open && <SheetBody onClose={onClose} title={title} tall={tall}>{children}</SheetBody>}
    </AnimatePresence>
  )
}

function SheetBody({ onClose, title, tall, children }: Omit<Props, 'open'>) {
  // While the sheet is animating out it must not intercept taps meant for the page underneath.
  const isPresent = useIsPresent()
  const pe = isPresent ? undefined : ('none' as const)
  return (
    <>
      <motion.div
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]"
        style={{ pointerEvents: pe }}
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
      />
      <motion.div
        className="fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-[430px]"
        style={{ pointerEvents: pe }}
        initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 300 }}
        drag="y" dragConstraints={{ top: 0 }} dragElastic={0.15}
        onDragEnd={(_, info) => { if (info.offset.y > 90 || info.velocity.y > 600) onClose() }}
      >
        <div
          className="glass glass-strong rounded-b-none flex flex-col"
          style={{ maxHeight: tall ? '92dvh' : '80dvh', paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          <div className="flex items-center justify-between px-4 pt-3 pb-2 shrink-0">
            <div className="mx-auto absolute left-1/2 -translate-x-1/2 top-2 h-1.5 w-10 rounded-full bg-line" />
            <h3 className="font-semibold text-[17px] mt-2">{title}</h3>
            <button onClick={onClose} className="mt-2 p-1.5 rounded-full press" style={{ background: 'var(--line)' }} aria-label="Close">
              <X size={16} />
            </button>
          </div>
          <div className="overflow-y-auto overscroll-contain px-4 pb-6 grow min-h-0">{children}</div>
        </div>
      </motion.div>
    </>
  )
}
