import fs from 'node:fs'
import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { config } from '@/lib/config'
import { mutationLimiter } from '@/lib/rate-limit'
import { LEGACY_CUSTOM_ID, deleteProvider, loadModelStoreState, saveProvider } from '@/lib/openclaw-model-store'

type ProviderType = 'openai' | 'anthropic' | 'openai-compatible' | 'minimax' | 'zhipu'

const PROVIDER_OPTIONS: Array<{ id: ProviderType; label: string }> = [
  { id: 'openai', label: 'OpenAI' },
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'openai-compatible', label: 'OpenAI Compatible' },
  { id: 'minimax', label: 'MiniMax' },
  { id: 'zhipu', label: '智谱 GLM' },
]

const MODEL_PRESETS: Array<{ id: string; label: string; provider: ProviderType }> = [
  { id: 'gpt-4o-mini', label: 'OpenAI · gpt-4o-mini', provider: 'openai' },
  { id: 'gpt-4o', label: 'OpenAI · gpt-4o', provider: 'openai' },
  { id: 'claude-3-7-sonnet-latest', label: 'Anthropic · claude-3-7-sonnet-latest', provider: 'anthropic' },
  { id: 'claude-3-5-sonnet-latest', label: 'Anthropic · claude-3-5-sonnet-latest', provider: 'anthropic' },
  { id: 'MiniMax-M2.5', label: 'MiniMax · MiniMax-M2.5', provider: 'minimax' },
  { id: 'glm-4.5', label: '智谱 · glm-4.5', provider: 'zhipu' },
]

function mapLegacyProviderToProtocol(provider: ProviderType): 'openai-completions' | 'anthropic-messages' {
  if (provider === 'anthropic' || provider === 'minimax') return 'anthropic-messages'
  return 'openai-completions'
}

function legacyDefaultBaseUrl(provider: ProviderType, baseUrl: string): string {
  const b = baseUrl.trim()
  if (b) return b
  if (provider === 'minimax') return 'https://api.minimaxi.com/anthropic'
  if (provider === 'zhipu') return 'https://open.bigmodel.cn/api/paas/v4'
  if (provider === 'anthropic') return 'https://api.anthropic.com'
  return 'https://api.openai.com/v1'
}

/**
 * @deprecated Prefer GET /api/openclaw/models — kept for older clients.
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const state = loadModelStoreState('main')
  const legacy = state.providers.find((p) => p.providerKey === LEGACY_CUSTOM_ID)
  const customModel = legacy
    ? {
        enabled: true,
        provider: legacy.apiProtocol === 'anthropic-messages' && legacy.baseUrl.includes('minimaxi') ? 'minimax' : legacy.apiProtocol === 'anthropic-messages' ? 'anthropic' : legacy.baseUrl.includes('bigmodel.cn') ? 'zhipu' : legacy.baseUrl.includes('api.openai.com') ? 'openai' : 'openai-compatible',
        model: legacy.defaultModelId || legacy.models[0]?.id || '',
        baseUrl: legacy.baseUrl,
        hasApiKey: legacy.hasApiKey,
      }
    : {
        enabled: false,
        provider: 'openai',
        model: '',
        baseUrl: '',
        hasApiKey: false,
      }

  return NextResponse.json({
    configPath: config.openclawConfigPath,
    customModel,
    providerOptions: PROVIDER_OPTIONS,
    modelPresets: MODEL_PRESETS,
    openclawModels: state,
  })
}

/**
 * Legacy single-provider save → persists as `xclaw-custom` via unified store.
 */
export async function PUT(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const enabled = body?.enabled !== false
  const provider = String(body?.provider || '').trim() as ProviderType
  const model = String(body?.model || '').trim()
  const apiKey = String(body?.apiKey || '').trim()
  const baseUrl = String(body?.baseUrl || '').trim()

  if (enabled) {
    if (!['openai', 'anthropic', 'openai-compatible', 'minimax', 'zhipu'].includes(provider)) {
      return NextResponse.json({ error: 'provider is required' }, { status: 400 })
    }
    if (!model) {
      return NextResponse.json({ error: 'model is required' }, { status: 400 })
    }
    if (!apiKey) {
      return NextResponse.json({ error: 'apiKey is required' }, { status: 400 })
    }
    if (provider === 'openai-compatible' && !baseUrl.trim()) {
      return NextResponse.json({ error: 'baseUrl is required for openai-compatible provider' }, { status: 400 })
    }
  } else {
    try {
      const state = deleteProvider(LEGACY_CUSTOM_ID, 'main')
      return NextResponse.json({ ok: true, configPath: config.openclawConfigPath, openclawModels: state })
    } catch {
      const ocPath = config.openclawConfigPath
      if (fs.existsSync(ocPath)) {
        try {
          const raw = fs.readFileSync(ocPath, 'utf8')
          const parsed = JSON.parse(raw)
          if (parsed?.models?.providers?.[LEGACY_CUSTOM_ID]) {
            delete parsed.models.providers[LEGACY_CUSTOM_ID]
            fs.writeFileSync(ocPath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8')
          }
        } catch {
          // ignore
        }
      }
      return NextResponse.json({ ok: true, configPath: config.openclawConfigPath, openclawModels: loadModelStoreState('main') })
    }
  }

  try {
    const state = saveProvider(
      {
        providerKey: LEGACY_CUSTOM_ID,
        displayName: 'Legacy custom (xclaw-custom)',
        apiProtocol: mapLegacyProviderToProtocol(provider),
        baseUrl: legacyDefaultBaseUrl(provider, baseUrl),
        apiKey,
        models: [{ id: model, displayName: model, isDefault: true }],
        defaultModelId: model,
      },
      'main',
    )
    return NextResponse.json({
      ok: true,
      configPath: config.openclawConfigPath,
      openclawModels: state,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Save failed' }, { status: 400 })
  }
}
