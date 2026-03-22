'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import {
  Activity,
  Bot,
  CheckCircle2,
  Clock,
  Database,
  Github,
  ListChecks,
  Lock,
  RefreshCw,
  Server,
  TerminalSquare,
  Timer,
  Users,
  Wrench,
  Zap,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { XclawCliCard } from '@/components/settings/xclaw-cli-card'

type AgentItem = { id: number; name: string; status: string }
type TaskItem = { id: number; status: string; created_at?: number }
type SessionItem = { id: string; key?: string; kind?: string; model?: string; tokens?: string; active?: boolean }
type ActivityItem = { type?: string; summary?: string; detail?: string; created_at?: number }
type LogItem = { id: string; timestamp: number; level: 'info' | 'warn' | 'error' | 'debug'; source: string; message: string }
type GatewayItem = { id: number; name: string; status: 'online' | 'offline' | 'error' | 'unknown'; latency?: number | null; port?: number; host?: string }
type StatusResponse = {
  ok?: boolean
  uptime?: number
  memory?: { total?: number; used?: number }
  disk?: { usage?: string }
  db?: {
    tasks?: { byStatus?: Record<string, number> }
    audit?: { loginFailures?: number }
    notifications?: { unread?: number }
    pipelines?: { active?: number }
    backup?: { age_hours: number } | null
    dbSizeBytes?: number
    webhookCount?: number
  }
}
type SecurityAuditResponse = {
  posture?: { score?: number; level?: string }
  authEvents?: { loginFailures?: number; accessDenials?: number }
  injectionAttempts?: { total?: number }
  rateLimits?: { totalHits?: number }
}
type TokensStatsResponse = { summary?: { totalTokens?: number; totalCost?: number; requestCount?: number } }
type GitHubStatsResponse = { repos?: { total?: number; total_open_issues?: number; total_stars?: number } }

const containerVariants = { hidden: { opacity: 0 }, visible: { opacity: 1, transition: { staggerChildren: 0.1 } } }
const itemVariants = { hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0 } }

function formatUptime(ms?: number) {
  if (!ms || ms <= 0) return '-'
  const totalSeconds = Math.floor(ms / 1000)
  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  if (days > 0) return `${days}d ${hours}h`
  const mins = Math.floor((totalSeconds % 3600) / 60)
  return `${hours}h ${mins}m`
}

function formatBytes(bytes?: number) {
  if (!bytes || bytes <= 0) return '-'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i += 1
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[i]}`
}

function formatTokens(tokens?: number) {
  if (!tokens || tokens <= 0) return '0'
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`
  return String(tokens)
}

