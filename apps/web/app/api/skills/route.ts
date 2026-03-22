import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { access, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { constants, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { requireRole } from '@/lib/auth'
import { resolveWithin } from '@/lib/paths'
import { checkSkillSecurity } from '@/lib/skill-registry'

interface SkillSummary {
  id: string
  name: string
  source: string
  path: string
  description?: string
  registry_slug?: string | null
  security_status?: string | null
  /** Shipped with the app under openclaw-runtime/config/skills — not removable via API */
  builtin?: boolean
}

type SkillRoot = { source: string; path: string }

function resolveSkillRoot(
  envName: string,
  fallback: string,
): string {
  const override = process.env[envName]
  return override && override.trim().length > 0 ? override.trim() : fallback
}

async function pathReadable(path: string): Promise<boolean> {
  try {
    await access(path, constants.R_OK)
    return true
  } catch {
    return false
  }
}

/** Strip YAML frontmatter; returns body after closing --- */
function stripSkillFrontmatter(content: string): { yaml: string | null; body: string } {
  const m = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/)
  if (!m) return { yaml: null, body: content }
  return { yaml: m[1], body: content.slice(m[0].length) }
}

/** Parse `description:` from SKILL.md YAML frontmatter (quoted / simple / block |). */
function extractDescriptionFromYaml(yaml: string): string | undefined {
  const dq = yaml.match(/^\s*description:\s*"((?:[^"\\]|\\.)*)"/m)
  if (dq) {
    const text = dq[1].replace(/\\"/g, '"').replace(/\\n/g, '\n')
    return text.length > 220 ? `${text.slice(0, 217)}...` : text
  }
  const sq = yaml.match(/^\s*description:\s*'((?:[^'\\]|\\.)*)'/m)
  if (sq) {
    const text = sq[1].replace(/\\'/g, "'")
    return text.length > 220 ? `${text.slice(0, 217)}...` : text
  }
  const blockPipe = yaml.match(/^\s*description:\s*\|\s*\r?\n((?:[ \t]+[^\r\n]+\r?\n)+)/m)
  if (blockPipe) {
    const text = blockPipe[1]
      .split(/\r?\n/)
      .map((l) => l.replace(/^\s+/, '').trim())
      .filter(Boolean)
      .join(' ')
    if (text) return text.length > 220 ? `${text.slice(0, 217)}...` : text
  }
  const oneLine = yaml.match(/^\s*description:\s*([^"'|>\n][^\n]*)$/m)
  if (oneLine) {
    const text = oneLine[1].trim()
    if (text && text !== '---') return text.length > 220 ? `${text.slice(0, 217)}...` : text
  }
  return undefined
}

/** First readable line from markdown body (skip headings, hr, blockquote lead). */
function extractDescriptionFromBody(body: string): string | undefined {
  const lines = body.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0)
  for (const line of lines) {
    if (line.startsWith('#')) continue
    if (line === '---' || line === '+++') continue
    if (/^[-*_]{3,}$/.test(line)) continue
    let text = line.startsWith('>') ? line.replace(/^>\s*/, '').trim() : line
    if (!text) continue
    return text.length > 220 ? `${text.slice(0, 217)}...` : text
  }
  return undefined
}

async function extractDescription(skillPath: string): Promise<string | undefined> {
  const skillDocPath = join(skillPath, 'SKILL.md')
  if (!(await pathReadable(skillDocPath))) return undefined
  try {
    const content = await readFile(skillDocPath, 'utf8')
    const { yaml, body } = stripSkillFrontmatter(content)
    if (yaml) {
      const fromYaml = extractDescriptionFromYaml(yaml)
      if (fromYaml) return fromYaml
    }
    return extractDescriptionFromBody(body)
  } catch {
    return undefined
  }
}

function normalizeSkillDescription(description?: string | null): string | undefined {
  const d = (description ?? '').trim()
  if (!d || d === '---' || d === '+++') return undefined
  return d
}

async function collectSkillsFromDir(baseDir: string, source: string): Promise<SkillSummary[]> {
  if (!(await pathReadable(baseDir))) return []
  try {
    const entries = await readdir(baseDir, { withFileTypes: true })
    const out: SkillSummary[] = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const skillPath = join(baseDir, entry.name)
      const skillDocPath = join(skillPath, 'SKILL.md')
      if (!(await pathReadable(skillDocPath))) continue
      out.push({
        id: `${source}:${entry.name}`,
        name: entry.name,
        source,
        path: skillPath,
        description: await extractDescription(skillPath),
      })
    }
    return out.sort((a, b) => a.name.localeCompare(b.name))
  } catch {
    return []
  }
}

function resolveXclawBuiltinSkillsDir(): string {
  const env = process.env.MC_SKILLS_XCLAW_BUILTIN_DIR?.trim()
  if (env) return env
  const cwd = process.cwd()
  const candidates = [
    join(cwd, '..', 'desktop', 'openclaw-runtime', 'config', 'skills'),
    join(cwd, 'apps', 'desktop', 'openclaw-runtime', 'config', 'skills'),
  ]
  for (const p of candidates) {
    try {
      if (existsSync(p)) return p
    } catch {
      // ignore
    }
  }
  return candidates[0]
}

function isBuiltinSource(source: string): boolean {
  return source === 'xclaw-builtin'
}

function inferBuiltin(skill: Pick<SkillSummary, 'source' | 'path'>): boolean {
  if (isBuiltinSource(skill.source)) return true
  if (/openclaw-runtime[/\\]config[/\\]skills/i.test(skill.path)) return true
  return false
}

function decorateSkill(skill: SkillSummary): SkillSummary {
  return {
    ...skill,
    builtin: inferBuiltin(skill),
    description: normalizeSkillDescription(skill.description),
  }
}

function sortSkillsBuiltinFirst(skills: SkillSummary[]): SkillSummary[] {
  return [...skills].sort((a, b) => {
    const da = inferBuiltin(a) ? 0 : 1
    const db = inferBuiltin(b) ? 0 : 1
    if (da !== db) return da - db
    return a.name.localeCompare(b.name)
  })
}

function dedupeSkillsByName(skills: SkillSummary[]): SkillSummary[] {
  const ordered = sortSkillsBuiltinFirst(skills)
  const deduped = new Map<string, SkillSummary>()
  for (const skill of ordered) {
    if (!deduped.has(skill.name)) deduped.set(skill.name, decorateSkill(skill))
  }
  return Array.from(deduped.values()).sort((a, b) => a.name.localeCompare(b.name))
}

function getSkillRoots(): SkillRoot[] {
  const home = homedir()
  const cwd = process.cwd()
  const roots: SkillRoot[] = [
    { source: 'user-agents', path: resolveSkillRoot('MC_SKILLS_USER_AGENTS_DIR', join(home, '.agents', 'skills')) },
    { source: 'user-codex', path: resolveSkillRoot('MC_SKILLS_USER_CODEX_DIR', join(home, '.codex', 'skills')) },
    { source: 'project-agents', path: resolveSkillRoot('MC_SKILLS_PROJECT_AGENTS_DIR', join(cwd, '.agents', 'skills')) },
    { source: 'project-codex', path: resolveSkillRoot('MC_SKILLS_PROJECT_CODEX_DIR', join(cwd, '.codex', 'skills')) },
  ]
  roots.push({ source: 'xclaw-builtin', path: resolveXclawBuiltinSkillsDir() })
  // Add OpenClaw gateway skill roots when configured
  const openclawState = process.env.OPENCLAW_STATE_DIR || process.env.OPENCLAW_HOME || join(home, '.openclaw')
  const openclawSkills = resolveSkillRoot('MC_SKILLS_OPENCLAW_DIR', join(openclawState, 'skills'))
  roots.push({ source: 'openclaw', path: openclawSkills })

  // Add OpenClaw workspace-local skills (takes precedence when names conflict)
  const workspaceDir = process.env.OPENCLAW_WORKSPACE_DIR || process.env.XCLAW_WORKSPACE_DIR || join(openclawState, 'workspace')
  const workspaceSkills = resolveSkillRoot('MC_SKILLS_WORKSPACE_DIR', join(workspaceDir, 'skills'))
  roots.push({ source: 'workspace', path: workspaceSkills })

  // Dynamic: scan for workspace-<agent> directories
  try {
    const { readdirSync, existsSync } = require('node:fs') as typeof import('node:fs')
    const entries = readdirSync(openclawState) as string[]
    for (const entry of entries) {
      if (!entry.startsWith('workspace-')) continue
      const skillsDir = join(openclawState, entry, 'skills')
      if (existsSync(skillsDir)) {
        const agentName = entry.replace('workspace-', '')
        roots.push({ source: `workspace-${agentName}`, path: skillsDir })
      }
    }
  } catch {
    // openclawBase may not exist
  }

  return roots
}

function normalizeSkillName(raw: string): string | null {
  const value = raw.trim()
  if (!value) return null
  if (!/^[a-zA-Z0-9._-]+$/.test(value)) return null
  return value
}

function getRootBySource(roots: SkillRoot[], sourceRaw: string | null): SkillRoot | null {
  const source = String(sourceRaw || '').trim()
  if (!source) return null
  return roots.find((r) => r.source === source) || null
}

async function upsertSkill(root: SkillRoot, name: string, content: string) {
  const skillPath = resolveWithin(root.path, name)
  const skillDocPath = resolveWithin(skillPath, 'SKILL.md')
  await mkdir(skillPath, { recursive: true })
  await writeFile(skillDocPath, content, 'utf8')

  // Update DB hash so next sync cycle detects our write
  try {
    const { getDatabase } = await import('@/lib/db')
    const db = getDatabase()
    const hash = createHash('sha256').update(content, 'utf8').digest('hex')
    const now = new Date().toISOString()
    const descLines = content.split('\n').map(l => l.trim()).filter(Boolean)
    const desc = descLines.find(l => !l.startsWith('#'))
    db.prepare(`
      INSERT INTO skills (name, source, path, description, content_hash, installed_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source, name) DO UPDATE SET
        path = excluded.path,
        description = excluded.description,
        content_hash = excluded.content_hash,
        updated_at = excluded.updated_at
    `).run(
      name,
      root.source,
      skillPath,
      desc ? (desc.length > 220 ? `${desc.slice(0, 217)}...` : desc) : null,
      hash,
      now,
      now
    )
  } catch { /* DB not ready yet — sync will catch it */ }

  return { skillPath, skillDocPath }
}

async function deleteSkill(root: SkillRoot, name: string) {
  const skillPath = resolveWithin(root.path, name)
  await rm(skillPath, { recursive: true, force: true })

  // Remove from DB
  try {
    const { getDatabase } = await import('@/lib/db')
    const db = getDatabase()
    db.prepare('DELETE FROM skills WHERE source = ? AND name = ?').run(root.source, name)
  } catch { /* best-effort */ }

  return { skillPath }
}

/**
 * Load skill rows from SQLite for metadata (registry_slug, security_status, etc.).
 * Listing always merges with a filesystem scan — DB alone is incomplete because
 * xclaw-builtin is never synced into the DB by skill-sync, and sync may delete
 * rows when paths diverge; pure DB responses would hide those disk skills.
 */
function getSkillsFromDB(): SkillSummary[] | null {
  try {
    const { getDatabase } = require('@/lib/db')
    const db = getDatabase()
    const rows = db.prepare('SELECT name, source, path, description, registry_slug, security_status FROM skills ORDER BY name').all() as Array<{
      name: string; source: string; path: string; description: string | null; registry_slug: string | null; security_status: string | null
    }>
    return rows.map((r) => ({
      id: `${r.source}:${r.name}`,
      name: r.name,
      source: r.source,
      path: r.path,
      description: r.description || undefined,
      registry_slug: r.registry_slug,
      security_status: r.security_status,
    }))
  } catch {
    return null
  }
}

function skillKey(source: string, name: string): string {
  return `${source}:${name}`
}

/** Overlay DB fields onto filesystem-discovered skills; append DB-only rows (e.g. transient mismatch). */
function mergeFsSkillsWithDbMetadata(fsSkills: SkillSummary[], dbSkills: SkillSummary[] | null): SkillSummary[] {
  if (!dbSkills || dbSkills.length === 0) return fsSkills
  const dbByKey = new Map<string, SkillSummary>()
  for (const s of dbSkills) {
    dbByKey.set(skillKey(s.source, s.name), s)
  }
  const out: SkillSummary[] = []
  const seen = new Set<string>()
  for (const s of fsSkills) {
    const key = skillKey(s.source, s.name)
    seen.add(key)
    const db = dbByKey.get(key)
    if (!db) {
      out.push(s)
      continue
    }
    out.push({
      ...s,
      path: s.path || db.path,
      description: s.description ?? db.description ?? undefined,
      registry_slug: db.registry_slug ?? s.registry_slug,
      security_status: db.security_status ?? s.security_status,
    })
  }
  for (const s of dbSkills) {
    const key = skillKey(s.source, s.name)
    if (!seen.has(key)) out.push(s)
  }
  return out
}

function buildSkillGroups(
  roots: SkillRoot[],
  merged: SkillSummary[],
): Array<{ source: string; path: string; skills: SkillSummary[] }> {
  const groupMap = new Map<string, { source: string; path: string; skills: SkillSummary[] }>()
  for (const root of roots) {
    groupMap.set(root.source, { source: root.source, path: root.path, skills: [] })
  }
  for (const skill of merged) {
    if (!groupMap.has(skill.source) && skill.source.startsWith('workspace-')) {
      groupMap.set(skill.source, { source: skill.source, path: '', skills: [] })
    }
    const group = groupMap.get(skill.source)
    if (group) group.skills.push(skill)
  }
  return Array.from(groupMap.values()).map((g) => ({
    ...g,
    skills: g.skills.map(decorateSkill),
  }))
}

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const roots = getSkillRoots()
  const { searchParams } = new URL(request.url)
  const mode = searchParams.get('mode')

  if (mode === 'content') {
    const source = String(searchParams.get('source') || '')
    const name = normalizeSkillName(String(searchParams.get('name') || ''))
    if (!source || !name) {
      return NextResponse.json({ error: 'source and valid name are required' }, { status: 400 })
    }
    const root = roots.find((r) => r.source === source)
    if (!root) return NextResponse.json({ error: 'Invalid source' }, { status: 400 })
    const skillPath = join(root.path, name)
    const skillDocPath = join(skillPath, 'SKILL.md')
    if (!(await pathReadable(skillDocPath))) {
      return NextResponse.json({ error: 'SKILL.md not found' }, { status: 404 })
    }
    const content = await readFile(skillDocPath, 'utf8')

    // Run security check inline
    const security = checkSkillSecurity(content)

    return NextResponse.json({
      source,
      name,
      skillPath,
      skillDocPath,
      content,
      security,
    })
  }

  if (mode === 'check') {
    // Security-check a specific skill's content
    const source = String(searchParams.get('source') || '')
    const name = normalizeSkillName(String(searchParams.get('name') || ''))
    if (!source || !name) {
      return NextResponse.json({ error: 'source and valid name are required' }, { status: 400 })
    }
    const root = roots.find((r) => r.source === source)
    if (!root) return NextResponse.json({ error: 'Invalid source' }, { status: 400 })
    const skillPath = join(root.path, name)
    const skillDocPath = join(skillPath, 'SKILL.md')
    if (!(await pathReadable(skillDocPath))) {
      return NextResponse.json({ error: 'SKILL.md not found' }, { status: 404 })
    }
    const content = await readFile(skillDocPath, 'utf8')
    const security = checkSkillSecurity(content)

    // Update DB with security status
    try {
      const { getDatabase } = await import('@/lib/db')
      const db = getDatabase()
      db.prepare('UPDATE skills SET security_status = ?, updated_at = ? WHERE source = ? AND name = ?')
        .run(security.status, new Date().toISOString(), source, name)
    } catch { /* best-effort */ }

    return NextResponse.json({ source, name, security })
  }

  // Always scan the filesystem (source of truth for what exists on disk), then merge DB metadata.
  const bySource = await Promise.all(
    roots.map(async (root) => ({
      source: root.source,
      path: root.path,
      skills: await collectSkillsFromDir(root.path, root.source),
    }))
  )

  const allFromFs = bySource.flatMap((group) => group.skills)
  const dbSkills = getSkillsFromDB()
  const merged = mergeFsSkillsWithDbMetadata(allFromFs, dbSkills)
  const list = dedupeSkillsByName(merged)

  return NextResponse.json({
    skills: list,
    groups: buildSkillGroups(roots, merged),
    total: list.length,
  })
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const roots = getSkillRoots()
  const body = await request.json().catch(() => ({}))
  const root = getRootBySource(roots, body?.source)
  const name = normalizeSkillName(String(body?.name || ''))
  const contentRaw = typeof body?.content === 'string' ? body.content : ''
  const content = contentRaw.trim() || `# ${name || 'skill'}\n\nDescribe this skill.\n`

  if (!root || !name) {
    return NextResponse.json({ error: 'Valid source and name are required' }, { status: 400 })
  }
  if (isBuiltinSource(root.source)) {
    return NextResponse.json({ error: '内置技能不可修改或覆盖' }, { status: 403 })
  }

  await mkdir(root.path, { recursive: true })
  const { skillPath, skillDocPath } = await upsertSkill(root, name, content)
  return NextResponse.json({ ok: true, source: root.source, name, skillPath, skillDocPath })
}

