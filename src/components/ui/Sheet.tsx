import { AnimatePresence, motion, useDragControls, useIsPresent } from 'framer-motion'
import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'

interface Props {
  open: boolean
  onClose: () => void
  title?: string
  children: React.ReactNode
  /** Full-height sheet (for editors) vs. compact drawer. */
  tall?: boolean
  /**
   * Default: the whole body scrolls. Set false when the child manages its own scroll region, e.g. a
   * list that scrolls under a footer that must stay fixed and never have content peek out below it.
   */
  scroll?: boolean
}

/** Open sheets, innermost last: Escape closes only the top one, and body scroll unlocks when the last closes. */
const stack: object[] = []

/**
 * iOS-style bottom sheet. It closes only with the X button, Escape, or by pulling the top bar
 * (handle + title) down: scrolling the content or tapping the dimmed backdrop never closes it.
 */
export function Sheet({ open, onClose, title, children, tall, scroll = true }: Props) {
  // Callers pass inline closures; keep the latest in a ref so re-renders don't re-order the stack.
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    if (!open) return
    const me = {}
    stack.push(me)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && stack[stack.length - 1] === me && close.current()
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      stack.splice(stack.indexOf(me), 1)
      if (!stack.length) document.body.style.overflow = ''
    }
  }, [open])

  return (
    <AnimatePresence>
      {open && <SheetBody onClose={onClose} title={title} tall={tall} scroll={scroll}>{children}</SheetBody>}
    </AnimatePresence>
  )
}

function SheetBody({ onClose, title, tall, scroll, children }: Omit<Props, 'open'>) {
  // While the sheet is animating out it must not intercept taps meant for the page underneath.
  const isPresent = useIsPresent()
  const pe = isPresent ? undefined : ('none' as const)
  // Dragging starts only from the top bar, so a scroll gesture in the content can't pull the sheet away.
  const drag = useDragControls()
  return (
    <>
      <motion.div
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]"
        style={{ pointerEvents: pe }}
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      />
      <motion.div
        className="fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-[430px]"
        style={{ pointerEvents: pe }}
        initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 300 }}
        drag="y" dragListener={false} dragControls={drag} dragConstraints={{ top: 0 }} dragElastic={0.15}
        onDragEnd={(_, info) => { if (info.offset.y > 90 || info.velocity.y > 600) onClose() }}
      >
        <div
          className="glass glass-strong rounded-b-none flex flex-col"
          style={{ maxHeight: tall ? '92dvh' : '80dvh', paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          <div className="flex items-center justify-between px-4 pt-3 pb-2 shrink-0 touch-none cursor-grab" onPointerDown={(e) => drag.start(e)}>
            <div className="mx-auto absolute left-1/2 -translate-x-1/2 top-2 h-1.5 w-10 rounded-full bg-line" />
            <h3 className="font-semibold text-[17px] leading-snug mt-2 min-w-0 pr-3 line-clamp-2">{title}</h3>
            <button onClick={onClose} onPointerDown={(e) => e.stopPropagation()} className="mt-2 p-1.5 rounded-full press shrink-0" style={{ background: 'var(--line)' }} aria-label="Close">
              <X size={16} />
            </button>
          </div>
          {scroll
            ? <div className="overflow-y-auto overscroll-contain px-4 pb-6 grow min-h-0">{children}</div>
            : <div className="flex flex-col px-4 pb-4 grow min-h-0">{children}</div>}
        </div>
      </motion.div>
    </>
  )
}
