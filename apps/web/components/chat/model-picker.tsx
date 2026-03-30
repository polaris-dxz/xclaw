'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Check,
  Zap,
  Brain,
  Sparkles,
  ChevronRight,
  Plus,
  Trash2,
  X,
  Eye,
  EyeOff,
} from 'lucide-react'
import { useChatStore, type CustomModel } from '@/lib/store/chat-store'

type ModelIconType = 'fast' | 'smart' | 'balanced'

type ModelRow = {
  ref: string
  id: string
  name: string
  provider: string
  description: string
  tags: string[]
  icon: ModelIconType
  badge?: string
  custom?: boolean
}

interface Position {
  top?: number
  left: number
  bottom?: number
}

/** 无网关数据时的占位列表（ref 即 id，仅作 UI 兜底） */
const FALLBACK_MODELS: ModelRow[] = [
  {
    ref: 'default',
    id: 'default',
    name: '默认大模型',
    provider: 'Auto',
    description: '自动选择最适合的模型',
    tags: ['自动', '推荐'],
    icon: 'balanced',
  },
  {
    ref: 'gpt-4o',
    id: 'gpt-4o',
    name: 'GPT-4o',
    provider: 'OpenAI',
    description: '强大的多模态理解与生成能力',
    tags: ['多模态', '通用'],
    icon: 'smart',
    badge: '热门',
  },
  {
    ref: 'gpt-4o-mini',
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    provider: 'OpenAI',
    description: '快速轻量，适合高频简单任务',
    tags: ['快速', '经济'],
    icon: 'fast',
  },
  {
    ref: 'claude-3-5-sonnet',
    id: 'claude-3-5-sonnet',
    name: 'Claude 3.5 Sonnet',
    provider: 'Anthropic',
    description: '出色的代码与长文本分析能力',
    tags: ['代码', '分析'],
    icon: 'smart',
    badge: '推荐',
  },
  {
    ref: 'claude-3-haiku',
    id: 'claude-3-haiku',
    name: 'Claude 3 Haiku',
    provider: 'Anthropic',
    description: '极速响应，成本优化',
    tags: ['极速', '低延迟'],
    icon: 'fast',
  },
  {
    ref: 'gemini-1.5-pro',
    id: 'gemini-1.5-pro',
    name: 'Gemini 1.5 Pro',
    provider: 'Google',
    description: '超长上下文，支持百万 Token',
    tags: ['长上下文', '多模态'],
    icon: 'smart',
  },
  {
    ref: 'gemini-flash',
    id: 'gemini-flash',
    name: 'Gemini 1.5 Flash',
    provider: 'Google',
    description: '高速推理，性价比卓越',
    tags: ['快速', '经济'],
    icon: 'fast',
  },
  {
    ref: 'deepseek-v3',
    id: 'deepseek-v3',
    name: 'DeepSeek V3',
    provider: 'DeepSeek',
    description: '国产顶尖模型，中文理解优秀',
    tags: ['中文', '推理'],
    icon: 'balanced',
    badge: '国产',
  },
  {
    ref: 'qwen-max',
    id: 'qwen-max',
    name: 'Qwen Max',
    provider: 'Alibaba',
    description: '通义千问旗舰版，全面能力',
    tags: ['中文', '通用'],
    icon: 'balanced',
  },
]

const PROVIDERS = ['全部', 'OpenAI', 'Anthropic', 'Google', 'DeepSeek', 'Alibaba', 'Auto', '自定义', '已配置']

const ModelIcon = ({ type }: { type: ModelIconType }) => {
  if (type === 'fast') return <Zap className="h-4 w-4 text-amber-400" />
  if (type === 'smart') return <Brain className="h-4 w-4 text-violet-400" />
  return <Sparkles className="h-4 w-4 text-primary" />
}

const emptyForm = { name: '', provider: '', baseUrl: '', apiKey: '', description: '' }

export interface ModelPickerProps {
  /** 由外部容器（如 Popover）控制开关；面板内仅通过 onClose 主动关闭 */
  onClose: () => void
  /** 来自 /api/openclaw/models 的 chatOptions；有数据时优先展示 */
  gatewayOptions: { ref: string; label: string }[]
  selectedRef: string
  onSelectRef: (ref: string) => void
}

