import { useMemo, useState } from 'react'
import { CalendarPlus, Plus, Trash2 } from 'lucide-react'
import { useStore } from '../store/useStore'
import type { Difficulty, GoalStep, Project } from '../lib/types'
import { format, fromKey } from '../lib/dates'
import { uid } from '../lib/id'
import {
  DIFFICULTY, PROJECT_COLORS, PROJECT_ICON, SESSION_MIN,
  daysUntil, dueLabel, fmtHours, goalPct, projectBlocks, projectProgress, sessionsLeft, sortProjects,
} from '../lib/projects'
import { Card, CheckCircle, Empty, Header, Segment } from '../components/ui/Bits'
import { Sheet } from '../components/ui/Sheet'

const dueColor = (due: string | null) => { const d = daysUntil(due); return d === null ? 'var(--text-3)' : d < 0 ? '#ef4444' : d <= 3 ? '#f59e0b' : 'var(--text-3)' }

/** Time to book on the calendar: none, or one of the effort levels. */
type Effort = 'none' | Difficulty
const EFFORTS: { value: Effort; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'easy', label: `${DIFFICULTY.easy.hours} h` },
  { value: 'medium', label: `${DIFFICULTY.medium.hours} h` },
  { value: 'hard', label: `${DIFFICULTY.hard.hours} h` },
]
const effortOf = (p: Project | null): Effort => (!p ? 'none' : p.hours_est > 0 ? p.difficulty : 'none')

