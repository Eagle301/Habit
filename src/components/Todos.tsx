import { useMemo, useState } from 'react'
import { CalendarClock, Plus, Trash2 } from 'lucide-react'
import { useStore } from '../store/useStore'
import type { Task } from '../lib/types'
import { TASK_COLOR, TASK_DURATIONS, sortTasks, taskBlock, taskDueLabel } from '../lib/tasks'
import { format, fromKey, todayKey } from '../lib/dates'
import { Card, CheckCircle, Segment, SectionTitle } from './ui/Bits'
import { Sheet } from './ui/Sheet'

const durLabel = (m: number) => (m >= 60 ? `${m / 60} h` : `${m} min`)

/** One-time to-dos on the Today page: quick add, tick off, tap to edit. */
export function Todos() {
  const tasks = useStore((s) => s.tasks)
  const blocks = useStore((s) => s.blocks)
  const { addTask, toggleTask, setTab } = useStore()
  const [text, setText] = useState('')
  const [editing, setEditing] = useState<Task | null>(null)
  const todayK = todayKey()

  // Open tasks, plus the ones ticked off today so a mis-tap is easy to undo.
  const shown = useMemo(
    () => sortTasks(tasks.filter((t) => !t.done || (t.done_at && format(new Date(t.done_at), 'yyyy-MM-dd') === todayK))),
    [tasks, todayK],
  )
  const open = shown.filter((t) => !t.done).length

  const add = () => {
    const title = text.trim()
    if (!title) return
    addTask(title)
    setText('')
  }

  return (
    <>
      <SectionTitle right={open > 0 ? <span className="text-3 text-[11px]">{open} open</span> : undefined}>To-do</SectionTitle>
      <Card className="p-2">
        <form className="flex gap-2 p-1" onSubmit={(e) => { e.preventDefault(); add() }}>
          <input className="field py-2" placeholder="Add a one-time task…" value={text} onChange={(e) => setText(e.target.value)} enterKeyHint="done" />
          <button type="submit" className="btn btn-sm shrink-0" disabled={!text.trim()} aria-label="Add task"><Plus size={16} /></button>
        </form>
        {shown.length === 0 && <div className="text-3 text-sm px-2 py-2">Nothing to do. Add anything you need to get done once.</div>}
        {shown.map((t) => {
          const due = taskDueLabel(t.due_date)
          const overdue = !t.done && !!t.due_date && t.due_date < todayK
          const b = taskBlock(blocks, t.id)
          return (
            <div key={t.id} className="flex items-center gap-3 px-2 py-2 rounded-xl">
              <button onClick={() => toggleTask(t.id)} aria-label={t.done ? 'Mark not done' : 'Mark done'}>
                <CheckCircle checked={t.done} color={TASK_COLOR} size={24} />
              </button>
              <button className="grow min-w-0 text-left" onClick={() => setEditing(t)}>
                <div className={`font-medium truncate ${t.done ? 'line-through text-3' : ''}`}>{t.title}</div>
                {(due || b) && !t.done && (
                  <div className="text-3 text-xs flex gap-2">
                    {due && <span style={{ color: overdue ? '#ef4444' : undefined }}>{due === 'Overdue' || due === 'Today' || due === 'Tomorrow' ? due : `Due ${due}`}</span>}
                    {b && <span className="inline-flex items-center gap-1"><CalendarClock size={12} /> {format(fromKey(b.date), b.date === todayK ? "'Today'" : 'EEE')} {b.start_time}</span>}
                  </div>
                )}
              </button>
            </div>
          )
        })}
        {open > 0 && (
          <button className="btn btn-sm btn-ghost text-3 w-full mt-1" onClick={() => setTab('planner')}><CalendarClock size={14} /> Plan to-dos in the Planner</button>
        )}
      </Card>

      <Sheet open={!!editing} onClose={() => setEditing(null)} title="To-do">
        {editing && <TaskEditor key={editing.id} task={editing} onDone={() => setEditing(null)} />}
      </Sheet>
    </>
  )
}

function TaskEditor({ task, onDone }: { task: Task; onDone: () => void }) {
  const blocks = useStore((s) => s.blocks)
  const { updateTask, deleteTask, deleteBlock } = useStore()
  const [title, setTitle] = useState(task.title)
  const [due, setDue] = useState(task.due_date ?? '')
  const [dur, setDur] = useState(String(task.duration_min))
  const b = taskBlock(blocks, task.id)

  const save = () => {
    const t = title.trim()
    if (!t) return
    updateTask(task.id, { title: t, due_date: due || null, duration_min: Number(dur) })
    onDone()
  }

  return (
    <div className="flex flex-col gap-3">
      <input className="field" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Task" />
      <label className="flex flex-col gap-1">
        <span className="text-2 text-sm">Due date (optional)</span>
        <div className="flex gap-2">
          <input type="date" className="field" value={due} onChange={(e) => setDue(e.target.value)} />
          {due && <button className="btn btn-sm shrink-0" onClick={() => setDue('')}>Clear</button>}
        </div>
      </label>
      <div className="flex flex-col gap-1">
        <span className="text-2 text-sm">Time needed in the Planner</span>
        <Segment value={dur} options={TASK_DURATIONS.map((m) => ({ value: String(m), label: durLabel(m) }))} onChange={setDur} />
      </div>
      {b && (
        <div className="flex items-center gap-2 text-sm rounded-xl px-3 py-2 bg-line">
          <CalendarClock size={16} className="shrink-0" />
          <span className="grow">Planned {format(fromKey(b.date), 'EEE, MMM d')} at {b.start_time}</span>
          <button className="btn btn-sm" onClick={() => deleteBlock(b.id)}>Unplan</button>
        </div>
      )}
      <div className="flex gap-2 mt-1">
        <button className="btn btn-danger" onClick={() => { deleteTask(task.id); onDone() }} aria-label="Delete task"><Trash2 size={16} /></button>
        <button className="btn btn-primary grow" onClick={save} disabled={!title.trim()}>Save</button>
      </div>
    </div>
  )
}
