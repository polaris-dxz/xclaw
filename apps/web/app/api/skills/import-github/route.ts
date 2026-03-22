import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'

function githubBlobToRaw(url: URL): string | null {
  const parts = url.pathname.split('/').filter(Boolean)
  const blobIdx = parts.indexOf('blob')
  if (blobIdx < 3 || blobIdx + 2 >= parts.length) return null
  const owner = parts[0]
  const repo = parts[1]
  const branch = parts[blobIdx + 1]
  const rest = parts.slice(blobIdx + 2).join('/')
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${rest}`
}

function resolveFetchUrl(input: string): string | null {
  const t = input.trim()
  if (!t) return null
  try {
    const u = new URL(t)
    if (u.hostname === 'raw.githubusercontent.com') return t
    if (u.hostname === 'github.com') {
      const raw = githubBlobToRaw(u)
      if (raw) return raw
    }
    return null
  } catch {
    return null
  }
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const body = await request.json().catch(() => ({}))
  const url = typeof body?.url === 'string' ? body.url.trim() : ''
  const fetchUrl = resolveFetchUrl(url)
  if (!fetchUrl) {
    return NextResponse.json(
      { error: '请粘贴 GitHub 上 SKILL.md 的 raw 链接，或 github.com 上文件的浏览页链接（将自动转为 raw）' },
      { status: 400 },
    )
  }

  const res = await fetch(fetchUrl, { cache: 'no-store', signal: AbortSignal.timeout(20000) })
  if (!res.ok) {
    return NextResponse.json({ error: `无法拉取文件: HTTP ${res.status}` }, { status: 422 })
  }
  const content = await res.text()
  if (!content.length || content.length > 2_000_000) {
    return NextResponse.json({ error: '文件内容无效或过大' }, { status: 400 })
  }

  let name = typeof body?.name === 'string' ? body.name.trim() : ''
  const fm = content.match(/^---\s*\n([\s\S]*?)\n---/)
  if (fm) {
    const nm = fm[1].match(/^\s*name:\s*(.+)$/m)
    if (nm) name = name || nm[1].trim().replace(/^["']|["']$/g, '')
  }
  if (!name) {
    const pathMatch = fetchUrl.match(/\/([^/]+)\/SKILL\.md$/i)
    name = pathMatch ? pathMatch[1] : ''
  }
  if (!name || !/^[a-zA-Z0-9._-]+$/.test(name)) {
    return NextResponse.json(
      { error: '无法解析技能名称，请填写 name 参数，或在 SKILL.md  frontmatter 中提供 name 字段' },
      { status: 400 },
    )
  }

  return NextResponse.json({ ok: true, name, content, fetchUrl })
}

export const dynamic = 'force-dynamic'
