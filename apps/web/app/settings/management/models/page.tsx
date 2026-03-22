'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Brain,
  ChevronDown,
  KeyRound,
  Pencil,
  Plus,
  Save,
  Trash2,
  CheckCircle2,
  ExternalLink,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  API_PROTOCOL_OPTIONS,
  buildSavePreview,
  defaultBaseUrlForProtocol,
  SAVE_PREVIEW_FILE_ORDER,
  type ApiProtocol,
  type ModelFormEntry,
  type SaveProviderInput,
} from '@/lib/openclaw-model-shared'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

type ChatOption = { ref: string; label: string }

type ProviderRow = {
  providerKey: string
  displayName: string
  notes: string
  websiteUrl: string
  apiProtocol: ApiProtocol
  baseUrl: string
  hasApiKey: boolean
  sendUserAgent: boolean
  models: ModelFormEntry[]
  defaultModelId: string
  xclawManaged: boolean
}

const emptyModel = (): ModelFormEntry => ({
  id: '',
  displayName: '',
  isDefault: true,
  reasoning: false,
  inputTypes: ['text'],
  contextWindow: 200000,
  maxTokens: 32000,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
})

export default function ModelsSettingsPage() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [tab, setTab] = useState('current')

  const [primary, setPrimary] = useState<string | null>(null)
  const [chatOptions, setChatOptions] = useState<ChatOption[]>([])
  const [providers, setProviders] = useState<ProviderRow[]>([])

  const [primaryDraft, setPrimaryDraft] = useState('default')

  const [form, setForm] = useState({
    providerKey: '',
    displayName: '',
    notes: '',
    websiteUrl: '',
    apiProtocol: 'openai-completions' as ApiProtocol,
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    sendUserAgent: false,
    models: [emptyModel()] as ModelFormEntry[],
    defaultModelId: '',
  })

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    setSuccess('')
    try {
      const res = await fetch('/api/openclaw/models', { cache: 'no-store' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(String(data?.error || '加载失败'))
        return
      }
      setPrimary(typeof data.primary === 'string' ? data.primary : null)
      setChatOptions(Array.isArray(data.chatOptions) ? data.chatOptions : [])
      setProviders(Array.isArray(data.providers) ? data.providers : [])
      const p = typeof data.primary === 'string' && data.primary.trim() ? data.primary.trim() : 'default'
      setPrimaryDraft(p)
    } catch {
      setError('网络异常，无法加载模型配置')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const managedProviders = useMemo(() => providers.filter((p) => p.xclawManaged), [providers])
  const otherProviders = useMemo(() => providers.filter((p) => !p.xclawManaged), [providers])

  const [advancedOpen, setAdvancedOpen] = useState<Record<number, boolean>>({})
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [modalError, setModalError] = useState('')

  const previewPayload = useMemo(() => {
    const models = form.models
      .map((m) => ({
        ...m,
        id: m.id.trim(),
        displayName: (m.displayName || m.id).trim(),
      }))
      .filter((m) => m.id)
    if (!form.providerKey.trim() || models.length === 0) {
      return null
    }
    const def = models.find((m) => m.isDefault) || models[0]
    const body: SaveProviderInput = {
      providerKey: form.providerKey.trim().toLowerCase(),
      displayName: form.displayName.trim(),
      notes: form.notes.trim(),
      websiteUrl: form.websiteUrl.trim(),
      apiProtocol: form.apiProtocol,
      baseUrl: form.baseUrl.trim(),
      apiKey: form.apiKey.trim() || undefined,
      sendUserAgent: form.sendUserAgent,
      models,
      defaultModelId: def?.id || '',
    }
    try {
      return buildSavePreview(body)
    } catch {
      return null
    }
  }, [form])

  const applyPrimary = async () => {
    setError('')
    setSuccess('')
    setSaving(true)
    try {
      const res = await fetch('/api/openclaw/models', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ primary: primaryDraft === 'default' ? null : primaryDraft }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(String(data?.error || '更新失败'))
        return
      }
      setSuccess('默认模型已更新')
      setPrimary(typeof data.primary === 'string' ? data.primary : null)
      await load()
    } catch {
      setError('网络异常')
    } finally {
      setSaving(false)
    }
  }

  const removeProvider = async (providerKey: string) => {
    if (!confirm(`确定删除「${providerKey}」？`)) return
    setError('')
    setSuccess('')
    try {
      const res = await fetch(`/api/openclaw/models?providerKey=${encodeURIComponent(providerKey)}`, {
        method: 'DELETE',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(String(data?.error || '删除失败'))
        return
      }
      setSuccess('已删除')
      await load()
    } catch {
      setError('网络异常')
    }
  }

  const addModelRow = () => {
    setForm((f) => ({
      ...f,
      models: [...f.models.map((m) => ({ ...m, isDefault: false })), { ...emptyModel(), isDefault: true }],
    }))
  }

  const updateModelRow = (idx: number, patch: Partial<ModelFormEntry>) => {
    setForm((f) => {
      const next = f.models.map((m, i) => (i === idx ? { ...m, ...patch } : { ...m, isDefault: false }))
      const def = patch.isDefault === true ? idx : next.findIndex((m) => m.isDefault)
      if (def >= 0) {
        for (let i = 0; i < next.length; i++) next[i] = { ...next[i], isDefault: i === def }
      }
      let defaultModelId = f.defaultModelId
      const chosen = next.find((m) => m.isDefault) || next[0]
      if (chosen?.id) defaultModelId = chosen.id
      return { ...f, models: next, defaultModelId }
    })
  }

  const removeModelRow = (idx: number) => {
    setForm((f) => {
      const next = f.models.filter((_, i) => i !== idx)
      if (next.length === 0) next.push(emptyModel())
      if (!next.some((m) => m.isDefault)) next[0] = { ...next[0], isDefault: true }
      const chosen = next.find((m) => m.isDefault) || next[0]
      return { ...f, models: next, defaultModelId: chosen?.id || '' }
    })
    setAdvancedOpen((o) => {
      const next = { ...o }
      delete next[idx]
      return next
    })
  }

  const toggleInputType = (idx: number, t: 'text' | 'image') => {
    setForm((f) => {
      const cur = f.models[idx]
      const types = new Set(cur.inputTypes || ['text'])
      if (types.has(t)) types.delete(t)
      else types.add(t)
      if (types.size === 0) types.add('text')
      return {
        ...f,
        models: f.models.map((m, i) =>
          i === idx ? { ...m, inputTypes: Array.from(types) } : m,
        ),
      }
    })
  }

  const closeCustomModelDialog = () => {
    setDialogOpen(false)
    setEditingKey(null)
    setModalError('')
    setAdvancedOpen({})
  }

  const openAddCustomModel = () => {
    setError('')
    setModalError('')
    setEditingKey(null)
    setForm({
      providerKey: '',
      displayName: '',
      notes: '',
      websiteUrl: '',
      apiProtocol: 'openai-completions',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: '',
      sendUserAgent: false,
      models: [emptyModel()],
      defaultModelId: '',
    })
    setDialogOpen(true)
  }

  const openEditCustomModel = (p: ProviderRow) => {
    setError('')
    setModalError('')
    const defId =
      p.defaultModelId.trim() ||
      p.models.find((m) => m.isDefault)?.id?.trim() ||
      p.models[0]?.id?.trim() ||
      ''
    const models =
      p.models.length > 0
        ? p.models.map((m, i) => ({
            ...m,
            isDefault: defId ? m.id === defId : i === 0,
          }))
        : [emptyModel()]
    setEditingKey(p.providerKey)
    setForm({
      providerKey: p.providerKey,
      displayName: p.displayName,
      notes: p.notes,
      websiteUrl: p.websiteUrl,
      apiProtocol: p.apiProtocol,
      baseUrl: p.baseUrl,
      apiKey: '',
      sendUserAgent: p.sendUserAgent,
      models,
      defaultModelId: defId,
    })
    setDialogOpen(true)
  }

  const saveCustomModel = async () => {
    setModalError('')
    setSuccess('')
    const pk = form.providerKey.trim().toLowerCase()
    if (!/^[a-z][a-z0-9-]{0,62}$/.test(pk)) {
      setModalError('Provider Key 需以小写字母开头，仅含小写字母、数字、连字符')
      return
    }
    if (!form.baseUrl.trim()) {
      setModalError('请填写 API Endpoint')
      return
    }
    const models = form.models
      .map((m) => ({
        ...m,
        id: m.id.trim(),
        displayName: m.displayName.trim() || m.id.trim(),
      }))
      .filter((m) => m.id)
    if (models.length === 0) {
      setModalError('至少填写一个 Model ID')
      return
    }
    let defaultModelId = form.defaultModelId.trim()
    if (!defaultModelId || !models.some((m) => m.id === defaultModelId)) {
      const def = models.find((m) => m.isDefault) || models[0]
      defaultModelId = def.id
    }

    setSaving(true)
    try {
      const res = await fetch('/api/openclaw/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerKey: pk,
          displayName: form.displayName.trim(),
          notes: form.notes.trim(),
          websiteUrl: form.websiteUrl.trim(),
          apiProtocol: form.apiProtocol,
          baseUrl: form.baseUrl.trim(),
          apiKey: form.apiKey.trim() || undefined,
          sendUserAgent: form.sendUserAgent,
          models,
          defaultModelId,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setModalError(String(data?.error || '保存失败'))
        return
      }
      setSuccess('已保存')
      closeCustomModelDialog()
      setForm({
        providerKey: '',
        displayName: '',
        notes: '',
        websiteUrl: '',
        apiProtocol: 'openai-completions',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: '',
        sendUserAgent: false,
        models: [emptyModel()],
        defaultModelId: '',
      })
      await load()
    } catch {
      setModalError('网络异常')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <h1 className="text-2xl font-semibold flex items-center gap-2">
        <Brain className="h-6 w-6" />
        模型与凭据
      </h1>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="current">当前模型</TabsTrigger>
          <TabsTrigger value="custom">自定义模型</TabsTrigger>
        </TabsList>
        {error && <p className="text-sm text-red-500 mt-2">{error}</p>}
        {success && (
          <p className="text-sm text-emerald-600 flex items-center gap-1 mt-2">
            <CheckCircle2 className="h-4 w-4" />
            {success}
          </p>
        )}

        <TabsContent value="current" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle>默认模型</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {loading ? (
                <p className="text-sm text-muted-foreground">加载中...</p>
              ) : (
                <>
                  <p className="text-sm">
                    解析中主模型：<span className="font-medium text-foreground">{primary || '（未设置）'}</span>
                  </p>
                  <div className="space-y-1">
                    <label className="text-sm text-muted-foreground">选择为默认</label>
                    <Select value={primaryDraft} onValueChange={setPrimaryDraft}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="选择为默认" />
                      </SelectTrigger>
                      <SelectContent>
                        {chatOptions.map((o) => (
                          <SelectItem key={o.ref} value={o.ref}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex justify-end">
                    <Button onClick={applyPrimary} disabled={saving}>
                      应用默认模型
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="custom" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle>已配置的自定义模型</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {loading ? (
                <p className="text-sm text-muted-foreground">加载中...</p>
              ) : managedProviders.length === 0 ? (
                <p className="text-sm text-muted-foreground">暂无。可点击下方按钮添加。</p>
              ) : (
                <ul className="space-y-2">
                  {managedProviders.map((p) => (
                    <li
                      key={p.providerKey}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-medium">{p.displayName || p.providerKey}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          {p.providerKey} · {p.models.length} 个模型 · {p.apiProtocol}
                        </div>
                        <div className="text-xs text-muted-foreground truncate" title={p.baseUrl}>
                          {p.baseUrl || '—'}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => openEditCustomModel(p)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-destructive"
                          onClick={() => removeProvider(p.providerKey)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <Button type="button" onClick={openAddCustomModel} className="w-full sm:w-auto">
                <Plus className="h-4 w-4 mr-1" />
                添加自定义模型
              </Button>
            </CardContent>
          </Card>

          {otherProviders.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>其它来源（只读）</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  来自 OpenClaw CLI / OAuth 等；可在「当前模型」设为默认。
                </p>
                <ul className="space-y-2">
                  {otherProviders.map((p) => (
                    <li
                      key={p.providerKey}
                      className="rounded-md border border-border px-3 py-2 text-sm"
                    >
                      <div className="font-medium">{p.displayName || p.providerKey}</div>
                      <div className="text-xs text-muted-foreground">
                        {p.providerKey} · {p.models.length} 个模型条目
                      </div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          <Dialog
            open={dialogOpen}
            onOpenChange={(open) => {
              setDialogOpen(open)
              if (!open) {
                setEditingKey(null)
                setModalError('')
                setAdvancedOpen({})
              }
            }}
          >
            <DialogContent className="flex max-h-[min(92vh,56rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
              <DialogHeader className="shrink-0 border-b px-6 py-4 pr-12 text-left">
                <DialogTitle>{editingKey ? '编辑自定义模型' : '添加自定义模型'}</DialogTitle>
              </DialogHeader>
              <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-sm text-muted-foreground">Provider Key（配置文件用）</label>
                      <Input
                        value={form.providerKey}
                        disabled={editingKey !== null}
                        onChange={(e) => setForm((f) => ({ ...f, providerKey: e.target.value }))}
                        placeholder="my-provider"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-sm text-muted-foreground">显示名称</label>
                      <Input
                        value={form.displayName}
                        onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
                        placeholder="Claude Official"
                      />
                    </div>
                    <div className="space-y-1 md:col-span-2">
                      <label className="text-sm text-muted-foreground">备注</label>
                      <Input
                        value={form.notes}
                        onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                        placeholder="内部备注"
                      />
                    </div>
                    <div className="space-y-1 md:col-span-2">
                      <label className="text-sm text-muted-foreground">网站 URL（可选）</label>
                      <Input
                        value={form.websiteUrl}
                        onChange={(e) => setForm((f) => ({ ...f, websiteUrl: e.target.value }))}
                        placeholder="https://example.com"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-sm text-muted-foreground">API 协议</label>
                      <Select
                        value={form.apiProtocol}
                        onValueChange={(v) => {
                          const proto = v as ApiProtocol
                          setForm((f) => ({
                            ...f,
                            apiProtocol: proto,
                            baseUrl: f.baseUrl.trim() ? f.baseUrl : defaultBaseUrlForProtocol(proto),
                          }))
                        }}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {API_PROTOCOL_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1 md:col-span-2">
                      <label className="text-sm text-muted-foreground">API Endpoint</label>
                      <Input
                        value={form.baseUrl}
                        onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))}
                        placeholder="https://api.example.com/v1"
                      />
                    </div>
                    <div className="space-y-1 md:col-span-2">
                      <label className="text-sm text-muted-foreground flex items-center gap-2">
                        <KeyRound className="h-4 w-4" />
                        {form.apiProtocol === 'bedrock-converse-stream'
                          ? '认证（Bedrock）'
                          : 'API Key（新建必填；更新时留空则保留原值）'}
                      </label>
                      {form.apiProtocol === 'bedrock-converse-stream' ? (
                        <p className="text-sm text-muted-foreground rounded-md border border-border/60 bg-muted/30 px-3 py-2">
                          将写入 <code className="text-xs">auth: aws-sdk</code>。请在本机配置 AWS 凭证（环境变量、
                          <code className="text-xs">~/.aws/credentials</code> 或 IAM 角色）；无需在此填写 API Key。
                        </p>
                      ) : (
                        <Input
                          type="password"
                          value={form.apiKey}
                          onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
                          placeholder="sk-..."
                        />
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      id="send-ua-dialog"
                      type="checkbox"
                      checked={form.sendUserAgent}
                      onChange={(e) => setForm((f) => ({ ...f, sendUserAgent: e.target.checked }))}
                      className="h-4 w-4"
                    />
                    <label htmlFor="send-ua-dialog" className="text-sm">
                      发送 User-Agent 头
                    </label>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-medium">模型列表</h3>
                      <Button type="button" variant="outline" size="sm" onClick={addModelRow}>
                        <Plus className="h-4 w-4 mr-1" />
                        添加模型
                      </Button>
                    </div>
                    {form.models.map((m, idx) => (
                      <div key={idx} className="rounded-lg border border-border bg-card/40 p-3 space-y-3">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="secondary" className="font-normal">
                              OFFICIAL MODEL
                            </Badge>
                            <label className="text-xs text-muted-foreground flex items-center gap-2">
                              <input
                                type="radio"
                                name="dialog-model-default"
                                checked={Boolean(m.isDefault)}
                                onChange={() => updateModelRow(idx, { isDefault: true })}
                              />
                              设为默认
                            </label>
                          </div>
                          {form.models.length > 1 && (
                            <Button type="button" variant="ghost" size="icon" onClick={() => removeModelRow(idx)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">Model ID</Label>
                            <Input
                              placeholder="claude-3-sonnet"
                              value={m.id}
                              onChange={(e) => updateModelRow(idx, { id: e.target.value })}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">Display Name</Label>
                            <Input
                              placeholder="Claude 3 Sonnet"
                              value={m.displayName}
                              onChange={(e) => updateModelRow(idx, { displayName: e.target.value })}
                            />
                          </div>
                        </div>

                        <Collapsible
                          open={advancedOpen[idx] ?? false}
                          onOpenChange={(open) => setAdvancedOpen((o) => ({ ...o, [idx]: open }))}
                        >
                          <CollapsibleTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-8 px-2 -ml-2 gap-1 text-muted-foreground"
                            >
                              <ChevronDown
                                className={cn(
                                  'h-4 w-4 transition-transform',
                                  (advancedOpen[idx] ?? false) && 'rotate-180',
                                )}
                              />
                              高级选项
                            </Button>
                          </CollapsibleTrigger>
                          <CollapsibleContent className="space-y-4 pt-2">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div className="flex items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2">
                                <Label className="text-sm">Reasoning Mode</Label>
                                <Switch
                                  checked={Boolean(m.reasoning)}
                                  onCheckedChange={(v) => updateModelRow(idx, { reasoning: v })}
                                />
                              </div>
                              <div className="space-y-2 rounded-md border border-border/60 px-3 py-2">
                                <Label className="text-sm">Input Types</Label>
                                <div className="flex flex-wrap gap-4">
                                  <label className="flex items-center gap-2 text-sm">
                                    <input
                                      type="checkbox"
                                      checked={(m.inputTypes || ['text']).includes('text')}
                                      onChange={() => toggleInputType(idx, 'text')}
                                    />
                                    text
                                  </label>
                                  <label className="flex items-center gap-2 text-sm">
                                    <input
                                      type="checkbox"
                                      checked={(m.inputTypes || []).includes('image')}
                                      onChange={() => toggleInputType(idx, 'image')}
                                    />
                                    image
                                  </label>
                                </div>
                              </div>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground">Context Window</Label>
                                <Input
                                  type="number"
                                  min={0}
                                  value={m.contextWindow ?? ''}
                                  onChange={(e) =>
                                    updateModelRow(idx, { contextWindow: Number(e.target.value) || 0 })
                                  }
                                />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground">Max Output Tokens</Label>
                                <Input
                                  type="number"
                                  min={0}
                                  value={m.maxTokens ?? ''}
                                  onChange={(e) => updateModelRow(idx, { maxTokens: Number(e.target.value) || 0 })}
                                />
                              </div>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground">Input Cost（$/M tokens）</Label>
                                <Input
                                  type="number"
                                  step="0.01"
                                  value={m.cost?.input ?? ''}
                                  onChange={(e) =>
                                    updateModelRow(idx, {
                                      cost: {
                                        ...(m.cost || { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }),
                                        input: Number(e.target.value) || 0,
                                      },
                                    })
                                  }
                                />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground">Output Cost（$/M tokens）</Label>
                                <Input
                                  type="number"
                                  step="0.01"
                                  value={m.cost?.output ?? ''}
                                  onChange={(e) =>
                                    updateModelRow(idx, {
                                      cost: {
                                        ...(m.cost || { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }),
                                        output: Number(e.target.value) || 0,
                                      },
                                    })
                                  }
                                />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground">Cache Read Cost（$/M tokens）</Label>
                                <Input
                                  type="number"
                                  step="0.01"
                                  value={m.cost?.cacheRead ?? ''}
                                  onChange={(e) =>
                                    updateModelRow(idx, {
                                      cost: {
                                        ...(m.cost || { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }),
                                        cacheRead: Number(e.target.value) || 0,
                                      },
                                    })
                                  }
                                />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground">Cache Write Cost（$/M tokens）</Label>
                                <Input
                                  type="number"
                                  step="0.01"
                                  value={m.cost?.cacheWrite ?? ''}
                                  onChange={(e) =>
                                    updateModelRow(idx, {
                                      cost: {
                                        ...(m.cost || { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }),
                                        cacheWrite: Number(e.target.value) || 0,
                                      },
                                    })
                                  }
                                />
                              </div>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              计费字段与 OpenClaw 中 <code className="text-[0.7rem]">cost</code>{' '}
                              结构一致（按百万 token 美元计价，用于展示与估算）。
                            </p>
                          </CollapsibleContent>
                        </Collapsible>
                      </div>
                    ))}
                  </div>

                  <Card className="border-dashed">
                    <CardHeader className="py-3">
                      <CardTitle className="text-base">保存前 JSON 预览</CardTitle>
                      <p className="text-xs text-muted-foreground font-normal">
                        API Key 已脱敏。填写 Provider Key 与至少一个 Model ID 后出现内容。
                      </p>
                    </CardHeader>
                    <CardContent>
                      <div className="grid gap-4 sm:grid-cols-1 xl:grid-cols-2">
                        {SAVE_PREVIEW_FILE_ORDER.map((path) => {
                          const blob = previewPayload?.[path]
                          return (
                            <Card key={path} className="overflow-hidden border-border/80 shadow-none">
                              <CardHeader className="space-y-1 py-3">
                                <CardTitle className="text-xs font-mono font-normal leading-snug break-all text-foreground">
                                  {path}
                                </CardTitle>
                              </CardHeader>
                              <CardContent className="pt-0">
                                <pre className="max-h-[min(28vh,12rem)] overflow-auto rounded-md border border-border bg-muted/40 p-3 text-xs leading-relaxed">
                                  {blob !== undefined
                                    ? JSON.stringify(blob, null, 2)
                                    : '// 填写 provider key 与模型 ID 后显示预览'}
                                </pre>
                              </CardContent>
                            </Card>
                          )
                        })}
                      </div>
                    </CardContent>
                  </Card>

                  {modalError && <p className="text-sm text-red-500">{modalError}</p>}
                </div>
              </div>
              <DialogFooter className="shrink-0 gap-2 border-t px-6 py-4 sm:justify-end">
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                  取消
                </Button>
                <Button type="button" onClick={saveCustomModel} disabled={saving}>
                  <Save className="h-4 w-4 mr-1" />
                  {saving ? '保存中...' : '保存'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

        </TabsContent>
      </Tabs>

      <p className="text-xs text-muted-foreground">
        <a
          href="https://docs.openclaw.ai/concepts/models"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-primary hover:underline"
        >
          OpenClaw 模型文档 <ExternalLink className="h-3 w-3" />
        </a>
      </p>
    </div>
  )
}
