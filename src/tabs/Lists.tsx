import { useMemo, useState } from 'react'
import { DndContext, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { CalendarDays, GripVertical, Link2, Plus, Trash2 } from 'lucide-react'
import { useStore, useActiveHabits, type ListsMode } from '../store/useStore'
import type { Goal, ListItem } from '../lib/types'
import { format } from '../lib/dates'
import { Card, CheckCircle, Empty, Header, Segment } from '../components/ui/Bits'
import { Sheet } from '../components/ui/Sheet'
import { Meals } from './Meals'

export function Lists() {
  const mode = useStore((s) => s.listsMode)
  const setMode = useStore((s) => s.setListsMode)
  return (
    <div>
      <Header subtitle="Goals, lists & meals" title="Lists" />
      <Segment<ListsMode> value={mode} options={[{ value: 'goals', label: '🎯 Goals' }, { value: 'lists', label: '📝 Lists' }, { value: 'meals', label: '🍲 Meals' }]} onChange={setMode} />
      <div className="mt-4">{mode === 'goals' ? <Goals /> : mode === 'lists' ? <GeneralLists /> : <Meals />}</div>
    </div>
  )
}

/* ------------------------------ GOALS ------------------------------ */

function Goals() {
  const goals = useStore((s) => s.goals)
  const tasks = useStore((s) => s.goalTasks)
  const { addGoal } = useStore()
  const [title, setTitle] = useState('')
  const [date, setDate] = useState('')
  const [open, setOpen] = useState<Goal | null>(null)

  const submit = () => {
    if (!title.trim()) return
    addGoal(title.trim(), date || null)
    setTitle(''); setDate('')
  }

  const sorted = [...goals].sort((a, b) => Number(a.done) - Number(b.done) || (a.target_date ?? '9999').localeCompare(b.target_date ?? '9999'))

  return (
    <div className="flex flex-col gap-3">
      <Card>
        <div className="flex gap-2">
          <input className="field" placeholder="New goal, e.g. Run a marathon" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
          <button className="btn btn-primary" onClick={submit} disabled={!title.trim()}><Plus size={18} /></button>
        </div>
        <label className="flex items-center gap-2 mt-2 text-sm text-2">
          <CalendarDays size={16} /> Target date (optional)
          <input className="field grow" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
      </Card>

      {sorted.length === 0 && <Empty icon="🎯" title="No goals yet" hint="Add a long-term goal with or without a target date." />}
      {sorted.map((g) => {
        const gt = tasks.filter((t) => t.goal_id === g.id)
        const done = gt.filter((t) => t.done).length
        const pct = gt.length ? done / gt.length : g.done ? 1 : 0
        return (
          <Card key={g.id} onClick={() => setOpen(g)} className={g.done ? 'opacity-60' : ''}>
            <div className="flex items-start gap-3">
              <div className="grow min-w-0">
                <div className={`font-semibold text-[16px] ${g.done ? 'line-through' : ''}`}>{g.title}</div>
                <div className="text-3 text-xs mt-0.5 flex gap-3">
                  <span>{g.target_date ? `Target ${format(new Date(g.target_date + 'T00:00:00'), 'MMM yyyy')}` : 'No date'}</span>
                  {gt.length > 0 && <span>{done}/{gt.length} tasks</span>}
                  {g.linked_habit_ids.length > 0 && <span className="inline-flex items-center gap-1"><Link2 size={12} />{g.linked_habit_ids.length} habit{g.linked_habit_ids.length > 1 ? 's' : ''}</span>}
                </div>
              </div>
              <div className="text-sm font-bold" style={{ color: pct >= 1 ? '#22c55e' : 'var(--text-2)' }}>{Math.round(pct * 100)}%</div>
            </div>
            <div className="h-1.5 rounded-full bg-line mt-3 overflow-hidden">
              <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct * 100}%`, background: 'linear-gradient(90deg,#6366f1,#a855f7)' }} />
            </div>
          </Card>
        )
      })}

      <Sheet open={!!open} onClose={() => setOpen(null)} title="Goal" tall>
        {open && <GoalDetail id={open.id} onClose={() => setOpen(null)} />}
      </Sheet>
    </div>
  )
}

function GoalDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const goal = useStore((s) => s.goals.find((g) => g.id === id))
  const allTasks = useStore((s) => s.goalTasks)
  const tasks = useMemo(() => allTasks.filter((t) => t.goal_id === id), [allTasks, id])
  const habits = useActiveHabits()
  const { updateGoal, deleteGoal, addGoalTask, toggleGoalTask, deleteGoalTask } = useStore()
  const [task, setTask] = useState('')
  if (!goal) return null

  const toggleLink = (hid: string) => {
    const set = new Set(goal.linked_habit_ids)
    if (set.has(hid)) set.delete(hid); else set.add(hid)
    updateGoal(goal.id, { linked_habit_ids: [...set] })
  }

  return (
    <div className="flex flex-col gap-4">
      <input className="field font-semibold text-[17px]" value={goal.title} onChange={(e) => updateGoal(goal.id, { title: e.target.value })} />
      <div className="flex items-center gap-3">
        <label className="text-sm text-2 grow flex items-center gap-2">Target
          <input className="field" type="date" value={goal.target_date ?? ''} onChange={(e) => updateGoal(goal.id, { target_date: e.target.value || null })} />
        </label>
        <button className={`btn btn-sm ${goal.done ? 'btn-primary' : ''}`} onClick={() => updateGoal(goal.id, { done: !goal.done })}>{goal.done ? 'Achieved ✓' : 'Mark achieved'}</button>
      </div>

      <div>
        <div className="text-3 text-xs font-semibold uppercase tracking-wide mb-2">Action steps</div>
        <div className="flex flex-col gap-1.5">
          {tasks.map((t) => (
            <div key={t.id} className="flex items-center gap-2">
              <button onClick={() => toggleGoalTask(t.id)}><CheckCircle checked={t.done} size={24} /></button>
              <span className={`grow text-sm ${t.done ? 'line-through text-3' : ''}`}>{t.title}</span>
              <button onClick={() => deleteGoalTask(t.id)} className="text-3 p-1" aria-label="Delete task"><Trash2 size={15} /></button>
            </div>
          ))}
        </div>
        <div className="flex gap-2 mt-2">
          <input className="field" placeholder="Add a sub-task" value={task} onChange={(e) => setTask(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && task.trim()) { addGoalTask(goal.id, task.trim()); setTask('') } }} />
          <button className="btn" onClick={() => { if (task.trim()) { addGoalTask(goal.id, task.trim()); setTask('') } }}><Plus size={16} /></button>
        </div>
      </div>

      <div>
        <div className="text-3 text-xs font-semibold uppercase tracking-wide mb-2">Linked habits</div>
        {habits.length === 0 ? <div className="text-3 text-sm">Create habits in Settings to link them.</div> : (
          <div className="flex flex-wrap gap-2">
            {habits.map((h) => {
              const on = goal.linked_habit_ids.includes(h.id)
              return (
                <button key={h.id} onClick={() => toggleLink(h.id)} className="px-3 py-1.5 rounded-full text-sm font-medium press" style={{ background: on ? h.color : 'var(--line)', color: on ? 'white' : 'var(--text)' }}>
                  {h.icon} {h.name}
                </button>
              )
            })}
          </div>
        )}
      </div>

      <button className="btn btn-danger mt-2" onClick={() => { if (confirm('Delete this goal?')) { deleteGoal(goal.id); onClose() } }}><Trash2 size={16} /> Delete goal</button>
    </div>
  )
}

/* ------------------------------ GENERAL LISTS ------------------------------ */

function GeneralLists() {
  const lists = useStore((s) => s.lists)
  const items = useStore((s) => s.listItems)
  const { addList, renameList, deleteList, addListItem, toggleListItem, deleteListItem, reorderListItems, clearCompleted } = useStore()
  const [activeId, setActiveId] = useState<string | null>(lists[0]?.id ?? null)
  const [text, setText] = useState('')
  const active = lists.find((l) => l.id === activeId) ?? lists[0] ?? null

  const listItems = useMemo(
    () => items.filter((i) => i.list_id === active?.id).sort((a, b) => a.sort_order - b.sort_order),
    [items, active?.id],
  )
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
  )

  const newList = () => {
    const name = prompt('List name', 'Groceries')
    if (name?.trim()) setActiveId(addList(name.trim()))
  }

  const onDragEnd = (e: DragEndEvent) => {
    const { active: a, over } = e
    if (!over || a.id === over.id || !active) return
    const ids = listItems.map((i) => i.id)
    const next = arrayMove(ids, ids.indexOf(String(a.id)), ids.indexOf(String(over.id)))
    reorderListItems(active.id, next)
  }

  const add = () => {
    if (!active || !text.trim()) return
    addListItem(active.id, text.trim()); setText('')
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4 pb-1">
        {lists.map((l) => (
          <button key={l.id} onClick={() => setActiveId(l.id)} className="btn btn-sm shrink-0" style={active?.id === l.id ? { background: 'linear-gradient(135deg,#6366f1,#a855f7)', color: 'white', border: 'none' } : {}}>
            {l.name} <span className="opacity-70">{items.filter((i) => i.list_id === l.id && !i.done).length}</span>
          </button>
        ))}
        <button className="btn btn-sm shrink-0" onClick={newList}><Plus size={14} /> List</button>
      </div>

      {!active ? (
        <Empty icon="📝" title="No lists yet" hint="Create a list for to-dos, groceries, shopping…" />
      ) : (
        <Card>
          <div className="flex items-center gap-2 mb-3">
            <input className="font-semibold text-[17px] bg-transparent outline-none grow min-w-0" value={active.name} onChange={(e) => renameList(active.id, e.target.value)} />
            <button className="btn btn-sm" onClick={() => clearCompleted(active.id)} disabled={!listItems.some((i) => i.done)}>Clear done</button>
            <button className="btn btn-sm btn-danger" onClick={() => { if (confirm(`Delete list "${active.name}"?`)) { deleteList(active.id); setActiveId(null) } }} aria-label="Delete list"><Trash2 size={14} /></button>
          </div>
          <div className="flex gap-2 mb-3">
            <input className="field" placeholder="Add item" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} enterKeyHint="done" />
            <button className="btn btn-primary" onClick={add} disabled={!text.trim()}><Plus size={18} /></button>
          </div>
          {listItems.length === 0 && <div className="text-3 text-sm py-2">Nothing here yet.</div>}
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={listItems.map((i) => i.id)} strategy={verticalListSortingStrategy}>
              <div className="flex flex-col">
                {listItems.map((i) => <SortableItem key={i.id} item={i} onToggle={() => toggleListItem(i.id)} onDelete={() => deleteListItem(i.id)} />)}
              </div>
            </SortableContext>
          </DndContext>
        </Card>
      )}
    </div>
  )
}

function SortableItem({ item, onToggle, onDelete }: { item: ListItem; onToggle: () => void; onDelete: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id })
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 }} className="flex items-center gap-2 py-2 border-b hairline last:border-b-0">
      <button onClick={onToggle}><CheckCircle checked={item.done} size={26} /></button>
      <span className={`grow text-[15px] ${item.done ? 'line-through text-3' : ''}`}>{item.text}</span>
      <button onClick={onDelete} className="text-3 p-1" aria-label="Delete"><Trash2 size={15} /></button>
      <button {...attributes} {...listeners} className="text-3 p-1 touch-none cursor-grab" aria-label="Reorder"><GripVertical size={16} /></button>
    </div>
  )
}
