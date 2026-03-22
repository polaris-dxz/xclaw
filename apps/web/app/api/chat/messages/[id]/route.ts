import { NextRequest, NextResponse } from 'next/server'
import { getDatabase, Message } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { eventBus } from '@/lib/event-bus'
import { mergeUserFeedbackMetadata } from '@/lib/chat-message-feedback'

function safeParseMetadata(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as unknown
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/**
 * GET /api/chat/messages/[id] - Get a single message
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const { id } = await params
    const workspaceId = auth.user.workspace_id ?? 1

    const message = db
      .prepare('SELECT * FROM messages WHERE id = ? AND workspace_id = ?')
      .get(parseInt(id), workspaceId) as Message | undefined

    if (!message) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 })
    }

    return NextResponse.json({
      message: {
        ...message,
        metadata: message.metadata ? JSON.parse(message.metadata) : null
      }
    })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/chat/messages/[id] error')
    return NextResponse.json({ error: 'Failed to fetch message' }, { status: 500 })
  }
}

/**
 * PATCH /api/chat/messages/[id] - Mark message as read；合并 metadata（点赞/点踩等）
 * Body: { read?: boolean; feedback?: 'up' | 'down' | null; feedbackReason?: string }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const { id } = await params
    const messageId = parseInt(id, 10)
    const workspaceId = auth.user.workspace_id ?? 1
    const body = (await request.json()) as {
      read?: boolean
      feedback?: 'up' | 'down' | null
      feedbackReason?: string
    }

    const message = db
      .prepare('SELECT * FROM messages WHERE id = ? AND workspace_id = ?')
      .get(messageId, workspaceId) as Message | undefined

    if (!message) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 })
    }

    if (body.read) {
      const now = Math.floor(Date.now() / 1000)
      db.prepare('UPDATE messages SET read_at = ? WHERE id = ? AND workspace_id = ?').run(now, messageId, workspaceId)
    }

    if ('feedback' in body) {
      const fb = body.feedback
      if (fb !== null && fb !== 'up' && fb !== 'down') {
        return NextResponse.json({ error: 'Invalid feedback' }, { status: 400 })
      }
      if (fb === 'down') {
        const reason = String(body.feedbackReason ?? '').trim()
        if (!reason) {
          return NextResponse.json({ error: '点踩需要填写原因' }, { status: 400 })
        }
        if (reason.length > 5000) {
          return NextResponse.json({ error: '原因过长' }, { status: 400 })
        }
      }
      const nowSec = Math.floor(Date.now() / 1000)
      const prevMeta = safeParseMetadata(message.metadata)
      const nextMeta = mergeUserFeedbackMetadata(prevMeta, {
        feedback: fb,
        feedbackReason: body.feedbackReason,
      }, nowSec)
      db.prepare('UPDATE messages SET metadata = ? WHERE id = ? AND workspace_id = ?').run(
        JSON.stringify(nextMeta),
        messageId,
        workspaceId,
      )
    }

    const updated = db
      .prepare('SELECT * FROM messages WHERE id = ? AND workspace_id = ?')
      .get(messageId, workspaceId) as Message

    const parsedMeta = updated.metadata ? JSON.parse(updated.metadata) : null

    if ('feedback' in body) {
      eventBus.broadcast('chat.message', {
        ...updated,
        metadata: parsedMeta,
      })
    }

    return NextResponse.json({
      message: {
        ...updated,
        metadata: parsedMeta,
      }
    })
  } catch (error) {
    logger.error({ err: error }, 'PATCH /api/chat/messages/[id] error')
    return NextResponse.json({ error: 'Failed to update message' }, { status: 500 })
  }
}
