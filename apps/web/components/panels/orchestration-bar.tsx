'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type AgentItem = {
  id: number
  name: string
  role: string
  status: string
  session_key?: string
}

type WorkflowTemplate = {
  id: number
  name: string
  description?: string | null
  model: string
  task_prompt: string
  timeout_seconds: number
  tags?: string[]
}

export function OrchestrationBar() {
  const [agents, setAgents] = useState<AgentItem[]>([])
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([])
  const [selectedAgent, setSelectedAgent] = useState('')
  const [message, setMessage] = useState('')
  const [taskPrompt, setTaskPrompt] = useState('')
  const [model, setModel] = useState('sonnet')
  const [result, setResult] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [newTplName, setNewTplName] = useState('')
  const [newTplDesc, setNewTplDesc] = useState('')
  const [newTplTimeout, setNewTplTimeout] = useState(300)
  const [showTplEditor, setShowTplEditor] = useState(false)

  const onlineAgents = useMemo(
    () => agents.filter((a) => a.status === 'idle' || a.status === 'busy').length,
    [agents]
  )

  const load = async () => {
    try {
      const [aRes, wRes] = await Promise.all([
        fetch('/api/agents?limit=200', { cache: 'no-store' }),
        fetch('/api/workflows', { cache: 'no-store' }),
      ])
      const [aData, wData] = await Promise.all([
        aRes.json().catch(() => ({})),
        wRes.json().catch(() => ({})),
      ])
      setAgents(Array.isArray(aData?.agents) ? aData.agents : [])
      setTemplates(Array.isArray(wData?.templates) ? wData.templates : [])
    } catch {
      // non-blocking
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const sendMessage = async () => {
    if (!selectedAgent || !message.trim()) return
    setBusy(true)
    setResult(null)
    try {
      const response = await fetch('/api/agents/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: selectedAgent, from: 'operator', content: message.trim() }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setResult(data?.error || '发送失败')
        return
      }
      setMessage('')
      setResult(`已发送给 ${selectedAgent}`)
    } catch {
      setResult('网络异常，发送失败')
    } finally {
      setBusy(false)
    }
  }

  const spawn = async () => {
    if (!taskPrompt.trim()) return
    setBusy(true)
    setResult(null)
    try {
      const response = await fetch('/api/spawn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task: taskPrompt.trim(),
          model,
          label: `spawn-${Date.now()}`,
          timeoutSeconds: 300,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setResult(data?.error || 'Spawn 失败')
        return
      }
      setTaskPrompt('')
      setResult('Spawn 已提交')
    } catch {
      setResult('网络异常，Spawn 失败')
    } finally {
      setBusy(false)
    }
  }

  const runTemplate = async (tpl: WorkflowTemplate) => {
    setBusy(true)
    setResult(null)
    try {
      const response = await fetch('/api/spawn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task: tpl.task_prompt,
          model: tpl.model || 'sonnet',
          label: tpl.name,
          timeoutSeconds: tpl.timeout_seconds || 300,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setResult(data?.error || `运行模板 ${tpl.name} 失败`)
        return
      }
      await fetch('/api/workflows', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: tpl.id }),
      })
      setResult(`模板已运行：${tpl.name}`)
      await load()
    } catch {
      setResult(`网络异常，运行模板 ${tpl.name} 失败`)
    } finally {
      setBusy(false)
    }
  }

  const saveTemplate = async () => {
    if (!newTplName.trim() || !taskPrompt.trim()) return
    setBusy(true)
    setResult(null)
    try {
      const response = await fetch('/api/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newTplName.trim(),
          description: newTplDesc.trim() || null,
          model,
          task_prompt: taskPrompt.trim(),
          timeout_seconds: newTplTimeout,
          agent_role: selectedAgent || null,
          tags: [],
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setResult(data?.error || '保存模板失败')
        return
      }
      setNewTplName('')
      setNewTplDesc('')
      setShowTplEditor(false)
      setResult('模板已保存')
      await load()
    } catch {
      setResult('网络异常，保存模板失败')
    } finally {
      setBusy(false)
    }
  }

  const deleteTemplate = async (id: number) => {
    setBusy(true)
    setResult(null)
    try {
      const response = await fetch('/api/workflows', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setResult(data?.error || '删除模板失败')
        return
      }
      setResult('模板已删除')
      await load()
    } catch {
      setResult('网络异常，删除模板失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="border-b border-border bg-card/50 p-3 space-y-3">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Orchestration</span>
        <span>在线 {onlineAgents}/{agents.length}</span>
      </div>

      <div className="flex items-center gap-2">
        <select
          value={selectedAgent}
          onChange={(e) => setSelectedAgent(e.target.value)}
          className="h-9 px-2 rounded-md bg-secondary border border-border text-sm min-w-[160px]"
        >
          <option value="">选择 agent</option>
          {agents.map((agent) => (
            <option key={agent.id} value={agent.name}>
              {agent.name} ({agent.status})
            </option>
          ))}
        </select>
        <Input
          placeholder="给 agent 发消息"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void sendMessage()
          }}
        />
        <Button onClick={() => void sendMessage()} disabled={busy || !selectedAgent || !message.trim()}>
          发送
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="h-9 px-2 rounded-md bg-secondary border border-border text-sm min-w-[130px]"
        >
          <option value="haiku">haiku</option>
          <option value="sonnet">sonnet</option>
          <option value="opus">opus</option>
        </select>
        <Input
          placeholder="输入任务，直接 spawn 子代理"
          value={taskPrompt}
          onChange={(e) => setTaskPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void spawn()
          }}
        />
        <Button onClick={() => void spawn()} disabled={busy || !taskPrompt.trim()}>
          Spawn
        </Button>
        <Button variant="outline" onClick={() => setShowTplEditor((v) => !v)} disabled={!taskPrompt.trim()}>
          {showTplEditor ? '取消保存' : '保存为模板'}
        </Button>
      </div>

      {showTplEditor && (
        <div className="flex items-center gap-2">
          <Input
            placeholder="模板名"
            value={newTplName}
            onChange={(e) => setNewTplName(e.target.value)}
          />
          <Input
            placeholder="描述（可选）"
            value={newTplDesc}
            onChange={(e) => setNewTplDesc(e.target.value)}
          />
          <Input
            type="number"
            min={30}
            max={3600}
            value={newTplTimeout}
            onChange={(e) => setNewTplTimeout(Number(e.target.value || 300))}
            className="w-28"
          />
          <Button onClick={() => void saveTemplate()} disabled={busy || !newTplName.trim() || !taskPrompt.trim()}>
            保存
          </Button>
        </div>
      )}

      {templates.length > 0 && (
        <div className="space-y-2 max-h-36 overflow-auto">
          {templates.slice(0, 12).map((tpl) => (
            <div key={tpl.id} className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setTaskPrompt(tpl.task_prompt)
                  setModel(tpl.model || 'sonnet')
                  setResult(`已载入模板：${tpl.name}`)
                }}
                className="whitespace-nowrap"
              >
                载入
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void runTemplate(tpl)}
                className="whitespace-nowrap"
              >
                运行
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void deleteTemplate(tpl.id)}
                className="whitespace-nowrap"
              >
                删除
              </Button>
              <p className="text-xs text-muted-foreground truncate">{tpl.name}</p>
            </div>
          ))}
        </div>
      )}

      {result && <p className="text-xs text-muted-foreground">{result}</p>}
    </div>
  )
}

