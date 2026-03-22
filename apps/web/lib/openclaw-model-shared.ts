/**
 * Client-safe types & pure helpers (no node:fs / config).
 * Server-only persistence lives in `openclaw-model-store.ts`.
 */

export const LEGACY_CUSTOM_ID = 'xclaw-custom'
export const MANAGED_PREFIX = 'xclaw-'

/** Values map to OpenClaw `models.providers.*.api` */
export type ApiProtocol =
  | 'openai-completions'
  | 'openai-responses'
  | 'anthropic-messages'
  | 'google-generative-ai'
  | 'bedrock-converse-stream'

export const API_PROTOCOL_OPTIONS: Array<{ value: ApiProtocol; label: string }> = [
  { value: 'openai-completions', label: 'OpenAI Completions' },
  { value: 'openai-responses', label: 'OpenAI Responses' },
  { value: 'anthropic-messages', label: 'Anthropic Messages' },
  { value: 'google-generative-ai', label: 'Google Generative AI' },
  { value: 'bedrock-converse-stream', label: 'AWS Bedrock' },
]

const KNOWN_API_PROTOCOLS = new Set<ApiProtocol>(API_PROTOCOL_OPTIONS.map((o) => o.value))

export function isKnownApiProtocol(v: string): v is ApiProtocol {
  return KNOWN_API_PROTOCOLS.has(v as ApiProtocol)
}

export function parseApiProtocolFromStored(raw: unknown): ApiProtocol {
  const a = String(raw || '').trim().toLowerCase()
  if (KNOWN_API_PROTOCOLS.has(a as ApiProtocol)) return a as ApiProtocol
  if (a.includes('openai-responses')) return 'openai-responses'
  if (a.includes('bedrock')) return 'bedrock-converse-stream'
  if (a.includes('google') && (a.includes('generative') || a.includes('gemini'))) return 'google-generative-ai'
  if (a.includes('anthropic')) return 'anthropic-messages'
  if (a.includes('openai')) return 'openai-completions'
  return 'openai-completions'
}

export function defaultBaseUrlForProtocol(api: ApiProtocol): string {
  switch (api) {
    case 'openai-completions':
    case 'openai-responses':
      return 'https://api.openai.com/v1'
    case 'anthropic-messages':
      return 'https://api.anthropic.com'
    case 'google-generative-ai':
      return 'https://generativelanguage.googleapis.com/v1beta'
    case 'bedrock-converse-stream':
      return 'https://bedrock-runtime.us-east-1.amazonaws.com'
    default:
      return ''
  }
}

export interface ModelFormEntry {
  id: string
  displayName: string
  isDefault?: boolean
  reasoning?: boolean
  inputTypes?: string[]
  contextWindow?: number
  maxTokens?: number
  cost?: {
    input: number
    output: number
    cacheRead: number
    cacheWrite: number
  }
}

export interface SaveProviderInput {
  providerKey: string
  displayName?: string
  notes?: string
  websiteUrl?: string
  apiProtocol: ApiProtocol
  baseUrl: string
  apiKey?: string
  sendUserAgent?: boolean
  models: ModelFormEntry[]
  defaultModelId: string
}

