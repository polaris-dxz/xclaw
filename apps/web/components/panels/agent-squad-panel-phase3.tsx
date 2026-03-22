'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useXClawStore, type Agent } from '@/store'
import { OrchestrationBar } from './orchestration-bar'
import { useSmartPoll } from '@/lib/use-smart-poll'
import { extractWsHost } from '@/lib/agent-card-helpers'

type AgentDetails = Agent & {
  soul_content?: string
  working_memory?: string
  config?: Record<string, any>
}

type TaskLite = {
  id: number
  title: string
  status: string
  priority: string
  updated_at: number
}

type ActivityLite = {
  id: number
  type: string
  description: string
  created_at: number
}

type DiagnosticsData = {
  summary?: Record<string, any>
  tokens?: { by_model?: Array<{ model: string; input_tokens: number; output_tokens: number; request_count: number }> }
  trends?: { alerts?: Array<{ level: string; message: string }> }
}

type TabKey = 'overview' | 'tasks' | 'activity' | 'tools' | 'channels' | 'cron' | 'models' | 'soul' | 'memory' | 'files'
type GatewayLite = {
  id: number
  name: string
  host: string
  port: number
  is_primary: number
}

export function AgentSquadPanelPhase3() {
  const { agents, setAgents, connection } = useXClawStore()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [gatewayPrimary, setGatewayPrimary] = useState<GatewayLite | null>(null)
  const [gatewayHint, setGatewayHint] = useState<string | null>(null)
  const [selected, setSelected] = useState<AgentDetails | null>(null)
  const [tab, setTab] = useState<TabKey>('overview')
  const [soul, setSoul] = useState('')
  const [memory, setMemory] = useState('')
  const [files, setFiles] = useState<Record<string, string>>({})
  const [agentTasks, setAgentTasks] = useState<TaskLite[]>([])
  const [agentActivities, setAgentActivities] = useState<ActivityLite[]>([])
  const [diagnostics, setDiagnostics] = useState<DiagnosticsData | null>(null)
  const [channels, setChannels] = useState<Record<string, any>>({})
  const [cronJobs, setCronJobs] = useState<Array<{ id?: string; name: string; schedule: string; enabled: boolean; lastStatus?: string }>>([])
  const [modelDraft, setModelDraft] = useState('')
  const [continuePrompt, setContinuePrompt] = useState('')
  const [continueReply, setContinueReply] = useState('')
  const [diagHours, setDiagHours] = useState(72)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncToast, setSyncToast] = useState<string | null>(null)
  const [showHidden, setShowHidden] = useState(false)
  const [cronDraft, setCronDraft] = useState({
    name: '',
    schedule: '*/30 * * * *',
    command: '',
    model: 'sonnet',
  })

  const loadAgents = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent === true
    if (!silent) setLoading(true)
    setError(null)
    try {
      const url = showHidden ? '/api/agents?limit=200&show_hidden=true' : '/api/agents?limit=200'
      const response = await fetch(url, { cache: 'no-store' })
      if (response.status === 401) {
        window.location.assign('/login?next=%2Fsettings%2Fagents')
        return
      }
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(data?.error || '加载智能体失败')
        return
      }
      setAgents(Array.isArray(data.agents) ? data.agents : [])
    } catch {
      setError('网络异常，加载智能体失败')
    } finally {
      if (!silent) setLoading(false)
    }
  }, [setAgents, showHidden])

  const loadGatewaySummary = useCallback(async () => {
    try {
      const response = await fetch('/api/gateways', { cache: 'no-store' })
      if (!response.ok) return
      const data = await response.json().catch(() => ({}))
      const list = Array.isArray(data?.gateways) ? data.gateways as GatewayLite[] : []
      const primary = list.find((item) => Number(item.is_primary) === 1) || null
      setGatewayPrimary(primary)
      if (!primary) {
        setGatewayHint('未检测到主网关')
        return
      }
      const originTag = Number(primary.port) === 20064 ? '内置' : '外部'
      setGatewayHint(`${originTag} ${primary.host}:${primary.port}`)
    } catch {
      setGatewayHint('主网关信息读取失败')
    }
  }, [])

  useEffect(() => {
    void loadAgents()
    void loadGatewaySummary()
  }, [loadAgents, loadGatewaySummary])

  useSmartPoll(() => loadAgents({ silent: true }), 30000, {
    enabled: autoRefresh,
    pauseWhenSseConnected: true,
  })
  useSmartPoll(() => loadGatewaySummary(), 30000, {
    enabled: autoRefresh,
    pauseWhenSseConnected: true,
  })

  const syncFromConfig = async (source?: 'local') => {
    setSyncing(true)
    setSyncToast(null)
    try {
      const url = source === 'local' ? '/api/agents/sync?source=local' : '/api/agents/sync'
      const response = await fetch(url, { method: 'POST' })
      if (response.status === 401) {
        window.location.assign('/login?next=%2Fsettings%2Fagents')
        return
      }
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data?.error || '同步失败')
      }
      const toast = source === 'local'
        ? (data?.message || '本地智能体同步完成')
        : `同步完成：新增 ${data?.created || 0}，更新 ${data?.updated || 0}`
      setSyncToast(toast)
      await loadAgents({ silent: true })
      setTimeout(() => setSyncToast(null), 5000)
    } catch (err: any) {
      setSyncToast(`同步失败：${err?.message || '未知错误'}`)
      setTimeout(() => setSyncToast(null), 5000)
    } finally {
      setSyncing(false)
    }
  }

  const statusCount = useMemo(() => {
    return agents.reduce<Record<string, number>>((acc, item) => {
      acc[item.status] = (acc[item.status] || 0) + 1
      return acc
    }, {})
  }, [agents])

  const openDetails = async (agent: Agent) => {
    setSelected(agent as AgentDetails)
    setTab('overview')
    setSoul(agent.soul_content || '')
    setMemory(agent.working_memory || '')
    setFiles({})
    setAgentTasks([])
    setAgentActivities([])
    setDiagnostics(null)
    setChannels({})
    setCronJobs([])
    setModelDraft(String((agent as any)?.config?.model?.primary || (agent as any)?.config?.model || ''))
    setContinuePrompt('')
    setContinueReply('')
    try {
      const [soulRes, memoryRes, fileRes, taskRes, activityRes, diagRes, channelRes, cronRes] = await Promise.all([
        fetch(`/api/agents/${agent.id}/soul`, { cache: 'no-store' }),
        fetch(`/api/agents/${agent.id}/memory`, { cache: 'no-store' }),
        fetch(`/api/agents/${agent.id}/files`, { cache: 'no-store' }),
        fetch(`/api/tasks?assigned_to=${encodeURIComponent(agent.name)}&limit=80`, { cache: 'no-store' }),
        fetch(`/api/activities?actor=${encodeURIComponent(agent.name)}&limit=80`, { cache: 'no-store' }),
        fetch(`/api/agents/${agent.id}/diagnostics?hours=${diagHours}&section=summary,tokens,trends&privileged=1`, { cache: 'no-store' }),
        fetch('/api/channels', { cache: 'no-store' }),
        fetch('/api/cron?action=list', { cache: 'no-store' }),
      ])
      const [soulData, memoryData, fileData, taskData, activityData, diagData, channelData, cronData] = await Promise.all([
        soulRes.json().catch(() => ({})),
        memoryRes.json().catch(() => ({})),
        fileRes.json().catch(() => ({})),
        taskRes.json().catch(() => ({})),
        activityRes.json().catch(() => ({})),
        diagRes.json().catch(() => ({})),
        channelRes.json().catch(() => ({})),
        cronRes.json().catch(() => ({})),
      ])
      if (soulRes.ok) setSoul(String(soulData?.soul_content || ''))
      if (memoryRes.ok) setMemory(String(memoryData?.working_memory || ''))
      if (fileRes.ok) {
        const f = fileData?.files || {}
        setFiles({
          'identity.md': String(f['identity.md']?.content || ''),
          'agent.md': String(f['agent.md']?.content || ''),
        })
      }
      if (taskRes.ok) {
        setAgentTasks(Array.isArray(taskData?.tasks) ? taskData.tasks : [])
      }
      if (activityRes.ok) {
        setAgentActivities(Array.isArray(activityData?.activities) ? activityData.activities : [])
      }
      if (diagRes.ok) {
        setDiagnostics(diagData || null)
      }
      if (channelRes.ok) {
        setChannels((channelData?.channels && typeof channelData.channels === 'object') ? channelData.channels : {})
      }
      if (cronRes.ok) {
        const list = Array.isArray(cronData?.jobs) ? cronData.jobs : []
        setCronJobs(
          list.filter((job: any) => {
            const id = String(job?.agentId || '').toLowerCase()
            const name = String(job?.name || '').toLowerCase()
            const agentName = agent.name.toLowerCase()
            return id.includes(agentName) || name.includes(agentName)
          })
        )
      }
    } catch {
      // keep modal open even if enrichment fails
    }
  }

  const updateStatus = async (agent: Agent, status: Agent['status']) => {
    try {
      await fetch('/api/agents', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: agent.name, status, last_activity: `Status changed to ${status}` }),
      })
      await loadAgents()
    } catch {
      setError('更新状态失败')
    }
  }

  const wake = async (agent: Agent) => {
    try {
      await fetch(`/api/agents/${agent.id}/wake`, { method: 'POST' })
      await loadAgents()
    } catch {
      setError('唤醒失败')
    }
  }

  const hideToggle = async (agent: Agent) => {
    try {
      await fetch(`/api/agents/${agent.id}/hide`, {
        method: agent.hidden ? 'DELETE' : 'POST',
      })
      await loadAgents()
    } catch {
      setError('隐藏操作失败')
    }
  }

  const saveSoul = async () => {
    if (!selected) return
    await fetch(`/api/agents/${selected.id}/soul`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ soul_content: soul }),
    })
  }

  const saveMemory = async () => {
    if (!selected) return
    await fetch(`/api/agents/${selected.id}/memory`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ working_memory: memory }),
    })
  }

  const saveFile = async (name: 'identity.md' | 'agent.md') => {
    if (!selected) return
    await fetch(`/api/agents/${selected.id}/files`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: name, content: files[name] || '' }),
    })
  }

  const probeChannel = async (channel: string) => {
    try {
      await fetch(`/api/channels?action=probe&channel=${encodeURIComponent(channel)}`, { cache: 'no-store' })
      const refreshed = await fetch('/api/channels', { cache: 'no-store' })
      const json = await refreshed.json().catch(() => ({}))
      if (refreshed.ok) {
        setChannels((json?.channels && typeof json.channels === 'object') ? json.channels : {})
      }
    } catch {
      setError('频道探测失败')
    }
  }

  const channelAction = async (action: 'whatsapp-link' | 'whatsapp-wait' | 'whatsapp-logout') => {
    try {
      const response = await fetch('/api/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(data?.error || `频道动作失败: ${action}`)
        return
      }
      const refreshed = await fetch('/api/channels', { cache: 'no-store' })
      const json = await refreshed.json().catch(() => ({}))
      if (refreshed.ok) {
        setChannels((json?.channels && typeof json.channels === 'object') ? json.channels : {})
      }
    } catch {
      setError(`频道动作失败: ${action}`)
    }
  }

  const cronAction = async (action: 'toggle' | 'trigger', jobId?: string) => {
    if (!jobId) return
    try {
      await fetch('/api/cron', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, jobId }),
      })
      const cronRes = await fetch('/api/cron?action=list', { cache: 'no-store' })
      const cronData = await cronRes.json().catch(() => ({}))
      const list = Array.isArray(cronData?.jobs) ? cronData.jobs : []
      const agentName = (selected?.name || '').toLowerCase()
      setCronJobs(
        list.filter((job: any) => {
          const id = String(job?.agentId || '').toLowerCase()
          const name = String(job?.name || '').toLowerCase()
          return id.includes(agentName) || name.includes(agentName)
        })
      )
    } catch {
      setError('Cron 操作失败')
    }
  }

  const saveModel = async () => {
    if (!selected) return
    try {
      const prevConfig = ((selected as any).config && typeof (selected as any).config === 'object')
        ? (selected as any).config
        : {}
      const nextConfig = {
        ...prevConfig,
        model: {
          ...(typeof prevConfig.model === 'object' ? prevConfig.model : {}),
          primary: modelDraft.trim(),
        },
      }
      const response = await fetch('/api/agents', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: selected.name,
          config: nextConfig,
        }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        setError(data?.error || '保存模型失败')
      } else {
        setSelected({ ...selected, config: nextConfig })
      }
    } catch {
      setError('网络异常，保存模型失败')
    }
  }

  const continueSession = async () => {
    if (!selected?.session_key || !continuePrompt.trim()) return
    try {
      const response = await fetch('/api/sessions/continue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'claude-code',
          id: selected.session_key,
          prompt: continuePrompt.trim(),
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(data?.error || '会话续写失败')
        return
      }
      setContinueReply(String(data?.reply || ''))
    } catch {
      setError('网络异常，会话续写失败')
    }
  }

  const refreshDiagnostics = async () => {
    if (!selected) return
    try {
      const response = await fetch(
        `/api/agents/${selected.id}/diagnostics?hours=${diagHours}&section=summary,tokens,trends&privileged=1`,
        { cache: 'no-store' }
      )
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(data?.error || '刷新诊断失败')
        return
      }
      setDiagnostics(data || null)
    } catch {
      setError('网络异常，刷新诊断失败')
    }
  }

  const addCron = async () => {
    if (!cronDraft.name.trim() || !cronDraft.schedule.trim() || !cronDraft.command.trim()) return
    try {
      const response = await fetch('/api/cron', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'add',
          jobName: cronDraft.name.trim(),
          schedule: cronDraft.schedule.trim(),
          command: cronDraft.command.trim(),
          model: cronDraft.model.trim(),
          description: `Created from agent panel (${selected?.name || 'unknown'})`,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(data?.error || '新增 cron 失败')
        return
      }
      setCronDraft({ name: '', schedule: cronDraft.schedule, command: '', model: cronDraft.model })
      const cronRes = await fetch('/api/cron?action=list', { cache: 'no-store' })
      const cronData = await cronRes.json().catch(() => ({}))
      const list = Array.isArray(cronData?.jobs) ? cronData.jobs : []
      const agentName = (selected?.name || '').toLowerCase()
      setCronJobs(
        list.filter((job: any) => {
          const id = String(job?.agentId || '').toLowerCase()
          const name = String(job?.name || '').toLowerCase()
          return id.includes(agentName) || name.includes(agentName)
        })
      )
    } catch {
      setError('网络异常，新增 cron 失败')
    }
  }

  return (
    <div className="h-full flex flex-col">
      <OrchestrationBar />
      <div className="p-4 flex items-center justify-between border-b border-border">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span>idle {statusCount.idle || 0}</span>
          <span>busy {statusCount.busy || 0}</span>
          <span>offline {statusCount.offline || 0}</span>
          <span>error {statusCount.error || 0}</span>
          <span className="text-border">|</span>
          <span>主网关 {gatewayHint || '加载中...'}</span>
          <Badge variant={connection.isConnected ? 'default' : 'outline'}>
            WS {connection.isConnected ? '已连接' : '未连接'}
          </Badge>
          <span>实连 {extractWsHost(connection.url)}</span>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant={autoRefresh ? 'default' : 'outline'} onClick={() => setAutoRefresh((v) => !v)}>
            {autoRefresh ? 'Live' : 'Manual'}
          </Button>
          <Button size="sm" variant="outline" onClick={() => void syncFromConfig()} disabled={syncing}>
            {syncing ? '同步中...' : '同步配置'}
          </Button>
          <Button size="sm" variant="outline" onClick={() => void syncFromConfig('local')} disabled={syncing}>
            同步本地
          </Button>
          <Button size="sm" variant={showHidden ? 'default' : 'outline'} onClick={() => setShowHidden((v) => !v)}>
            {showHidden ? '显示中(含隐藏)' : '显示隐藏'}
          </Button>
          <Button size="sm" variant="outline" onClick={() => { void loadAgents(); void loadGatewaySummary() }} disabled={loading}>
            刷新
          </Button>
        </div>
      </div>

      {syncToast && (
        <div className={`mx-4 mt-3 rounded border px-3 py-2 text-sm ${syncToast.includes('失败') ? 'border-destructive/40 text-destructive bg-destructive/5' : 'border-emerald-500/30 text-emerald-600 dark:text-emerald-400 bg-emerald-500/5'}`}>
          {syncToast}
        </div>
      )}

      {error && (
        <div className="mx-4 mt-3 flex items-center justify-between rounded border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <span>{error}</span>
          <Button size="sm" variant="ghost" onClick={() => setError(null)}>
            关闭
          </Button>
        </div>
      )}

      <div className="p-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 overflow-auto">
        {agents.map((agent) => (
          <Card key={agent.id} className="cursor-pointer" onClick={() => void openDetails(agent)}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center justify-between">
                <span>{agent.name}</span>
                <Badge variant="secondary">{agent.status}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-xs text-muted-foreground">{agent.role}</p>
              <div className="flex items-center gap-1">
                <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); void updateStatus(agent, 'idle') }}>
                  idle
                </Button>
                <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); void updateStatus(agent, 'busy') }}>
                  busy
                </Button>
                <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); void wake(agent) }}>
                  wake
                </Button>
                <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); void hideToggle(agent) }}>
                  {agent.hidden ? 'unhide' : 'hide'}
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {selected && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-6" onClick={() => setSelected(null)}>
          <div className="bg-background border border-border rounded-lg w-full max-w-4xl h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <h3 className="font-semibold">{selected.name}</h3>
              <Button size="sm" variant="ghost" onClick={() => setSelected(null)}>关闭</Button>
            </div>
            <div className="px-4 py-2 border-b border-border flex items-center gap-2">
              {(['overview', 'tasks', 'activity', 'tools', 'channels', 'cron', 'models', 'soul', 'memory', 'files'] as TabKey[]).map((t) => (
                <Button key={t} size="sm" variant={tab === t ? 'default' : 'outline'} onClick={() => setTab(t)}>
                  {t}
                </Button>
              ))}
            </div>
            <div className="p-4 overflow-auto flex-1">
              {tab === 'overview' && (
                <div className="space-y-2 text-sm">
                  <p>状态：{selected.status}</p>
                  <p>角色：{selected.role}</p>
                  <p>会话：{selected.session_key || '-'}</p>
                  <p>最后在线：{selected.last_seen ? new Date(selected.last_seen * 1000).toLocaleString() : '-'}</p>
                </div>
              )}
              {tab === 'tasks' && (
                <div className="space-y-2">
                  {agentTasks.length === 0 ? (
                    <p className="text-sm text-muted-foreground">暂无任务</p>
                  ) : (
                    agentTasks.map((task) => (
                      <div key={task.id} className="rounded border border-border p-2">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-medium">#{task.id} {task.title}</p>
                          <Badge variant="outline">{task.status}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          {task.priority} · {new Date(task.updated_at * 1000).toLocaleString()}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              )}
              {tab === 'activity' && (
                <div className="space-y-2">
                  {agentActivities.length === 0 ? (
                    <p className="text-sm text-muted-foreground">暂无活动</p>
                  ) : (
                    agentActivities.map((activity) => (
                      <div key={activity.id} className="rounded border border-border p-2">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-medium">{activity.type}</p>
                          <p className="text-xs text-muted-foreground">{new Date(activity.created_at * 1000).toLocaleString()}</p>
                        </div>
                        <p className="text-sm mt-1">{activity.description}</p>
                      </div>
                    ))
                  )}
                </div>
              )}
              {tab === 'tools' && (
                <div className="space-y-3 text-sm">
                  <div className="flex items-center gap-2">
                    <p>诊断摘要：</p>
                    <input
                      className="h-7 w-24 px-2 rounded bg-secondary border border-border text-xs"
                      type="number"
                      min={1}
                      max={720}
                      value={diagHours}
                      onChange={(e) => setDiagHours(Math.max(1, Math.min(720, Number(e.target.value || 72))))}
                    />
                    <Button size="sm" variant="outline" onClick={() => void refreshDiagnostics()}>
                      刷新诊断
                    </Button>
                  </div>
                  <pre className="text-xs bg-secondary border border-border rounded p-2 overflow-auto">
                    {JSON.stringify(diagnostics?.summary || {}, null, 2)}
                  </pre>
                  {(diagnostics?.trends?.alerts || []).length > 0 && (
                    <div className="space-y-1">
                      {(diagnostics?.trends?.alerts || []).map((alert, index) => (
                        <p key={index} className="text-xs text-muted-foreground">- [{alert.level}] {alert.message}</p>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {tab === 'channels' && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline" onClick={() => void channelAction('whatsapp-link')}>
                      WhatsApp 登录
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => void channelAction('whatsapp-wait')}>
                      等待确认
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => void channelAction('whatsapp-logout')}>
                      WhatsApp 登出
                    </Button>
                  </div>
                  {Object.keys(channels).length === 0 ? (
                    <p className="text-sm text-muted-foreground">暂无频道数据</p>
                  ) : (
                    Object.entries(channels).map(([name, snapshot]) => (
                      <div key={name} className="rounded border border-border p-2 text-sm">
                        <div className="flex items-center justify-between">
                          <p className="font-medium">{name}</p>
                          <Badge variant="outline">{snapshot?.connected ? 'connected' : 'offline'}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          mode: {snapshot?.mode || '-'} · running: {String(Boolean(snapshot?.running))}
                        </p>
                        <div className="mt-2">
                          <Button size="sm" variant="outline" onClick={() => void probeChannel(name)}>
                            Probe
                          </Button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
              {tab === 'cron' && (
                <div className="space-y-2">
                  <div className="rounded border border-border p-2 space-y-2">
                    <p className="text-sm font-medium">新增 Cron</p>
                    <input
                      className="w-full h-8 px-2 rounded bg-secondary border border-border text-xs"
                      placeholder="任务名（建议带 agent 名）"
                      value={cronDraft.name}
                      onChange={(e) => setCronDraft((prev) => ({ ...prev, name: e.target.value }))}
                    />
                    <input
                      className="w-full h-8 px-2 rounded bg-secondary border border-border text-xs"
                      placeholder="Cron 表达式，如 */30 * * * *"
                      value={cronDraft.schedule}
                      onChange={(e) => setCronDraft((prev) => ({ ...prev, schedule: e.target.value }))}
                    />
                    <input
                      className="w-full h-8 px-2 rounded bg-secondary border border-border text-xs"
                      placeholder="执行内容"
                      value={cronDraft.command}
                      onChange={(e) => setCronDraft((prev) => ({ ...prev, command: e.target.value }))}
                    />
                    <div className="flex items-center gap-2">
                      <input
                        className="flex-1 h-8 px-2 rounded bg-secondary border border-border text-xs"
                        placeholder="模型（可选）"
                        value={cronDraft.model}
                        onChange={(e) => setCronDraft((prev) => ({ ...prev, model: e.target.value }))}
                      />
                      <Button size="sm" variant="outline" onClick={() => void addCron()} disabled={!cronDraft.name.trim() || !cronDraft.schedule.trim() || !cronDraft.command.trim()}>
                        添加
                      </Button>
                    </div>
                  </div>
                  {cronJobs.length === 0 ? (
                    <p className="text-sm text-muted-foreground">暂无关联 cron（或当前账号无管理员权限）</p>
                  ) : (
                    cronJobs.map((job) => (
                      <div key={job.id || job.name} className="rounded border border-border p-2 text-sm">
                        <div className="flex items-center justify-between">
                          <p className="font-medium">{job.name}</p>
                          <Badge variant={job.enabled ? 'default' : 'outline'}>{job.enabled ? 'enabled' : 'disabled'}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          {job.schedule} · {job.lastStatus || 'unknown'}
                        </p>
                        <div className="mt-2 flex items-center gap-2">
                          <Button size="sm" variant="outline" onClick={() => void cronAction('toggle', job.id)}>
                            切换启用
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => void cronAction('trigger', job.id)}>
                            立即触发
                          </Button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
              {tab === 'models' && (
                <div className="space-y-2">
                  <div className="rounded border border-border p-2 text-sm">
                    <p className="font-medium mb-1">配置模型</p>
                    <div className="flex items-center gap-2">
                      <input
                        className="flex-1 h-8 px-2 rounded bg-secondary border border-border text-xs"
                        value={modelDraft}
                        onChange={(e) => setModelDraft(e.target.value)}
                        placeholder="例如 sonnet / gpt-4.1"
                      />
                      <Button size="sm" variant="outline" onClick={() => void saveModel()} disabled={!modelDraft.trim()}>
                        保存模型
                      </Button>
                    </div>
                  </div>
                  <div className="rounded border border-border p-2">
                    <p className="font-medium text-sm mb-1">Token 使用</p>
                    {(diagnostics?.tokens?.by_model || []).length === 0 ? (
                      <p className="text-xs text-muted-foreground">暂无 token 统计</p>
                    ) : (
                      <div className="space-y-1">
                        {(diagnostics?.tokens?.by_model || []).map((item) => (
                          <p key={item.model} className="text-xs text-muted-foreground">
                            {item.model}: in {item.input_tokens} / out {item.output_tokens} / req {item.request_count}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                  {selected.session_key && (
                    <div className="rounded border border-border p-2">
                      <p className="font-medium text-sm mb-1">会话继续（session_key）</p>
                      <textarea
                        className="w-full h-20 bg-secondary border border-border rounded p-2 text-xs"
                        value={continuePrompt}
                        onChange={(e) => setContinuePrompt(e.target.value)}
                        placeholder="给当前 agent 会话继续发送提示词"
                      />
                      <div className="mt-2 flex items-center gap-2">
                        <Button size="sm" variant="outline" onClick={() => void continueSession()} disabled={!continuePrompt.trim()}>
                          发送继续
                        </Button>
                      </div>
                      {continueReply && (
                        <pre className="mt-2 text-xs bg-secondary border border-border rounded p-2 whitespace-pre-wrap">
                          {continueReply}
                        </pre>
                      )}
                    </div>
                  )}
                </div>
              )}
              {tab === 'soul' && (
                <div className="space-y-2">
                  <textarea className="w-full h-72 bg-secondary border border-border rounded p-2 text-sm" value={soul} onChange={(e) => setSoul(e.target.value)} />
                  <Button onClick={() => void saveSoul()}>保存 SOUL</Button>
                </div>
              )}
              {tab === 'memory' && (
                <div className="space-y-2">
                  <textarea className="w-full h-72 bg-secondary border border-border rounded p-2 text-sm" value={memory} onChange={(e) => setMemory(e.target.value)} />
                  <Button onClick={() => void saveMemory()}>保存 Memory</Button>
                </div>
              )}
              {tab === 'files' && (
                <div className="space-y-4">
                  <div>
                    <p className="text-sm mb-1">identity.md</p>
                    <textarea
                      className="w-full h-32 bg-secondary border border-border rounded p-2 text-sm"
                      value={files['identity.md'] || ''}
                      onChange={(e) => setFiles((prev) => ({ ...prev, 'identity.md': e.target.value }))}
                    />
                    <Button size="sm" className="mt-2" onClick={() => void saveFile('identity.md')}>保存 identity.md</Button>
                  </div>
                  <div>
                    <p className="text-sm mb-1">agent.md</p>
                    <textarea
                      className="w-full h-32 bg-secondary border border-border rounded p-2 text-sm"
                      value={files['agent.md'] || ''}
                      onChange={(e) => setFiles((prev) => ({ ...prev, 'agent.md': e.target.value }))}
                    />
                    <Button size="sm" className="mt-2" onClick={() => void saveFile('agent.md')}>保存 agent.md</Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default AgentSquadPanelPhase3

