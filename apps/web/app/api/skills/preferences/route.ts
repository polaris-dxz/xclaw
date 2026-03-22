import { NextRequest, NextResponse } from 'next/server'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { requireRole } from '@/lib/auth'
import { config } from '@/lib/config'
import { getDetectedGatewayToken } from '@/lib/gateway-runtime'
import { resolveWritableOpenClawConfigPath } from '@/lib/openclaw-user-config'

const SKILL_NAME_RE = /^[a-zA-Z0-9._-]+$/

type SkillsEntries = Record<string, { enabled?: boolean; [k: string]: unknown }>

async function tryHotApplyConfig(): Promise<boolean> {
  try {
    const token = getDetectedGatewayToken()
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token) headers.Authorization = `Bearer ${token}`
    const res = await fetch(
      `http://${config.gatewayHost}:${config.gatewayPort}/api/config/apply`,
      { method: 'POST', headers, signal: AbortSignal.timeout(8000) },
    )
    return res.ok
  } catch {
    return false
  }
}

/**
 * GET /api/skills/preferences — read skills.entries from openclaw.json (effective enable map).
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const configPath = resolveWritableOpenClawConfigPath()
  try {
    const raw = await readFile(configPath, 'utf8')
    const parsed = JSON.parse(raw) as { skills?: { entries?: SkillsEntries } }
    const entries = parsed?.skills?.entries && typeof parsed.skills.entries === 'object'
      ? parsed.skills.entries
      : {}
    return NextResponse.json({
      path: configPath,
      entries,
      missing: false,
    })
  } catch (err: unknown) {
    const code = err && typeof err === 'object' && 'code' in err ? String((err as NodeJS.ErrnoException).code) : ''
    if (code === 'ENOENT') {
      return NextResponse.json({
        path: configPath,
        entries: {} as SkillsEntries,
        missing: true,
        hint: '尚未生成 openclaw.json（请先启动 xclaw / OpenClaw 一次）',
      })
    }
    return NextResponse.json({ error: `读取配置失败: ${err instanceof Error ? err.message : String(err)}` }, { status: 500 })
  }
}

/**
 * PUT /api/skills/preferences — set skills.entries.<name>.enabled (persists to openclaw.json).
 * Body: { name: string, enabled: boolean }
 */
export async function PUT(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  let body: { name?: string; enabled?: boolean }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  if (!name || !SKILL_NAME_RE.test(name)) {
    return NextResponse.json({ error: '无效的 skill name' }, { status: 400 })
  }
  if (typeof body.enabled !== 'boolean') {
    return NextResponse.json({ error: 'enabled 必须为 boolean' }, { status: 400 })
  }

  const configPath = resolveWritableOpenClawConfigPath()

  let parsed: Record<string, unknown>
  try {
    const raw = await readFile(configPath, 'utf8')
    parsed = JSON.parse(raw) as Record<string, unknown>
  } catch (err: unknown) {
    const code = err && typeof err === 'object' && 'code' in err ? String((err as NodeJS.ErrnoException).code) : ''
    if (code === 'ENOENT') {
      return NextResponse.json(
        {
          error: 'openclaw.json 不存在，请先启动桌面端生成配置后再试',
          path: configPath,
        },
        { status: 404 },
      )
    }
    return NextResponse.json({ error: `读取配置失败: ${err instanceof Error ? err.message : String(err)}` }, { status: 500 })
  }

  if (!parsed.skills || typeof parsed.skills !== 'object' || Array.isArray(parsed.skills)) {
    parsed.skills = {}
  }
  const skills = parsed.skills as { entries?: SkillsEntries; load?: unknown; [k: string]: unknown }
  if (!skills.entries || typeof skills.entries !== 'object' || Array.isArray(skills.entries)) {
    skills.entries = {}
  }

  const prev = skills.entries[name] && typeof skills.entries[name] === 'object' && !Array.isArray(skills.entries[name])
    ? { ...(skills.entries[name] as object) }
    : {}
  skills.entries[name] = { ...prev, enabled: body.enabled }

  const newRaw = JSON.stringify(parsed, null, 2) + '\n'
  try {
    await mkdir(path.dirname(configPath), { recursive: true })
    await writeFile(configPath, newRaw, 'utf8')
  } catch (err: unknown) {
    return NextResponse.json(
      { error: `写入配置失败: ${err instanceof Error ? err.message : String(err)}`, path: configPath },
      { status: 500 },
    )
  }

  const applied = await tryHotApplyConfig()

  return NextResponse.json({
    ok: true,
    path: configPath,
    name,
    enabled: body.enabled,
    hotApply: applied,
  })
}

export const dynamic = 'force-dynamic'