export function normalizeProviderKey(raw: string): string {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

export function isValidProviderKey(key: string): boolean {
  return /^[a-z][a-z0-9-]{0,62}$/.test(key)
}

/** Same shape as persisted under `models.providers.<id>` */
export function buildProviderBlockFromInput(input: SaveProviderInput): {
  block: Record<string, unknown>
  primaryModelId: string
} {
  const models = (input.models.length > 0 ? input.models : [{ id: 'default', displayName: 'default' }]).map(
    (m) => {
      const id = String(m.id || '').trim()
      const name = String(m.displayName || id).trim() || id
      const cost = m.cost || { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
      const inputModes = Array.isArray(m.inputTypes) && m.inputTypes.length > 0 ? m.inputTypes : ['text']
      return {
        id,
        name,
        reasoning: Boolean(m.reasoning),
        input: inputModes,
        cost: {
          input: Number(cost.input) || 0,
          output: Number(cost.output) || 0,
          cacheRead: Number(cost.cacheRead) || 0,
          cacheWrite: Number(cost.cacheWrite) || 0,
        },
        contextWindow: Number(m.contextWindow) > 0 ? Number(m.contextWindow) : 200000,
        maxTokens: Number(m.maxTokens) > 0 ? Number(m.maxTokens) : 8192,
      }
    },
  )

  const defaultId = String(input.defaultModelId || '').trim()
  let primaryModelId = defaultId
  if (!primaryModelId || !models.some((x) => x.id === primaryModelId)) {
    const def = input.models.find((m) => m.isDefault)
    primaryModelId = def?.id ? String(def.id) : models[0]?.id || ''
  }

  const baseUrl = String(input.baseUrl || '').trim()
  const api = input.apiProtocol

  const block: Record<string, unknown> = {
    api,
    baseUrl,
    models,
  }

  if (api === 'bedrock-converse-stream') {
    block.auth = 'aws-sdk'
  }

  if (input.sendUserAgent) {
    block.sendUserAgent = true
  }
  if (input.displayName?.trim()) {
    block.name = input.displayName.trim()
  }
  if (input.notes?.trim()) {
    block.notes = input.notes.trim()
  }
  if (input.websiteUrl?.trim()) {
    block.website = input.websiteUrl.trim()
  }
  if (input.apiProtocol !== 'bedrock-converse-stream' && input.apiKey && input.apiKey.trim()) {
    block.apiKey = input.apiKey.trim()
  }

  return { block, primaryModelId }
}

/**
 * Ordered paths for save preview UI (4 cards). Must match `buildSavePreview` keys.
 * `models.json` = merged provider blocks; `model.json` = primary/fallbacks mirror of `agents.defaults.model`
 * (written by xclaw `writeAgentModelFiles`, same agent layout OpenClaw expects).
 */
export const SAVE_PREVIEW_FILE_ORDER = [
  '~/.xclaw/openclaw.json',
  '~/.xclaw/agents/main/agent/models.json',
  '~/.xclaw/agents/main/agent/model.json',
  '~/.xclaw/agents/main/agent/auth-profiles.json',
] as const

export type SavePreviewPath = (typeof SAVE_PREVIEW_FILE_ORDER)[number]

/** Preview JSON for UI (secrets redacted). */
export function buildSavePreview(input: SaveProviderInput): Record<SavePreviewPath, unknown> {
  const pk = normalizeProviderKey(input.providerKey)
  const { block, primaryModelId } = buildProviderBlockFromInput({ ...input, providerKey: pk })
  const primaryRef = pk && primaryModelId ? `${pk}/${primaryModelId}` : ''
  const blockPreview = JSON.parse(JSON.stringify(block)) as Record<string, unknown>
  if (typeof blockPreview.apiKey === 'string') {
    blockPreview.apiKey = '***REDACTED***'
  }

  const providerKeyPlaceholder = pk || '<providerKey>'

  return {
    '~/.xclaw/openclaw.json': {
      models: { mode: 'merge', providers: { [providerKeyPlaceholder]: blockPreview } },
      agents: { defaults: { model: { primary: primaryRef || '<provider>/<modelId>' } } },
      xclaw: { managedProviderKeys: ['<existing-keys>', providerKeyPlaceholder] },
    },
    '~/.xclaw/agents/main/agent/models.json': {
      version: 1,
      providers: { [providerKeyPlaceholder]: blockPreview },
    },
    '~/.xclaw/agents/main/agent/model.json': {
      version: 1,
      primary: primaryRef,
      fallbacks: [],
    },
    '~/.xclaw/agents/main/agent/auth-profiles.json':
      input.apiProtocol === 'bedrock-converse-stream'
        ? {
            _note:
              'Bedrock: credentials come from AWS SDK (env, ~/.aws/credentials, or IAM role). No api_key entry is written here for this provider.',
          }
        : {
            profiles: {
              [`${providerKeyPlaceholder}:default`]: {
                type: 'api_key',
                provider: providerKeyPlaceholder,
                key: '***REDACTED***',
              },
            },
          },
  }
}