export function ModelPicker({ onClose, gatewayOptions, selectedRef, onSelectRef }: ModelPickerProps) {
  const { customModels, addCustomModel, deleteCustomModel } = useChatStore()
  const [activeProvider, setActiveProvider] = useState('全部')
  const [search, setSearch] = useState('')

  const [showAddForm, setShowAddForm] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [showApiKey, setShowApiKey] = useState(false)
  const [formError, setFormError] = useState('')

  useEffect(() => {
    // 由外部控制挂载/卸载；这里在卸载前无法感知 open 状态
    return () => {
      setShowAddForm(false)
      setForm(emptyForm)
      setFormError('')
    }
  }, [])

  const baseRows: ModelRow[] = useMemo(() => {
    if (gatewayOptions.length > 0) {
      return gatewayOptions.map((o) => ({
        ref: o.ref,
        id: o.ref,
        name: o.label,
        provider: '已配置',
        description: o.label,
        tags: ['网关'],
        icon: 'balanced' as const,
      }))
    }
    return FALLBACK_MODELS
  }, [gatewayOptions])

  const allModels: ModelRow[] = useMemo(
    () => [
      ...baseRows,
      ...customModels.map((m) => ({
        ref: m.ref,
        id: m.id,
        name: m.name,
        provider: m.provider || '自定义',
        description: m.description || m.baseUrl,
        tags: ['自定义'],
        icon: 'balanced' as const,
        badge: '自定义',
        custom: true,
      })),
    ],
    [baseRows, customModels],
  )

  const selectedLabel = useMemo(() => {
    const hit = allModels.find((m) => m.ref === selectedRef)
    return hit?.name || selectedRef
  }, [allModels, selectedRef])

  const filtered = allModels.filter((m) => {
    const matchProvider =
      activeProvider === '全部' ||
      (activeProvider === '自定义' ? m.custom : m.provider === activeProvider)
    const matchSearch =
      search === '' ||
      m.name.toLowerCase().includes(search.toLowerCase()) ||
      m.provider.toLowerCase().includes(search.toLowerCase())
    return matchProvider && matchSearch
  })

  const handleSelect = (model: ModelRow) => {
    onSelectRef(model.ref)
    onClose()
  }

  const handleAddModel = () => {
    if (!form.name.trim()) {
      setFormError('请填写模型名称')
      return
    }
    if (!form.baseUrl.trim()) {
      setFormError('请填写 API 地址')
      return
    }
    if (!form.apiKey.trim()) {
      setFormError('请填写 API Key')
      return
    }
    const id = `custom-${Date.now()}`
    const ref = `custom-${id}`
    const newModel: CustomModel = {
      ref,
      id,
      name: form.name.trim(),
      provider: form.provider.trim() || '自定义',
      baseUrl: form.baseUrl.trim(),
      apiKey: form.apiKey.trim(),
      description: form.description.trim(),
      createdAt: new Date().toISOString(),
    }
    addCustomModel(newModel)
    onSelectRef(ref)
    setForm(emptyForm)
    setShowAddForm(false)
    setFormError('')
    setActiveProvider('自定义')
    onClose()
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.98 }}
      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
      className="w-[440px] rounded-xl border border-border/60 bg-popover shadow-2xl shadow-black/20 overflow-hidden"
    >
      <div className="px-4 pt-4 pb-3 border-b border-border/40">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-foreground">
                  {showAddForm ? '添加自定义模型' : '选择模型'}
                </h3>
                <div className="flex items-center gap-1">
                  {!showAddForm && (
                    <button
                      type="button"
                      onClick={() => {
                        setShowAddForm(true)
                        setSearch('')
                      }}
                      className="flex items-center gap-1 h-7 px-2.5 rounded-lg text-xs font-medium text-primary bg-primary/10 hover:bg-primary/20 transition-colors"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      添加模型
                    </button>
                  )}
                  {showAddForm && (
                    <button
                      type="button"
                      onClick={() => {
                        setShowAddForm(false)
                        setFormError('')
                      }}
                      className="h-7 w-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                  {!showAddForm && (
                    <span className="text-xs text-muted-foreground ml-2">{filtered.length} 个可用</span>
                  )}
                </div>
              </div>

              {!showAddForm && (
                <input
                  autoFocus
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="搜索模型..."
                  className="w-full h-8 px-3 text-sm rounded-lg bg-secondary/50 border border-border/40 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/40 transition-all"
                />
              )}
            </div>

            {!showAddForm && (
              <div className="flex gap-1.5 px-4 py-2.5 overflow-x-auto scrollbar-none border-b border-border/40">
                {PROVIDERS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setActiveProvider(p)}
                    className={`shrink-0 h-6 px-2.5 rounded-md text-xs font-medium transition-all ${
                      activeProvider === p
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-secondary/60 text-muted-foreground hover:bg-secondary hover:text-foreground'
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            )}

            <AnimatePresence mode="wait">
              {showAddForm ? (
                <motion.div
                  key="form"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.18 }}
                  className="p-4 space-y-3"
                >
                  <p className="text-xs text-muted-foreground">
                    本地会话仅保存展示用；正式接入请在{' '}
                    <Link href="/settings/management/models" className="text-primary hover:underline" onClick={onClose}>
                      设置 → 模型管理
                    </Link>{' '}
                    配置 Provider。
                  </p>
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                      模型名称 <span className="text-destructive">*</span>
                    </label>
                    <input
                      autoFocus
                      value={form.name}
                      onChange={(e) => {
                        setForm({ ...form, name: e.target.value })
                        setFormError('')
                      }}
                      placeholder="例：My GPT-4"
                      className="w-full h-9 px-3 text-sm rounded-lg bg-secondary/50 border border-border/40 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/40 transition-all"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1.5">Provider</label>
                    <input
                      value={form.provider}
                      onChange={(e) => setForm({ ...form, provider: e.target.value })}
                      placeholder="例：OpenAI / 自定义"
                      className="w-full h-9 px-3 text-sm rounded-lg bg-secondary/50 border border-border/40 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/40 transition-all"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                      API Base URL <span className="text-destructive">*</span>
                    </label>
                    <input
                      value={form.baseUrl}
                      onChange={(e) => {
                        setForm({ ...form, baseUrl: e.target.value })
                        setFormError('')
                      }}
                      placeholder="https://api.example.com/v1"
                      className="w-full h-9 px-3 text-sm rounded-lg bg-secondary/50 border border-border/40 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/40 transition-all font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                      API Key <span className="text-destructive">*</span>
                    </label>
                    <div className="relative">
                      <input
                        type={showApiKey ? 'text' : 'password'}
                        value={form.apiKey}
                        onChange={(e) => {
                          setForm({ ...form, apiKey: e.target.value })
                          setFormError('')
                        }}
                        placeholder="sk-..."
                        className="w-full h-9 pl-3 pr-9 text-sm rounded-lg bg-secondary/50 border border-border/40 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/40 transition-all font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => setShowApiKey(!showApiKey)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {showApiKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1.5">描述（可选）</label>
                    <input
                      value={form.description}
                      onChange={(e) => setForm({ ...form, description: e.target.value })}
                      placeholder="简短描述这个模型..."
                      className="w-full h-9 px-3 text-sm rounded-lg bg-secondary/50 border border-border/40 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/40 transition-all"
                    />
                  </div>

                  <AnimatePresence>
                    {formError && (
                      <motion.p
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="text-xs text-destructive"
                      >
                        {formError}
                      </motion.p>
                    )}
                  </AnimatePresence>

                  <div className="flex gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setShowAddForm(false)
                        setFormError('')
                      }}
                      className="flex-1 h-9 rounded-lg text-sm font-medium border border-border/50 text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      onClick={handleAddModel}
                      className="flex-1 h-9 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                    >
                      添加模型
                    </button>
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="list"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.12 }}
                  className="overflow-y-auto max-h-[320px] p-2"
                >
                  {filtered.length === 0 ? (
                    <div className="py-8 text-center text-sm text-muted-foreground">
                      {activeProvider === '自定义' && customModels.length === 0 ? (
                        <div className="flex flex-col items-center gap-2">
                          <p>还没有自定义模型</p>
                          <button
                            type="button"
                            onClick={() => setShowAddForm(true)}
                            className="flex items-center gap-1 text-xs text-primary hover:underline"
                          >
                            <Plus className="h-3 w-3" />
                            立即添加
                          </button>
                        </div>
                      ) : (
                        '未找到匹配的模型'
                      )}
                    </div>
                  ) : (
                    <div className="space-y-0.5">
                      {filtered.map((model, i) => {
                        const isSelected = selectedRef === model.ref
                        return (
                          <motion.div
                            key={model.ref}
                            initial={{ opacity: 0, x: -6 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: i * 0.02 }}
                            className={`group flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all cursor-pointer ${
                              isSelected
                                ? 'bg-primary/10 ring-1 ring-primary/30'
                                : 'hover:bg-secondary/60'
                            }`}
                            onClick={() => handleSelect(model)}
                          >
                            <div
                              className={`shrink-0 h-8 w-8 rounded-lg flex items-center justify-center transition-colors ${
                                isSelected ? 'bg-primary/15' : 'bg-secondary/80 group-hover:bg-secondary'
                              }`}
                            >
                              <ModelIcon type={model.icon} />
                            </div>

                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-foreground truncate">{model.name}</span>
                                {model.badge && (
                                  <span
                                    className={`shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                                      model.custom
                                        ? 'bg-amber-500/15 text-amber-400'
                                        : 'bg-primary/15 text-primary'
                                    }`}
                                  >
                                    {model.badge}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-1.5 mt-0.5">
                                <span className="text-xs text-muted-foreground">{model.provider}</span>
                                <span className="text-muted-foreground/40">·</span>
                                <span className="text-xs text-muted-foreground truncate">{model.description}</span>
                              </div>
                            </div>

                            <div className="shrink-0 flex items-center gap-1.5">
                              {model.custom && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    deleteCustomModel(model.id)
                                    if (selectedRef === model.ref) onSelectRef('default')
                                  }}
                                  className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground/0 group-hover:text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              )}
                              {isSelected ? (
                                <Check className="h-4 w-4 text-primary" />
                              ) : (
                                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40 opacity-0 group-hover:opacity-100 transition-opacity" />
                              )}
                            </div>
                          </motion.div>
                        )
                      })}
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            {!showAddForm && (
              <div className="px-4 py-2.5 border-t border-border/40 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">当前</span>
                  <span className="text-xs font-medium text-foreground truncate max-w-[70%] text-right">
                    {selectedLabel}
                  </span>
                </div>
                <Link
                  href="/settings/management/models"
                  className="block w-full rounded-md border border-border/60 bg-secondary/30 px-3 py-2 text-center text-xs text-primary no-underline hover:bg-secondary/60"
                  onClick={onClose}
                >
                  在设置中管理 Provider 与凭据…
                </Link>
              </div>
            )}
    </motion.div>
  )
}
