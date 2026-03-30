import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { logger } from '@/lib/logger'

const promptPartSchema = z.object({
  text: z.string(),
  highlight: z.boolean().optional(),
})

const inspirationItemSchema = z.object({
  id: z.string().min(1).max(128),
  categoryId: z.string().min(1).max(64),
  icon: z.string().min(1).max(16),
  title: z.string().min(1).max(120),
  subtitle: z.string().max(240),
  scenarios: z.array(z.string().min(1).max(280)).min(1).max(12),
  promptParts: z.array(promptPartSchema).min(1).max(24),
  promptExtraParts: z.array(promptPartSchema).max(24).optional(),
})

function mapRowToItem(row: any) {
  const scenarios = typeof row.scenarios === 'string' ? JSON.parse(row.scenarios) : []
  const promptParts = typeof row.prompt_parts === 'string' ? JSON.parse(row.prompt_parts) : []
  const promptExtraParts = typeof row.prompt_extra_parts === 'string' ? JSON.parse(row.prompt_extra_parts) : undefined
  return {
    id: String(row.id),
    categoryId: String(row.category_id),
    icon: String(row.icon),
    title: String(row.title),
    subtitle: String(row.subtitle || ''),
    scenarios: Array.isArray(scenarios) ? scenarios : [],
    promptParts: Array.isArray(promptParts) ? promptParts : [],
    ...(Array.isArray(promptExtraParts) && promptExtraParts.length ? { promptExtraParts } : {}),
  }
}

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const rows = db
      .prepare(
        `SELECT id, category_id, icon, title, subtitle, scenarios, prompt_parts, prompt_extra_parts
         FROM inspiration_items
         WHERE workspace_id = ?
         ORDER BY updated_at DESC`,
      )
      .all(workspaceId) as any[]

    return NextResponse.json({ items: rows.map(mapRowToItem) })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/inspirations error')
    return NextResponse.json({ error: 'Failed to load inspirations' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const body = await request.json().catch(() => ({}))
    const parsed = inspirationItemSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid inspiration item', issues: parsed.error.issues }, { status: 400 })
    }

    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const now = Math.floor(Date.now() / 1000)
    const item = parsed.data

    db.prepare(
      `INSERT INTO inspiration_items (
        id, workspace_id, category_id, icon, title, subtitle, scenarios, prompt_parts, prompt_extra_parts, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        category_id = excluded.category_id,
        icon = excluded.icon,
        title = excluded.title,
        subtitle = excluded.subtitle,
        scenarios = excluded.scenarios,
        prompt_parts = excluded.prompt_parts,
        prompt_extra_parts = excluded.prompt_extra_parts,
        updated_at = excluded.updated_at`,
    ).run(
      item.id,
      workspaceId,
      item.categoryId,
      item.icon,
      item.title,
      item.subtitle,
      JSON.stringify(item.scenarios),
      JSON.stringify(item.promptParts),
      item.promptExtraParts ? JSON.stringify(item.promptExtraParts) : null,
      auth.user.username,
      now,
      now,
    )

    return NextResponse.json({ ok: true, item })
  } catch (error) {
    logger.error({ err: error }, 'POST /api/inspirations error')
    return NextResponse.json({ error: 'Failed to save inspiration' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const url = new URL(request.url)
    const id = url.searchParams.get('id')?.trim() || ''
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    db.prepare('DELETE FROM inspiration_items WHERE id = ? AND workspace_id = ?').run(id, workspaceId)
    return NextResponse.json({ ok: true })
  } catch (error) {
    logger.error({ err: error }, 'DELETE /api/inspirations error')
    return NextResponse.json({ error: 'Failed to delete inspiration' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'

