import { useMemo, useState } from 'react'
import { CalendarPlus, Plus, Trash2 } from 'lucide-react'
import { useStore } from '../store/useStore'
import type { Difficulty, Project } from '../lib/types'
import { format, fromKey } from '../lib/dates'
import {
  DIFFICULTY, DIFFICULTIES, PROJECT_COLORS, PROJECT_ICON, SESSION_MIN,
  daysUntil, dueLabel, fmtHours, projectBlocks, projectProgress, sessionsLeft, sortProjects,
} from '../lib/projects'
import { Card, CheckCircle, Empty, Segment } from '../components/ui/Bits'
import { Sheet } from '../components/ui/Sheet'

const dueColor = (due: string | null) => { const d = daysUntil(due); return d === null ? 'var(--text-3)' : d < 0 ? '#ef4444' : d <= 3 ? '#f59e0b' : 'var(--text-3)' }

export function Projects() {
  const projects = useStore((s) => s.projects)
  const blocks = useStore((s) => s.blocks)
  const setTab = useStore((s) => s.setTab)
  const [editing, setEditing] = useState<Project | 'new' | null>(null)
  const [session, setSession] = useState(0)
  const openEditor = (p: Project | 'new') => { setSession((n) => n + 1); setEditing(p) }

  const sorted = useMemo(() => sortProjects(projects), [projects])
  const open = sorted.filter((p) => !p.done)
  const finished = sorted.filter((p) => p.done)
  const totals = open.reduce((a, p) => { const pr = projectProgress(p, blocks); return { remaining: a.remaining + pr.remainingH, scheduled: a.scheduled + pr.scheduledH } }, { remaining: 0, scheduled: 0 })

  return (
    <div className="flex flex-col gap-3">
      <Card>
        <div className="flex items-center gap-3">
          <div className="text-3xl w-12 h-12 rounded-2xl flex items-center justify-center shrink-0" style={{ background: 'rgba(14,165,233,0.18)' }}>{PROJECT_ICON}</div>
          <div className="grow min-w-0">
            <div className="font-semibold">{open.length ? `${open.length} open project${open.length === 1 ? '' : 's'}` : 'School projects'}</div>
            <div className="text-3 text-xs">
              {open.length
                ? `${fmtHours(totals.remaining)} still to plan · ${fmtHours(totals.scheduled)} scheduled`
                : 'Name, due date, difficulty. The hours become one-hour study sessions in the Planner.'}
            </div>
          </div>
          <button className="btn btn-primary btn-sm shrink-0" onClick={() => openEditor('new')}><Plus size={14} /> Project</button>
        </div>
        {totals.remaining > 0 && (
          <button className="btn btn-sm w-full mt-3" onClick={() => setTab('planner')}><CalendarPlus size={14} /> Plan {fmtHours(totals.remaining)} of sessions in the Planner</button>
        )}
      </Card>

      {sorted.length === 0 && <Empty icon="🎓" title="No projects yet" hint="Easy = 2 h, medium = 4 h, hard = 6 h of study, in one-hour sessions." />}
      {open.map((p) => <ProjectCard key={p.id} project={p} onOpen={() => openEditor(p)} />)}
      {finished.length > 0 && (
        <>
          <div className="text-3 text-xs font-semibold uppercase tracking-wide px-1 mt-2">Done</div>
          {finished.map((p) => <ProjectCard key={p.id} project={p} onOpen={() => openEditor(p)} />)}
        </>
      )}

      <Sheet open={!!editing} onClose={() => setEditing(null)} title={editing === 'new' ? 'New project' : 'Project'} tall>
        {editing && <ProjectEditor key={`${session}-${editing === 'new' ? 'new' : editing.id}`} project={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      </Sheet>
    </div>
  )
}

function ProjectCard({ project: p, onOpen }: { project: Project; onOpen: () => void }) {
  const blocks = useStore((s) => s.blocks)
  const pr = projectProgress(p, blocks)
  const left = sessionsLeft(p, pr)
  return (
    <Card onClick={onOpen} className={p.done ? 'opacity-60' : ''} style={{ borderLeft: `4px solid ${p.color}` }}>
      <div className="flex items-start gap-3">
        <div className="grow min-w-0">
          <div className={`font-semibold text-[16px] truncate ${p.done ? 'line-through' : ''}`}>{p.title}</div>
          <div className="text-xs mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
            <span style={{ color: dueColor(p.due_date) }}>{p.done ? 'Completed' : dueLabel(p.due_date)}{p.due_date ? ` · ${format(fromKey(p.due_date), 'MMM d')}` : ''}</span>
            <span className="text-3">{DIFFICULTY[p.difficulty].label} · {fmtHours(p.hours_est)}</span>
          </div>
        </div>
        <div className="text-sm font-bold shrink-0" style={{ color: pr.pct >= 1 ? '#22c55e' : 'var(--text-2)' }}>{Math.round(pr.pct * 100)}%</div>
      </div>
      <div className="h-1.5 rounded-full bg-line mt-3 overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pr.pct * 100}%`, background: p.color }} />
      </div>
      {!p.done && (
        <div className="text-3 text-[11px] mt-1.5">
          {fmtHours(pr.doneH)} done · {fmtHours(pr.scheduledH - pr.doneH)} scheduled · {left > 0 ? `${left} session${left === 1 ? '' : 's'} to plan` : 'all sessions planned ✓'}
        </div>
      )}
    </Card>
  )
}

function ProjectEditor({ project, onClose }: { project: Project | null; onClose: () => void }) {
  const { addProject, updateProject, deleteProject, toggleBlockDone, deleteBlock, showToast, setTab } = useStore()
  const blocks = useStore((s) => s.blocks)
  const projectCount = useStore((s) => s.projects.length)
  const [title, setTitle] = useState(project?.title ?? '')
  const [due, setDue] = useState(project?.due_date ?? '')
  const [difficulty, setDifficulty] = useState<Difficulty>(project?.difficulty ?? 'medium')

  const sessions = project ? projectBlocks(blocks, project.id).sort((a, b) => a.date.localeCompare(b.date) || a.start_time.localeCompare(b.start_time)) : []
  const pr = project ? projectProgress(project, blocks) : null

  const save = () => {
    const t = title.trim()
    if (!t) return
    const hours = DIFFICULTY[difficulty].hours
    if (project) updateProject(project.id, { title: t, due_date: due || null, difficulty, hours_est: hours })
    else addProject({ title: t, course: '', due_date: due || null, difficulty, hours_est: hours, session_min: SESSION_MIN, color: PROJECT_COLORS[projectCount % PROJECT_COLORS.length], done: false, notes: '' })
    showToast(project ? 'Project updated' : `Project added · ${hours} one-hour sessions to plan`)
    onClose()
  }

  return (
    <div className="flex flex-col gap-4 pt-1">
      <div className="flex gap-3 items-center">
        <div className="text-3xl w-14 h-14 rounded-2xl flex items-center justify-center shrink-0" style={{ background: `${project?.color ?? PROJECT_COLORS[0]}33` }}>{PROJECT_ICON}</div>
        <input className="field font-semibold" placeholder="Project name" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>

      <label className="flex items-center gap-2 text-sm text-2">
        <span className="w-20 shrink-0">Due date</span>
        <input className="field grow" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
      </label>

      <div>
        <div className="text-3 text-xs font-semibold uppercase tracking-wide mb-1.5">Difficulty</div>
        <Segment<Difficulty> value={difficulty} options={DIFFICULTIES.map((d) => ({ value: d, label: `${DIFFICULTY[d].label} · ${DIFFICULTY[d].hours} h` }))} onChange={setDifficulty} />
        <p className="text-3 text-[11px] mt-1.5">{DIFFICULTY[difficulty].hours} one-hour study sessions, ready to drag into the Planner.</p>
      </div>

      {project && pr && (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-3 text-xs font-semibold uppercase tracking-wide">Study sessions</span>
            <span className="text-3 text-xs">{fmtHours(pr.doneH)} done · {fmtHours(pr.remainingH)} to plan</span>
          </div>
          {sessions.length === 0 ? (
            <div className="text-3 text-sm">None planned yet.</div>
          ) : (
            <div className="flex flex-col">
              {sessions.map((b) => (
                <div key={b.id} className="flex items-center gap-2 py-1.5 border-b hairline last:border-b-0">
                  <button onClick={() => toggleBlockDone(b.id)} aria-label="Toggle done"><CheckCircle checked={!!b.done} color={project.color} size={24} /></button>
                  <span className={`grow text-sm ${b.done ? 'line-through text-3' : ''}`}>{format(fromKey(b.date), 'EEE, MMM d')} · {b.start_time}{b.google_event_id ? ' · 📅' : ''}</span>
                  <button onClick={() => deleteBlock(b.id)} className="text-3 p-1" aria-label="Remove session"><Trash2 size={15} /></button>
                </div>
              ))}
            </div>
          )}
          {pr.remainingH > 0 && !project.done && (
            <button className="btn btn-sm w-full mt-2" onClick={() => { onClose(); setTab('planner') }}><CalendarPlus size={14} /> Plan the remaining {sessionsLeft(project, pr)} session{sessionsLeft(project, pr) === 1 ? '' : 's'}</button>
          )}
        </div>
      )}

      <div className="flex gap-2 mt-1">
        {project && (
          <button className={`btn ${project.done ? '' : 'btn-primary'}`} onClick={() => { updateProject(project.id, { done: !project.done }); showToast(project.done ? 'Project reopened' : 'Project completed 🎉'); onClose() }}>
            {project.done ? 'Reopen' : 'Mark done'}
          </button>
        )}
        <button className="btn btn-primary grow" onClick={save} disabled={!title.trim()}>{project ? 'Save changes' : 'Add project'}</button>
      </div>
      {project && (
        <button className="btn btn-danger" onClick={() => { if (confirm(`Delete "${project.title}" and its ${sessions.length} session${sessions.length === 1 ? '' : 's'}?`)) { deleteProject(project.id); onClose() } }}>
          <Trash2 size={16} /> Delete project
        </button>
      )}
    </div>
  )
}
