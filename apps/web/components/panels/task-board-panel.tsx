'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useXClawStore, type Task, type Agent } from '@/store'

type CommentItem = {
  id: number
  author: string
  content: string
  created_at: number
  mentions?: string[]
  replies?: CommentItem[]
}

type MentionOption = {
  handle: string
  recipient: string
  type: 'user' | 'agent'
  display: string
}

const columns: Array<{ key: Task['status']; label: string }> = [
  { key: 'inbox', label: 'Inbox' },
  { key: 'assigned', label: 'Assigned' },
  { key: 'awaiting_owner', label: 'Awaiting Owner' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'review', label: 'Review' },
  { key: 'quality_review', label: 'Quality Review' },
  { key: 'done', label: 'Done' },
]

export function TaskBoardPanel() {
  const { tasks, setTasks, agents, setAgents } = useXClawStore()
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [comments, setComments] = useState<CommentItem[]>([])
  const [commentInput, setCommentInput] = useState('')
  const [replyInputs, setReplyInputs] = useState<Record<number, string>>({})
  const [expandedReplies, setExpandedReplies] = useState<Record<number, boolean>>({})
  const [mentionTargets, setMentionTargets] = useState<MentionOption[]>([])
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [draggingTaskId, setDraggingTaskId] = useState<number | null>(null)
  const [selectedTaskIds, setSelectedTaskIds] = useState<number[]>([])
  const [search, setSearch] = useState('')
  const [priorityFilter, setPriorityFilter] = useState<string>('all')
  const [assigneeFilter, setAssigneeFilter] = useState<string>('all')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setBusy(true)
    setError(null)
    try {
      const [taskRes, agentRes] = await Promise.all([
        fetch('/api/tasks?limit=500', { cache: 'no-store' }),
        fetch('/api/agents?limit=300', { cache: 'no-store' }),
      ])
      const [taskData, agentData] = await Promise.all([
        taskRes.json().catch(() => ({})),
        agentRes.json().catch(() => ({})),
      ])
      if (!taskRes.ok) {
        setError(taskData?.error || '加载任务失败')
        return
      }
      if (!agentRes.ok) {
        setError(agentData?.error || '加载智能体失败')
      }
      setTasks(Array.isArray(taskData.tasks) ? taskData.tasks : [])
      setAgents(Array.isArray(agentData.agents) ? agentData.agents : [])
    } catch {
      setError('网络异常，加载看板失败')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (tasks.length === 0) void load()
    const loadMentions = async () => {
      try {
        const response = await fetch('/api/mentions?limit=200', { cache: 'no-store' })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) return
        setMentionTargets(Array.isArray(data?.mentions) ? data.mentions : [])
      } catch {
        // mention autocomplete is non-blocking
      }
    }
    void loadMentions()
  }, [])

  const filteredTasks = useMemo(() => {
    const q = search.trim().toLowerCase()
    return tasks.filter((task) => {
      if (priorityFilter !== 'all' && task.priority !== priorityFilter) return false
      if (assigneeFilter !== 'all' && (task.assigned_to || '') !== assigneeFilter) return false
      if (!q) return true
      return (
        String(task.id).includes(q) ||
        task.title.toLowerCase().includes(q) ||
        (task.description || '').toLowerCase().includes(q)
      )
    })
  }, [tasks, search, priorityFilter, assigneeFilter])

  const grouped = useMemo(() => {
    return columns.reduce<Record<string, Task[]>>((acc, col) => {
      acc[col.key] = filteredTasks.filter((t) => t.status === col.key)
      return acc
    }, {})
  }, [filteredTasks])

  const createTask = async () => {
    if (!newTaskTitle.trim()) return
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTaskTitle.trim(), priority: 'medium' }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(data?.error || '创建任务失败')
        return
      }
      setNewTaskTitle('')
      await load()
    } catch {
      setError('网络异常，创建任务失败')
    } finally {
      setBusy(false)
    }
  }

  const updateTaskStatus = async (task: Task, status: Task['status']) => {
    if (task.status === status) return
    setTasks(tasks.map((item) => (item.id === task.id ? { ...item, status } : item)))
    try {
      const response = await fetch(`/api/tasks/${task.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(data?.error || '更新状态失败')
        await load()
      }
    } catch {
      setError('网络异常，更新状态失败')
      await load()
    }
  }

  const assignTask = async (task: Task, assignedTo: string) => {
    const assignee = assignedTo || null
    try {
      const response = await fetch(`/api/tasks/${task.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assigned_to: assignee }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        setError(data?.error || '分配失败')
        return
      }
      await load()
      if (selectedTask?.id === task.id) {
        setSelectedTask({ ...selectedTask, assigned_to: assignee || undefined })
      }
    } catch {
      setError('网络异常，分配失败')
    }
  }

  const openTask = async (task: Task) => {
    setSelectedTask(task)
    setCommentInput('')
    setExpandedReplies({})
    try {
      const response = await fetch(`/api/tasks/${task.id}/comments`, { cache: 'no-store' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setComments([])
        return
      }
      setComments(Array.isArray(data.comments) ? data.comments : [])
    } catch {
      setComments([])
    }
  }

  useEffect(() => {
    if (!selectedTask) return
    const hash = typeof window !== 'undefined' ? window.location.hash : ''
    if (!hash.startsWith('#comment-')) return
    const id = hash.slice(1)
    const timer = setTimeout(() => {
      const el = document.getElementById(id)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 120)
    return () => clearTimeout(timer)
  }, [selectedTask, comments])

  const addComment = async () => {
    if (!selectedTask || !commentInput.trim()) return
    try {
      const response = await fetch(`/api/tasks/${selectedTask.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: commentInput.trim() }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(data?.error || '评论失败')
        return
      }
      setCommentInput('')
      await openTask(selectedTask)
    } catch {
      setError('网络异常，评论失败')
    }
  }

  const addReply = async (parentId: number) => {
    if (!selectedTask) return
    const content = (replyInputs[parentId] || '').trim()
    if (!content) return
    try {
      const response = await fetch(`/api/tasks/${selectedTask.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, parent_id: parentId }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(data?.error || '回复失败')
        return
      }
      setReplyInputs((prev) => ({ ...prev, [parentId]: '' }))
      await openTask(selectedTask)
    } catch {
      setError('网络异常，回复失败')
    }
  }

  const broadcast = async () => {
    if (!selectedTask) return
    try {
      const response = await fetch(`/api/tasks/${selectedTask.id}/broadcast`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: '请关注该任务的最新变更。' }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(data?.error || '广播失败')
      }
    } catch {
      setError('网络异常，广播失败')
    }
  }

  const spawnFromTask = async () => {
    if (!selectedTask) return
    try {
      const response = await fetch('/api/spawn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task: selectedTask.description || selectedTask.title,
          model: 'sonnet',
          label: `task-${selectedTask.id}`,
          timeoutSeconds: 300,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(data?.error || 'spawn 失败')
      }
    } catch {
      setError('网络异常，spawn 失败')
    }
  }

  const qualityReview = async (status: 'approved' | 'rejected') => {
    if (!selectedTask) return
    try {
      const response = await fetch('/api/quality-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: selectedTask.id,
          reviewer: 'aegis',
          status,
          notes: status === 'approved' ? 'Looks good' : 'Needs changes',
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(data?.error || '质量审核失败')
        return
      }
      await load()
      await openTask({ ...selectedTask, status: status === 'approved' ? 'done' : 'in_progress' })
    } catch {
      setError('网络异常，质量审核失败')
    }
  }

  const handleDrop = async (status: Task['status']) => {
    if (!draggingTaskId) return
    const task = tasks.find((t) => t.id === draggingTaskId)
    setDraggingTaskId(null)
    if (!task) return
    await updateTaskStatus(task, status)
  }

  const toggleSelected = (taskId: number, checked: boolean) => {
    setSelectedTaskIds((prev) =>
      checked ? Array.from(new Set([...prev, taskId])) : prev.filter((id) => id !== taskId)
    )
  }

  const bulkMove = async (status: Task['status']) => {
    if (selectedTaskIds.length === 0) return
    setError(null)
    try {
      const response = await fetch('/api/tasks', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tasks: selectedTaskIds.map((id) => ({ id, status })),
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(data?.error || '批量更新失败')
        return
      }
      setSelectedTaskIds([])
      await load()
    } catch {
      setError('网络异常，批量更新失败')
    }
  }

  const getMentionQuery = (value: string) => {
    const matched = value.match(/@([a-zA-Z0-9._-]{0,63})$/)
    return matched ? matched[1].toLowerCase() : ''
  }

  const injectMention = (base: string, handle: string) => {
    const query = getMentionQuery(base)
    if (!query) return `${base}@${handle} `
    return `${base.slice(0, base.length - query.length - 1)}@${handle} `
  }

  const renderCommentTree = (items: CommentItem[], depth = 0): ReactNode[] => {
    return items.flatMap((item) => {
      const replyInput = replyInputs[item.id] || ''
      const query = getMentionQuery(replyInput)
      const suggestions = query
        ? mentionTargets
            .filter((option) => option.handle.includes(query) || option.display.toLowerCase().includes(query))
            .slice(0, 5)
        : []

      const hasReplies = Array.isArray(item.replies) && item.replies.length > 0
      const repliesExpanded = expandedReplies[item.id] ?? true
      const setAnchor = () => {
        if (typeof window === 'undefined') return
        window.location.hash = `comment-${item.id}`
        const el = document.getElementById(`comment-${item.id}`)
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
      const renderMentionHighlighted = (text: string) => {
        const parts = text.split(/(@[a-zA-Z0-9._-]+)/g)
        return (
          <span>
            {parts.map((part, idx) =>
              part.startsWith('@') ? (
                <span key={`${item.id}-${idx}`} className="text-primary font-medium">
                  {part}
                </span>
              ) : (
                <span key={`${item.id}-${idx}`}>{part}</span>
              )
            )}
          </span>
        )
      }

      const node = (
        <div id={`comment-${item.id}`} key={item.id} className="rounded border border-border p-2" style={{ marginLeft: depth * 16 }}>
          <div className="text-xs text-muted-foreground">
            {item.author} · {new Date(item.created_at * 1000).toLocaleString()}
          </div>
          <p className="text-sm whitespace-pre-wrap">{renderMentionHighlighted(item.content)}</p>
          <div className="mt-2 space-y-1">
            <div className="flex items-center gap-1">
              <Button size="sm" variant="outline" className="h-6 text-xs" onClick={setAnchor}>
                定位
              </Button>
              {hasReplies && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 text-xs"
                  onClick={() => setExpandedReplies((prev) => ({ ...prev, [item.id]: !repliesExpanded }))}
                >
                  {repliesExpanded ? `折叠回复 (${item.replies?.length || 0})` : `展开回复 (${item.replies?.length || 0})`}
                </Button>
              )}
            </div>
            <textarea
              className="w-full h-16 bg-secondary border border-border rounded p-2 text-xs"
              placeholder="回复..."
              value={replyInput}
              onChange={(e) => setReplyInputs((prev) => ({ ...prev, [item.id]: e.target.value }))}
            />
            {suggestions.length > 0 && (
              <div className="flex items-center gap-1 flex-wrap">
                {suggestions.map((option) => (
                  <Button
                    key={`${item.id}-${option.handle}`}
                    size="sm"
                    variant="outline"
                    className="h-6 text-xs"
                    onClick={() =>
                      setReplyInputs((prev) => ({
                        ...prev,
                        [item.id]: injectMention(prev[item.id] || '', option.handle),
                      }))
                    }
                  >
                    @{option.handle}
                  </Button>
                ))}
              </div>
            )}
            <Button size="sm" variant="outline" onClick={() => void addReply(item.id)} disabled={!replyInput.trim()}>
              回复
            </Button>
          </div>
        </div>
      )
      const children: ReactNode[] =
        hasReplies && repliesExpanded ? renderCommentTree(item.replies || [], depth + 1) : []
      return [node, ...children]
    })
  }

  return (
    <div className="h-full flex flex-col">
      <div className="p-4 border-b border-border space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Task Board</h2>
          <Button size="sm" variant="outline" onClick={() => void load()} disabled={busy}>
            刷新
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Input
            placeholder="创建新任务"
            value={newTaskTitle}
            onChange={(e) => setNewTaskTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void createTask()
            }}
          />
          <Button onClick={() => void createTask()} disabled={!newTaskTitle.trim() || busy}>
            新建
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Input
            placeholder="搜索任务（ID/标题/描述）"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className="h-9 px-2 rounded-md bg-secondary border border-border text-sm"
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
          >
            <option value="all">全部优先级</option>
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
            <option value="critical">critical</option>
            <option value="urgent">urgent</option>
          </select>
          <select
            className="h-9 px-2 rounded-md bg-secondary border border-border text-sm"
            value={assigneeFilter}
            onChange={(e) => setAssigneeFilter(e.target.value)}
          >
            <option value="all">全部负责人</option>
            {agents.map((agent: Agent) => (
              <option key={agent.id} value={agent.name}>
                {agent.name}
              </option>
            ))}
          </select>
          <Button size="sm" variant="outline" disabled={selectedTaskIds.length === 0} onClick={() => void bulkMove('in_progress')}>
            批量到进行中
          </Button>
          <Button size="sm" variant="outline" disabled={selectedTaskIds.length === 0} onClick={() => void bulkMove('review')}>
            批量到评审
          </Button>
          <Button size="sm" variant="outline" disabled={selectedTaskIds.length === 0} onClick={() => void bulkMove('done')}>
            批量完成
          </Button>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>

      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 overflow-x-auto">
          <div className="min-w-[1200px] h-full grid grid-cols-7 gap-3 p-3">
            {columns.map((col) => (
              <div
                key={col.key}
                className="bg-secondary/30 rounded-lg p-2 flex flex-col min-h-0"
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => void handleDrop(col.key)}
              >
                <div className="pb-2 flex items-center justify-between">
                  <span className="text-xs font-medium">{col.label}</span>
                  <Badge variant="outline">{grouped[col.key]?.length || 0}</Badge>
                </div>
                <div className="space-y-2 overflow-auto">
                  {(grouped[col.key] || []).map((task) => (
                    <Card
                      key={task.id}
                      draggable
                      onDragStart={() => setDraggingTaskId(task.id)}
                      onClick={() => void openTask(task)}
                      className="cursor-pointer"
                    >
                      <CardHeader className="p-3 pb-1">
                        <div className="flex items-start gap-2">
                          <input
                            type="checkbox"
                            checked={selectedTaskIds.includes(task.id)}
                            onChange={(e) => toggleSelected(task.id, e.target.checked)}
                            onClick={(e) => e.stopPropagation()}
                            className="mt-1"
                          />
                          <CardTitle className="text-sm leading-5">#{task.id} {task.title}</CardTitle>
                        </div>
                      </CardHeader>
                      <CardContent className="p-3 pt-1 space-y-2">
                        <div className="flex items-center gap-1">
                          <Badge variant="secondary">{task.priority}</Badge>
                          {task.assigned_to && <Badge variant="outline">{task.assigned_to}</Badge>}
                        </div>
                        <select
                          className="w-full h-7 text-xs bg-background border border-border rounded px-1"
                          value={task.assigned_to || ''}
                          onChange={(e) => void assignTask(task, e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <option value="">未分配</option>
                          {agents.map((agent: Agent) => (
                            <option key={agent.id} value={agent.name}>
                              {agent.name}
                            </option>
                          ))}
                        </select>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {selectedTask && (
          <div className="w-[420px] border-l border-border bg-background p-3 overflow-auto">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">#{selectedTask.id} {selectedTask.title}</h3>
              <Button size="sm" variant="ghost" onClick={() => setSelectedTask(null)}>关闭</Button>
            </div>
            <p className="mt-2 text-sm text-muted-foreground whitespace-pre-wrap">
              {selectedTask.description || '无描述'}
            </p>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button size="sm" variant="outline" onClick={() => void broadcast()}>
                广播
              </Button>
              <Button size="sm" variant="outline" onClick={() => void spawnFromTask()}>
                Spawn
              </Button>
              <Button size="sm" variant="outline" onClick={() => void qualityReview('approved')}>
                QA 通过
              </Button>
              <Button size="sm" variant="outline" onClick={() => void qualityReview('rejected')}>
                QA 拒绝
              </Button>
            </div>

            <div className="mt-4">
              <p className="text-sm font-medium mb-2">评论</p>
              <div className="space-y-2 max-h-64 overflow-auto">
                {renderCommentTree(comments)}
                {comments.length === 0 && <p className="text-xs text-muted-foreground">暂无评论</p>}
              </div>
              <textarea
                className="mt-2 w-full h-24 bg-secondary border border-border rounded p-2 text-sm"
                placeholder="添加评论..."
                value={commentInput}
                onChange={(e) => setCommentInput(e.target.value)}
              />
              {(() => {
                const query = getMentionQuery(commentInput)
                const suggestions = query
                  ? mentionTargets
                      .filter((option) => option.handle.includes(query) || option.display.toLowerCase().includes(query))
                      .slice(0, 6)
                  : []
                if (suggestions.length === 0) return null
                return (
                  <div className="mt-1 flex items-center gap-1 flex-wrap">
                    {suggestions.map((option) => (
                      <Button
                        key={`comment-${option.handle}`}
                        size="sm"
                        variant="outline"
                        className="h-6 text-xs"
                        onClick={() => setCommentInput((prev) => injectMention(prev, option.handle))}
                      >
                        @{option.handle}
                      </Button>
                    ))}
                  </div>
                )
              })()}
              <Button className="mt-2" size="sm" onClick={() => void addComment()} disabled={!commentInput.trim()}>
                发送评论
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default TaskBoardPanel