export default function SettingsOverview() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [agents, setAgents] = useState<AgentItem[]>([])
  const [tasks, setTasks] = useState<TaskItem[]>([])
  const [sessions, setSessions] = useState<SessionItem[]>([])
  const [skillsTotal, setSkillsTotal] = useState(0)
  const [usersTotal, setUsersTotal] = useState(0)
  const [activities, setActivities] = useState<ActivityItem[]>([])
  const [logs, setLogs] = useState<LogItem[]>([])
  const [gateways, setGateways] = useState<GatewayItem[]>([])
  const [status, setStatus] = useState<StatusResponse | null>(null)
  const [security, setSecurity] = useState<SecurityAuditResponse | null>(null)
  const [tokensStats, setTokensStats] = useState<TokensStatsResponse | null>(null)
  const [githubStats, setGithubStats] = useState<GitHubStatsResponse | null>(null)
  const [lastUpdated, setLastUpdated] = useState<number>(0)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const [aRes, tRes, sessRes, sRes, uRes, acRes, stRes, secRes, tokRes, ghRes, logsRes, gwsRes, gwhRes] = await Promise.all([
        fetch('/api/agents?limit=200', { cache: 'no-store' }),
        fetch('/api/tasks?limit=200', { cache: 'no-store' }),
        fetch('/api/sessions', { cache: 'no-store' }),
        fetch('/api/skills', { cache: 'no-store' }),
        fetch('/api/auth/users', { cache: 'no-store' }),
        fetch('/api/activities?limit=10', { cache: 'no-store' }),
        fetch('/api/status?action=dashboard', { cache: 'no-store' }),
        fetch('/api/security-audit?timeframe=day', { cache: 'no-store' }),
        fetch('/api/tokens?action=stats&timeframe=day', { cache: 'no-store' }),
        fetch('/api/github?action=stats', { cache: 'no-store' }),
        fetch('/api/logs?action=recent&limit=50', { cache: 'no-store' }),
        fetch('/api/gateways', { cache: 'no-store' }),
        fetch('/api/gateways/health', { method: 'POST' }),
      ])

      const [aData, tData, sessData, sData, uData, acData, stData, secData, tokData, ghData, logsData, gwsData, gwhData] = await Promise.all([
        aRes.json(),
        tRes.json(),
        sessRes.json(),
        sRes.json(),
        uRes.json(),
        acRes.json(),
        stRes.json(),
        secRes.json(),
        tokRes.json(),
        ghRes.json(),
        logsRes.json(),
        gwsRes.json(),
        gwhRes.json(),
      ])

      if (!aRes.ok || !tRes.ok || !sessRes.ok || !sRes.ok || !uRes.ok || !acRes.ok || !stRes.ok) {
        setError(aData?.error || tData?.error || sessData?.error || sData?.error || uData?.error || acData?.error || stData?.error || '加载概览数据失败')
        return
      }

      setAgents(Array.isArray(aData.agents) ? aData.agents : [])
      setTasks(Array.isArray(tData.tasks) ? tData.tasks : [])
      setSessions(Array.isArray(sessData.sessions) ? sessData.sessions : [])
      setSkillsTotal(typeof sData.total === 'number' ? sData.total : 0)
      setUsersTotal(Array.isArray(uData.users) ? uData.users.length : 0)
      setActivities(Array.isArray(acData.activities) ? acData.activities : [])
      setLogs(logsRes.ok && Array.isArray(logsData.logs) ? logsData.logs : [])
      if (gwhRes.ok && Array.isArray(gwhData.results)) {
        setGateways(gwhData.results)
      } else {
        setGateways(gwsRes.ok && Array.isArray(gwsData.gateways) ? gwsData.gateways : [])
      }
      setStatus(stData)
      setSecurity(secRes.ok ? secData : null)
      setTokensStats(tokRes.ok ? tokData : null)
      setGithubStats(ghRes.ok ? ghData : null)
      setLastUpdated(Date.now())
    } catch {
      setError('网络异常，无法加载概览数据')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const activeAgents = useMemo(() => agents.filter((a) => a.status !== 'offline').length, [agents])
  const todayTasks = useMemo(() => {
    const today = new Date()
    return tasks.filter((task) => {
      const ts = Number(task.created_at || 0) * 1000
      if (!ts) return false
      const d = new Date(ts)
      return d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate()
    }).length
  }, [tasks])

  const dbTask = status?.db?.tasks?.byStatus || {}
  const inboxCount = dbTask.inbox ?? tasks.filter((t) => t.status === 'inbox').length
  const assignedCount = dbTask.assigned ?? tasks.filter((t) => t.status === 'assigned').length
  const inProgressCount = dbTask.in_progress ?? tasks.filter((t) => t.status === 'in_progress').length
  const reviewCount = (dbTask.review ?? 0) + (dbTask.quality_review ?? 0)
  const doneCount = dbTask.done ?? tasks.filter((t) => t.status === 'done').length
  const backlogCount = inboxCount + assignedCount + reviewCount
  const activeSessions = sessions.filter((s) => Boolean(s.active)).length
  const memoryPct = status?.memory?.total ? Math.round(((status.memory.used || 0) / status.memory.total) * 100) : null
  const diskPct = Number.parseInt((status?.disk?.usage || '').replace('%', ''), 10)
  const recentErrorLogs = logs.filter((log) => log.level === 'error').length
  const gatewayOnlineCount = gateways.filter((gateway) => gateway.status === 'online').length
  const gatewayWorstLatency = gateways.reduce((max, gateway) => {
    const latency = Number(gateway.latency || 0)
    return latency > max ? latency : max
  }, 0)

  const stats = [
    { label: '会话', value: String(activeSessions), icon: TerminalSquare, change: `总计 ${sessions.length}` },
    { label: '活跃智能体', value: String(activeAgents), icon: Bot, change: `总计 ${agents.length}` },
    { label: '任务队列', value: String(backlogCount), icon: ListChecks, change: `进行中 ${inProgressCount}` },
    { label: '安全评分', value: String(security?.posture?.score ?? '-'), icon: Lock, change: security?.posture?.level || '-' },
    { label: '今日任务', value: String(todayTasks), icon: Clock, change: `任务总数 ${tasks.length}` },
    { label: '今日 Token', value: formatTokens(tokensStats?.summary?.totalTokens), icon: Zap, change: `请求 ${tokensStats?.summary?.requestCount || 0}` },
    { label: '技能数量', value: String(skillsTotal), icon: Wrench, change: '已接入后端' },
    { label: '活跃用户', value: String(usersTotal), icon: Users, change: '管理员可见' },
  ]

  const recentActivities = activities.slice(0, 8).map((item) => ({
    message: item.summary || item.detail || item.type || '系统活动',
    time: item.created_at ? new Date(Number(item.created_at) * 1000).toLocaleString() : '-',
  }))

  return (
    <div className="p-6">
      <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-6">
        <motion.div variants={itemVariants}>
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold">概览</h1>
              <p className="text-muted-foreground mt-1">健康、会话、任务流、安全与维护</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">上次刷新：{lastUpdated ? new Date(lastUpdated).toLocaleTimeString() : '-'}</span>
              <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
                <RefreshCw className="h-4 w-4 mr-2" />
                刷新
              </Button>
            </div>
          </div>
          {error ? <p className="text-sm text-destructive mt-2">{error}</p> : null}
        </motion.div>

        <motion.div variants={itemVariants}>
          <XclawCliCard />
        </motion.div>

        <motion.div variants={itemVariants} className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {stats.map((stat, index) => {
            const Icon = stat.icon
            return (
              <motion.div key={stat.label} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.06 }}>
                <Card className="hover:shadow-md transition-shadow">
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">{stat.label}</CardTitle>
                    <Icon className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-end justify-between">
                      <span className="text-2xl font-bold">{stat.value}</span>
                      <span className="flex items-center text-xs text-primary"><Timer className="h-3 w-3 mr-1" />{stat.change}</span>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            )
          })}
        </motion.div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <motion.div variants={itemVariants}>
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><Server className="h-5 w-5" />运行健康</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex justify-between"><span>核心状态</span><span className="text-muted-foreground">{status?.ok ? '正常' : '异常'}</span></div>
                <div className="flex justify-between"><span>内存占用</span><span className="text-muted-foreground">{memoryPct != null ? `${memoryPct}%` : '-'}</span></div>
                <div className="flex justify-between"><span>磁盘占用</span><span className="text-muted-foreground">{Number.isFinite(diskPct) ? `${diskPct}%` : '-'}</span></div>
                <div className="flex justify-between"><span>运行时长</span><span className="text-muted-foreground">{formatUptime(status?.uptime)}</span></div>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div variants={itemVariants}>
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><TerminalSquare className="h-5 w-5" />会话工作台</CardTitle></CardHeader>
              <CardContent><div className="space-y-2 max-h-72 overflow-auto">
                {sessions.slice(0, 8).map((session) => (
                  <div key={session.id} className="w-full rounded border border-border p-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium truncate">{session.key || session.id}</span>
                      <span className={`text-xs ${session.active ? 'text-green-500' : 'text-muted-foreground'}`}>{session.active ? 'active' : 'idle'}</span>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">{(session.kind || 'unknown')} · {(session.model || 'unknown').split('/').pop()} · {session.tokens || '-'}</div>
                  </div>
                ))}
                {sessions.length === 0 ? <div className="text-xs text-muted-foreground border border-dashed rounded p-3">暂无会话数据</div> : null}
              </div></CardContent>
            </Card>
          </motion.div>

          <motion.div variants={itemVariants}>
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><ListChecks className="h-5 w-5" />任务流</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between"><span>Inbox</span><span className="text-muted-foreground">{inboxCount}</span></div>
                <div className="flex justify-between"><span>Assigned</span><span className="text-muted-foreground">{assignedCount}</span></div>
                <div className="flex justify-between"><span>In Progress</span><span className="text-muted-foreground">{inProgressCount}</span></div>
                <div className="flex justify-between"><span>Review</span><span className="text-muted-foreground">{reviewCount}</span></div>
                <div className="flex justify-between"><span>Done</span><span className="text-muted-foreground">{doneCount}</span></div>
                <div className="flex justify-between"><span>Backlog</span><span className={backlogCount > 12 ? 'text-yellow-500' : 'text-muted-foreground'}>{backlogCount}</span></div>
              </CardContent>
            </Card>
          </motion.div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <motion.div variants={itemVariants}>
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><Lock className="h-5 w-5" />安全与审计</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between"><span>安全评分</span><span className="text-muted-foreground">{security?.posture?.score ?? '-'}</span></div>
                <div className="flex justify-between"><span>登录失败(24h)</span><span className="text-muted-foreground">{security?.authEvents?.loginFailures ?? status?.db?.audit?.loginFailures ?? 0}</span></div>
                <div className="flex justify-between"><span>访问拒绝(24h)</span><span className="text-muted-foreground">{security?.authEvents?.accessDenials ?? 0}</span></div>
                <div className="flex justify-between"><span>注入尝试</span><span className="text-muted-foreground">{security?.injectionAttempts?.total ?? 0}</span></div>
                <div className="flex justify-between"><span>限流触发</span><span className="text-muted-foreground">{security?.rateLimits?.totalHits ?? 0}</span></div>
                <Link href="/settings/management/security" className="block"><Button variant="outline" size="sm" className="w-full">查看安全面板</Button></Link>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div variants={itemVariants}>
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><Database className="h-5 w-5" />维护与资产</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between"><span>数据库大小</span><span className="text-muted-foreground">{formatBytes(status?.db?.dbSizeBytes)}</span></div>
                <div className="flex justify-between"><span>最近备份</span><span className="text-muted-foreground">{status?.db?.backup ? `${status.db.backup.age_hours}h 前` : '-'}</span></div>
                <div className="flex justify-between"><span>Webhooks</span><span className="text-muted-foreground">{status?.db?.webhookCount ?? 0}</span></div>
                <div className="flex justify-between"><span>Pipelines 活跃</span><span className="text-muted-foreground">{status?.db?.pipelines?.active ?? 0}</span></div>
                <div className="flex justify-between"><span>未读通知</span><span className="text-muted-foreground">{status?.db?.notifications?.unread ?? 0}</span></div>
                <Link href="/settings/automation/webhooks" className="block"><Button variant="outline" size="sm" className="w-full">打开自动化配置</Button></Link>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div variants={itemVariants}>
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><Github className="h-5 w-5" />GitHub 与成本</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between"><span>仓库总数</span><span className="text-muted-foreground">{githubStats?.repos?.total ?? '-'}</span></div>
                <div className="flex justify-between"><span>Open Issues</span><span className="text-muted-foreground">{githubStats?.repos?.total_open_issues ?? '-'}</span></div>
                <div className="flex justify-between"><span>Stars</span><span className="text-muted-foreground">{githubStats?.repos?.total_stars ?? '-'}</span></div>
                <div className="flex justify-between"><span>今日 Token</span><span className="text-muted-foreground">{formatTokens(tokensStats?.summary?.totalTokens)}</span></div>
                <div className="flex justify-between"><span>今日成本</span><span className="text-muted-foreground">${(tokensStats?.summary?.totalCost || 0).toFixed(3)}</span></div>
                <Link href="/settings/automation/github" className="block"><Button variant="outline" size="sm" className="w-full">打开 GitHub 面板</Button></Link>
              </CardContent>
            </Card>
          </motion.div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <motion.div variants={itemVariants}>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Server className="h-5 w-5" />
                  网关健康与信号
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between"><span>网关在线</span><span className="text-muted-foreground">{gatewayOnlineCount}/{gateways.length}</span></div>
                <div className="flex justify-between"><span>会话流量</span><span className="text-muted-foreground">{sessions.length}</span></div>
                <div className="flex justify-between"><span>错误日志(近50)</span><span className={recentErrorLogs > 0 ? 'text-yellow-500' : 'text-muted-foreground'}>{recentErrorLogs}</span></div>
                <div className="flex justify-between"><span>队列饱和</span><span className={backlogCount > 16 ? 'text-red-500' : backlogCount > 8 ? 'text-yellow-500' : 'text-muted-foreground'}>{backlogCount}</span></div>
                <div className="flex justify-between"><span>最差延迟</span><span className="text-muted-foreground">{gatewayWorstLatency > 0 ? `${gatewayWorstLatency}ms` : '-'}</span></div>
                <Link href="/settings/management/gateway" className="block"><Button variant="outline" size="sm" className="w-full">查看网关面板</Button></Link>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div variants={itemVariants}>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Activity className="h-5 w-5" />
                  事件流
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 max-h-72 overflow-auto">
                  {(logs.length > 0 ? logs.slice(0, 12) : []).map((log) => (
                    <div key={log.id} className="rounded border border-border p-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs text-muted-foreground truncate">{log.source}</span>
                        <span className={`text-xs ${log.level === 'error' ? 'text-red-500' : log.level === 'warn' ? 'text-yellow-500' : 'text-muted-foreground'}`}>
                          {log.level}
                        </span>
                      </div>
                      <p className="text-sm mt-1 line-clamp-2">{log.message}</p>
                      <p className="text-xs text-muted-foreground mt-1">{new Date(log.timestamp).toLocaleTimeString()}</p>
                    </div>
                  ))}
                  {logs.length === 0 ? <div className="text-xs text-muted-foreground border border-dashed rounded p-3">暂无日志事件</div> : null}
                </div>
                <div className="mt-3">
                  <Link href="/settings/monitoring/logs" className="block">
                    <Button variant="outline" size="sm" className="w-full">打开日志面板</Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <motion.div variants={itemVariants}>
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><Activity className="h-5 w-5" />最近活动</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {(recentActivities.length > 0 ? recentActivities : [{ message: '暂无活动', time: '-' }]).map((activity, index) => (
                    <motion.div key={index} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: index * 0.05 }} className="flex items-start gap-3">
                      <div className="w-2 h-2 rounded-full bg-primary mt-2 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm truncate">{activity.message}</p>
                        <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1"><Clock className="h-3 w-3" />{activity.time}</p>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div variants={itemVariants}>
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><CheckCircle2 className="h-5 w-5" />快捷入口</CardTitle></CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-2">
                  <Link href="/settings/tasks"><Button variant="outline" className="w-full justify-start"><ListChecks className="h-4 w-4 mr-2" />任务面板</Button></Link>
                  <Link href="/settings/agents"><Button variant="outline" className="w-full justify-start"><Bot className="h-4 w-4 mr-2" />智能体</Button></Link>
                  <Link href="/settings/monitoring/logs"><Button variant="outline" className="w-full justify-start"><Activity className="h-4 w-4 mr-2" />日志流</Button></Link>
                  <Link href="/settings/channels"><Button variant="outline" className="w-full justify-start"><CheckCircle2 className="h-4 w-4 mr-2" />频道</Button></Link>
                  <Link href="/settings/memory"><Button variant="outline" className="w-full justify-start"><Database className="h-4 w-4 mr-2" />记忆图谱</Button></Link>
                  <Link href="/settings/monitoring/costs"><Button variant="outline" className="w-full justify-start"><Zap className="h-4 w-4 mr-2" />费用追踪</Button></Link>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </motion.div>
    </div>
  )
}
