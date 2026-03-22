/**
 * Server-only: read/write ~/.xclaw OpenClaw model files (uses node:fs).
 * Import from API routes only — client code must use `openclaw-model-shared.ts`.
 */
import fs from 'node:fs'
import path from 'node:path'
import { config } from '@/lib/config'
import {
  LEGACY_CUSTOM_ID,
  MANAGED_PREFIX,
  SaveProviderInput,
  buildProviderBlockFromInput,
  isValidProviderKey,
  normalizeProviderKey,
  parseApiProtocolFromStored,
} from '@/lib/openclaw-model-shared'

export * from '@/lib/openclaw-model-shared'

export interface OpenClawPaths {
  openclawConfig: string
  agentDir: string
  modelsJson: string
  modelJson: string
  authProfiles: string
}

export function resolveOpenClawPaths(agentId = 'main'): OpenClawPaths {
  const state = config.openclawStateDir || path.join(config.homeDir, '.xclaw')
  const agentDir = path.join(state, 'agents', agentId, 'agent')
  return {
    openclawConfig: config.openclawConfigPath,
    agentDir,
    modelsJson: path.join(agentDir, 'models.json'),
    modelJson: path.join(agentDir, 'model.json'),
    authProfiles: path.join(agentDir, 'auth-profiles.json'),
  }
}