export function Goals() {
  const projects = useStore((s) => s.projects)
  const [editing, setEditing] = useState<Project | 'new' | null>(null)
  const [session, setSession] = useState(0)
  const openEditor = (p: Project | 'new') => { setSession((n) => n + 1); setEditing(p) }

  const sorted = useMemo(() => sortProjects(projects), [projects])
  const open = sorted.filter((p) => !p.done)
  const finished = sorted.filter((p) => p.done)

  return (
    <div>
      <Header subtitle="What you are working towards" title="Goals" right={
        <button className="btn btn-sm btn-primary" onClick={() => openEditor('new')}><Plus size={16} /> Goal</button>
      } />
      <div className="flex flex-col gap-3">
        {sorted.length === 0 && <Empty icon={PROJECT_ICON} title="No goals yet" hint="A goal can have a due date, steps to tick off, and hours to book on your calendar." />}
        {open.map((p) => <GoalCard key={p.id} goal={p} onOpen={() => openEditor(p)} />)}
        {finished.length > 0 && (
          <>
            <div className="text-3 text-xs font-semibold uppercase tracking-wide px-1 mt-2">Done</div>
            {finished.map((p) => <GoalCard key={p.id} goal={p} onOpen={() => openEditor(p)} />)}
          </>
        )}
      </div>

      <Sheet open={!!editing} onClose={() => setEditing(null)} title={editing === 'new' ? 'New goal' : 'Goal'} tall>
        {editing && <GoalEditor key={`${session}-${editing === 'new' ? 'new' : editing.id}`} goal={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      </Sheet>
    </div>
  )
}

function GoalCard({ goal: p, onOpen }: { goal: Project; onOpen: () => void }) {
  const blocks = useStore((s) => s.blocks)
  const pct = goalPct(p, blocks)
  const pr = projectProgress(p, blocks)
  const stepsDone = p.steps.filter((s) => s.done).length
  const left = sessionsLeft(p, pr)
  const bits = [
    p.steps.length ? `${stepsDone}/${p.steps.length} steps` : null,
    p.hours_est > 0 ? `${fmtHours(pr.doneH)} of ${fmtHours(p.hours_est)}` : null,
    p.hours_est > 0 && !p.done && left > 0 ? `${left} session${left === 1 ? '' : 's'} to plan` : null,
  ].filter(Boolean)
  return (
    <Card onClick={onOpen} className={p.done ? 'opacity-60' : ''} style={{ borderLeft: `4px solid ${p.color}` }}>
      <div className="flex items-start gap-3">
        <div className="grow min-w-0">
          <div className={`font-semibold text-[16px] truncate ${p.done ? 'line-through' : ''}`}>{p.title}</div>
          <div className="text-xs mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
            <span style={{ color: dueColor(p.due_date) }}>{p.done ? 'Achieved' : dueLabel(p.due_date)}{p.due_date ? ` · ${format(fromKey(p.due_date), 'MMM d')}` : ''}</span>
            {bits.length > 0 && <span className="text-3">{bits.join(' · ')}</span>}
          </div>
        </div>
        <div className="text-sm font-bold shrink-0" style={{ color: pct >= 1 ? '#22c55e' : 'var(--text-2)' }}>{Math.round(pct * 100)}%</div>
      </div>
      <div className="h-1.5 rounded-full bg-line mt-3 overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct * 100}%`, background: p.color }} />
      </div>
    </Card>
  )
}

function GoalEditor({ goal, onClose }: { goal: Project | null; onClose: () => void }) {
  const { addProject, updateProject, deleteProject, toggleBlockDone, deleteBlock, showToast, setTab } = useStore()
  const blocks = useStore((s) => s.blocks)
  const projectCount = useStore((s) => s.projects.length)
  // Steps of an existing goal save immediately; a new goal keeps them here until it is added.
  const liveSteps = useStore((s) => (goal ? s.projects.find((p) => p.id === goal.id)?.steps : undefined))
  const [draftSteps, setDraftSteps] = useState<GoalStep[]>([])
  const steps = goal ? liveSteps ?? [] : draftSteps
  const setSteps = (next: GoalStep[]) => (goal ? updateProject(goal.id, { steps: next }) : setDraftSteps(next))

  const [title, setTitle] = useState(goal?.title ?? '')
  const [due, setDue] = useState(goal?.due_date ?? '')
  const [effort, setEffort] = useState<Effort>(effortOf(goal))
  const [step, setStep] = useState('')

  const sessions = goal ? projectBlocks(blocks, goal.id).sort((a, b) => a.date.localeCompare(b.date) || a.start_time.localeCompare(b.start_time)) : []
  const pr = goal ? projectProgress(goal, blocks) : null

  const addStep = () => {
    const t = step.trim()
    if (!t) return
    setSteps([...steps, { id: uid(), title: t, done: false }])
    setStep('')
  }

  const save = () => {
    const t = title.trim()
    if (!t) return
    const hours = effort === 'none' ? 0 : DIFFICULTY[effort].hours
    const difficulty: Difficulty = effort === 'none' ? goal?.difficulty ?? 'medium' : effort
    if (goal) updateProject(goal.id, { title: t, due_date: due || null, difficulty, hours_est: hours })
    else addProject({ title: t, course: '', due_date: due || null, difficulty, hours_est: hours, session_min: SESSION_MIN, color: PROJECT_COLORS[projectCount % PROJECT_COLORS.length], done: false, notes: '', steps: draftSteps })
    showToast(goal ? 'Goal updated' : hours ? `Goal added · ${hours} one-hour sessions to plan` : 'Goal added')
    onClose()
  }

  return (
    <div className="flex flex-col gap-4 pt-1">
      <div className="flex gap-3 items-center">
        <div className="text-3xl w-14 h-14 rounded-2xl flex items-center justify-center shrink-0" style={{ background: `${goal?.color ?? PROJECT_COLORS[projectCount % PROJECT_COLORS.length]}33` }}>{PROJECT_ICON}</div>
        <input className="field font-semibold" placeholder="e.g. Run a 10k, Finish the essay" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>

      <label className="flex items-center gap-2 text-sm text-2">
        <span className="w-20 shrink-0">Due date</span>
        <input className="field grow" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
      </label>

      <div>
        <div className="text-3 text-xs font-semibold uppercase tracking-wide mb-2">Steps</div>
        <div className="flex flex-col gap-1.5">
          {steps.map((s) => (
            <div key={s.id} className="flex items-center gap-2">
              <button onClick={() => setSteps(steps.map((x) => (x.id === s.id ? { ...x, done: !x.done } : x)))} aria-label="Toggle step"><CheckCircle checked={s.done} size={24} /></button>
              <span className={`grow text-sm ${s.done ? 'line-through text-3' : ''}`}>{s.title}</span>
              <button onClick={() => setSteps(steps.filter((x) => x.id !== s.id))} className="text-3 p-1" aria-label="Delete step"><Trash2 size={15} /></button>
            </div>
          ))}
        </div>
        <div className="flex gap-2 mt-2">
          <input className="field" placeholder="Add a step (optional)" value={step} onChange={(e) => setStep(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addStep()} enterKeyHint="done" />
          <button className="btn" onClick={addStep} disabled={!step.trim()} aria-label="Add step"><Plus size={16} /></button>
        </div>
      </div>

      <div>
        <div className="text-3 text-xs font-semibold uppercase tracking-wide mb-1.5">Time to book on the calendar</div>
        <Segment<Effort> value={effort} options={EFFORTS} onChange={setEffort} />
        <p className="text-3 text-[11px] mt-1.5">{effort === 'none' ? 'Nothing to schedule: just steps and a date.' : `${DIFFICULTY[effort].hours} one-hour sessions you plan from the Calendar tab.`}</p>
      </div>

      {goal && pr && goal.hours_est > 0 && (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-3 text-xs font-semibold uppercase tracking-wide">Sessions</span>
            <span className="text-3 text-xs">{fmtHours(pr.doneH)} done · {fmtHours(pr.remainingH)} to plan</span>
          </div>
          {sessions.length === 0 ? (
            <div className="text-3 text-sm">None planned yet.</div>
          ) : (
            <div className="flex flex-col">
              {sessions.map((b) => (
                <div key={b.id} className="flex items-center gap-2 py-1.5 border-b hairline last:border-b-0">
                  <button onClick={() => toggleBlockDone(b.id)} aria-label="Toggle done"><CheckCircle checked={!!b.done} color={goal.color} size={24} /></button>
                  <span className={`grow text-sm ${b.done ? 'line-through text-3' : ''}`}>{format(fromKey(b.date), 'EEE, MMM d')} · {b.start_time}{b.google_event_id ? ' · 📅' : ''}</span>
                  <button onClick={() => deleteBlock(b.id)} className="text-3 p-1" aria-label="Remove session"><Trash2 size={15} /></button>
                </div>
              ))}
            </div>
          )}
          {pr.remainingH > 0 && !goal.done && (
            <button className="btn btn-sm w-full mt-2" onClick={() => { onClose(); setTab('calendar') }}><CalendarPlus size={14} /> Plan the remaining {sessionsLeft(goal, pr)} session{sessionsLeft(goal, pr) === 1 ? '' : 's'}</button>
          )}
        </div>
      )}

      <div className="flex gap-2 mt-1">
        {goal && (
          <button className={`btn ${goal.done ? '' : 'btn-primary'}`} onClick={() => { updateProject(goal.id, { done: !goal.done }); showToast(goal.done ? 'Goal reopened' : 'Goal achieved 🎉'); onClose() }}>
            {goal.done ? 'Reopen' : 'Mark achieved'}
          </button>
        )}
        <button className="btn btn-primary grow" onClick={save} disabled={!title.trim()}>{goal ? 'Save changes' : 'Add goal'}</button>
      </div>
      {goal && (
        <button className="btn btn-danger" onClick={() => { if (confirm(`Delete "${goal.title}"${sessions.length ? ` and its ${sessions.length} session${sessions.length === 1 ? '' : 's'}` : ''}?`)) { deleteProject(goal.id); onClose() } }}>
          <Trash2 size={16} /> Delete goal
        </button>
      )}
    </div>
  )
}