export async function PUT(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const roots = getSkillRoots()
  const body = await request.json().catch(() => ({}))
  const root = getRootBySource(roots, body?.source)
  const name = normalizeSkillName(String(body?.name || ''))
  const content = typeof body?.content === 'string' ? body.content : null

  if (!root || !name || content == null) {
    return NextResponse.json({ error: 'Valid source, name, and content are required' }, { status: 400 })
  }
  if (isBuiltinSource(root.source)) {
    return NextResponse.json({ error: '内置技能不可修改' }, { status: 403 })
  }

  await mkdir(root.path, { recursive: true })
  const { skillPath, skillDocPath } = await upsertSkill(root, name, content)
  return NextResponse.json({ ok: true, source: root.source, name, skillPath, skillDocPath })
}

export async function DELETE(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { searchParams } = new URL(request.url)
  const roots = getSkillRoots()
  const root = getRootBySource(roots, searchParams.get('source'))
  const name = normalizeSkillName(String(searchParams.get('name') || ''))
  if (!root || !name) {
    return NextResponse.json({ error: 'Valid source and name are required' }, { status: 400 })
  }
  if (isBuiltinSource(root.source)) {
    return NextResponse.json({ error: '内置技能不可移除' }, { status: 403 })
  }

  const { skillPath } = await deleteSkill(root, name)
  return NextResponse.json({ ok: true, source: root.source, name, skillPath })
}

export const dynamic = 'force-dynamic'