function readJson(path: string): any {
  try {
    if (!fs.existsSync(path)) return null
    const raw = fs.readFileSync(path, 'utf8')
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

function writeJsonAtomic(filePath: string, data: unknown) {
  const dir = path.dirname(filePath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
  fs.renameSync(tmp, filePath)
}

function getManagedKeys(oc: any): Set<string> {
  const s = new Set<string>()
  const list = oc?.xclaw?.managedProviderKeys
  if (Array.isArray(list)) {
    for (const k of list) {
      if (typeof k === 'string' && k.trim()) s.add(k.trim())
    }
  }
  if (oc?.models?.providers?.[LEGACY_CUSTOM_ID]) {
    s.add(LEGACY_CUSTOM_ID)
  }
  return s
}

function setManagedKeys(oc: any, keys: Set<string>) {
  if (!oc.xclaw || typeof oc.xclaw !== 'object') oc.xclaw = {}
  oc.xclaw.managedProviderKeys = Array.from(keys).sort()
}

function pickSafeProvider(pid: string, p: any, primaryFull: string) {
  const models = Array.isArray(p?.models) ? p.models : []
  let defaultModelId = ''
  if (primaryFull.startsWith(`${pid}/`)) {
    defaultModelId = primaryFull.slice(pid.length + 1)
  } else {
    defaultModelId = String(models[0]?.id || '')
  }
  return {
    providerKey: pid,
    displayName: String(p?.name || p?.displayName || pid),
    notes: typeof p?.notes === 'string' ? p.notes : '',
    websiteUrl: typeof p?.website === 'string' ? p.website : typeof p?.websiteUrl === 'string' ? p.websiteUrl : '',
    apiProtocol: parseApiProtocolFromStored(p?.api),
    baseUrl: String(p?.baseUrl || ''),
    hasApiKey:
      Boolean(String(p?.apiKey || '').trim()) ||
      String(p?.auth || '').toLowerCase() === 'aws-sdk',
    sendUserAgent: Boolean(p?.sendUserAgent),
    models: models.map((m: any) => ({
      id: String(m?.id || ''),
      displayName: String(m?.name || m?.id || ''),
      reasoning: Boolean(m?.reasoning),
      inputTypes: Array.isArray(m?.input) ? m.input : ['text'],
      contextWindow: Number(m?.contextWindow) || 0,
      maxTokens: Number(m?.maxTokens) || 0,
      cost: m?.cost || { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    })),
    defaultModelId: String(defaultModelId || ''),
    xclawManaged: false,
  }
}

export function enumerateChatModelRefs(oc: any): Array<{ ref: string; label: string }> {
  const out: Array<{ ref: string; label: string }> = []
  const providers = oc?.models?.providers
  if (providers && typeof providers === 'object') {
    for (const [pid, raw] of Object.entries(providers)) {
      const p = raw as any
      const models = Array.isArray(p?.models) ? p.models : []
      if (models.length === 0) continue
      for (const m of models) {
        const id = String(m?.id || '').trim()
        if (!id) continue
        const name = String(m?.name || id).trim()
        out.push({ ref: `${pid}/${id}`, label: `${name} (${pid})` })
      }
    }
  }
  const primary = String(oc?.agents?.defaults?.model?.primary || '').trim()
  if (primary && !out.some((o) => o.ref === primary)) {
    out.push({ ref: primary, label: primary })
  }
  const seen = new Set<string>()
  return out.filter((o) => {
    if (seen.has(o.ref)) return false
    seen.add(o.ref)
    return true
  })
}

export function loadModelStoreState(agentId = 'main') {
  const paths = resolveOpenClawPaths(agentId)
  const oc = readJson(paths.openclawConfig) || {}
  if (!oc.agents || typeof oc.agents !== 'object') oc.agents = {}
  if (!oc.agents.defaults || typeof oc.agents.defaults !== 'object') oc.agents.defaults = {}
  if (!oc.agents.defaults.model || typeof oc.agents.defaults.model !== 'object') oc.agents.defaults.model = {}

  const managed = getManagedKeys(oc)
  const primaryFull = String(oc?.agents?.defaults?.model?.primary || '').trim()
  const providersRaw = oc?.models?.providers && typeof oc.models.providers === 'object' ? oc.models.providers : {}
  const providers: any[] = []
  for (const pid of Object.keys(providersRaw)) {
    const p = (providersRaw as any)[pid]
    if (!p || typeof p !== 'object') continue
    const safe = pickSafeProvider(pid, p, primaryFull)
    safe.xclawManaged = managed.has(pid) || pid.startsWith(MANAGED_PREFIX) || pid === LEGACY_CUSTOM_ID
    providers.push(safe)
  }

  const primary = String(oc.agents.defaults.model.primary || '').trim() || null
  const fallbacks = Array.isArray(oc.agents.defaults.model.fallbacks)
    ? (oc.agents.defaults.model.fallbacks as string[]).filter((x) => typeof x === 'string')
    : []

  const chatOptions = [
    { ref: 'default', label: '跟随系统默认' },
    ...enumerateChatModelRefs(oc),
  ]

  return {
    paths,
    primary,
    fallbacks,
    providers,
    managedProviderKeys: Array.from(managed),
    chatOptions,
    rawOpenclaw: oc,
  }
}

function syncAuthProfile(auth: any, providerKey: string, apiKey: string | undefined) {
  if (!auth || typeof auth !== 'object') auth = { version: 1, profiles: {} }
  if (!auth.profiles || typeof auth.profiles !== 'object') auth.profiles = {}
  const profileId = `${providerKey}:default`
  if (apiKey && apiKey.trim()) {
    auth.profiles[profileId] = {
      type: 'api_key',
      provider: providerKey,
      key: apiKey.trim(),
    }
    if (!auth.lastGood || typeof auth.lastGood !== 'object') auth.lastGood = {}
    auth.lastGood[providerKey] = profileId
  }
  return auth
}

function removeAuthProfile(auth: any, providerKey: string) {
  if (!auth?.profiles || typeof auth.profiles !== 'object') return auth
  const profileId = `${providerKey}:default`
  delete auth.profiles[profileId]
  if (auth.lastGood && typeof auth.lastGood === 'object') {
    delete auth.lastGood[providerKey]
  }
  return auth
}

function writeAgentModelFiles(paths: OpenClawPaths, oc: any) {
  const providers = oc?.models?.providers && typeof oc.models.providers === 'object' ? oc.models.providers : {}
  const modelsJson = {
    version: 1,
    providers: JSON.parse(JSON.stringify(providers)),
  }
  writeJsonAtomic(paths.modelsJson, modelsJson)

  const primary = String(oc?.agents?.defaults?.model?.primary || '').trim()
  const fallbacks = Array.isArray(oc?.agents?.defaults?.model?.fallbacks)
    ? oc.agents.defaults.model.fallbacks
    : []
  const modelJson = {
    version: 1,
    primary: primary || '',
    fallbacks,
  }
  writeJsonAtomic(paths.modelJson, modelJson)
}

export function saveProvider(input: SaveProviderInput, agentId = 'main') {
  const paths = resolveOpenClawPaths(agentId)
  const oc = readJson(paths.openclawConfig) || {}
  const pk = normalizeProviderKey(input.providerKey)
  if (!isValidProviderKey(pk)) {
    throw new Error('Invalid provider key (lowercase letters, numbers, hyphens; must start with a letter)')
  }

  const { block, primaryModelId } = buildProviderBlockFromInput({ ...input, providerKey: pk })
  if (!primaryModelId) {
    throw new Error('At least one model with a valid id is required')
  }

  if (!oc.models || typeof oc.models !== 'object') oc.models = {}
  if (!oc.models.providers || typeof oc.models.providers !== 'object') oc.models.providers = {}
  oc.models.mode = 'merge'

  const existing = (oc.models.providers as any)[pk]
  const existingKey = existing && typeof existing === 'object' ? String((existing as any).apiKey || '').trim() : ''
  const newKey = String(input.apiKey || '').trim()
  const usesAwsSdk = input.apiProtocol === 'bedrock-converse-stream'
  if (!existing && !newKey && !usesAwsSdk) {
    throw new Error('apiKey is required for a new provider')
  }
  if (!usesAwsSdk && !newKey && existingKey) {
    ;(block as any).apiKey = existingKey
  }

  ;(oc.models.providers as any)[pk] = block

  const managed = getManagedKeys(oc)
  managed.add(pk)
  setManagedKeys(oc, managed)

  const primaryRef = `${pk}/${primaryModelId}`
  oc.agents.defaults.model.primary = primaryRef

  writeJsonAtomic(paths.openclawConfig, oc)

  let auth = readJson(paths.authProfiles) || { version: 1, profiles: {} }
  if (usesAwsSdk) {
    auth = removeAuthProfile(auth, pk)
    writeJsonAtomic(paths.authProfiles, auth)
  } else if (newKey || !existing) {
    auth = syncAuthProfile(auth, pk, newKey || existingKey)
    writeJsonAtomic(paths.authProfiles, auth)
  }

  writeAgentModelFiles(paths, oc)
  return loadModelStoreState(agentId)
}

export function deleteProvider(providerKey: string, agentId = 'main') {
  const pk = normalizeProviderKey(providerKey)
  const paths = resolveOpenClawPaths(agentId)
  const oc = readJson(paths.openclawConfig) || {}
  const managed = getManagedKeys(oc)
  const canDelete = managed.has(pk) || pk.startsWith(MANAGED_PREFIX) || pk === LEGACY_CUSTOM_ID
  if (!canDelete) {
    throw new Error('Only XClaw-managed custom providers can be deleted from this UI')
  }
  if (oc.models?.providers && typeof oc.models.providers === 'object') {
    delete (oc.models.providers as any)[pk]
  }
  managed.delete(pk)
  setManagedKeys(oc, managed)

  const cur = String(oc?.agents?.defaults?.model?.primary || '').trim()
  if (cur.startsWith(`${pk}/`)) {
    delete oc.agents.defaults.model.primary
  }

  writeJsonAtomic(paths.openclawConfig, oc)

  let auth = readJson(paths.authProfiles) || { version: 1, profiles: {} }
  auth = removeAuthProfile(auth, pk)
  writeJsonAtomic(paths.authProfiles, auth)

  writeAgentModelFiles(paths, oc)
  return loadModelStoreState(agentId)
}

export function setPrimaryModel(primary: string | null, agentId = 'main') {
  const paths = resolveOpenClawPaths(agentId)
  const oc = readJson(paths.openclawConfig) || {}
  if (!oc.agents?.defaults) oc.agents = { defaults: {} }
  if (!oc.agents.defaults.model || typeof oc.agents.defaults.model !== 'object') oc.agents.defaults.model = {}

  const p = primary != null && String(primary).trim() ? String(primary).trim() : ''
  if (!p || p === 'default') {
    delete oc.agents.defaults.model.primary
  } else {
    oc.agents.defaults.model.primary = p
  }

  writeJsonAtomic(paths.openclawConfig, oc)
  writeAgentModelFiles(paths, oc)
  return loadModelStoreState(agentId)
}
