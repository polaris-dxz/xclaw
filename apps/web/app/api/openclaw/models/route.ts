import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import {
  deleteProvider,
  isKnownApiProtocol,
  loadModelStoreState,
  saveProvider,
  setPrimaryModel,
  type SaveProviderInput,
} from '@/lib/openclaw-model-store'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const state = loadModelStoreState('main')
    return NextResponse.json(state)
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to load model config' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  let body: Partial<SaveProviderInput>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body?.providerKey || !body?.apiProtocol || !body?.baseUrl) {
    return NextResponse.json({ error: 'providerKey, apiProtocol, and baseUrl are required' }, { status: 400 })
  }
  if (!isKnownApiProtocol(String(body.apiProtocol))) {
    return NextResponse.json({ error: 'apiProtocol is not supported' }, { status: 400 })
  }
  if (!Array.isArray(body.models) || body.models.length === 0) {
    return NextResponse.json({ error: 'At least one model entry is required' }, { status: 400 })
  }
  const defaultModelId = String(body.defaultModelId || '').trim()
  if (!defaultModelId) {
    return NextResponse.json({ error: 'defaultModelId is required' }, { status: 400 })
  }
  const modelIds = body.models.map((m) => String(m?.id || '').trim()).filter(Boolean)
  if (!modelIds.includes(defaultModelId)) {
    return NextResponse.json({ error: 'defaultModelId must match one of the model ids' }, { status: 400 })
  }

  try {
    const state = saveProvider(body as SaveProviderInput, 'main')
    return NextResponse.json({ ok: true, ...state })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Save failed' }, { status: 400 })
  }
}

export async function PATCH(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  let body: { primary?: string | null }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  try {
    const state = setPrimaryModel(body?.primary ?? null, 'main')
    return NextResponse.json({ ok: true, ...state })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Update failed' }, { status: 400 })
  }
}

export async function DELETE(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  const providerKey = request.nextUrl.searchParams.get('providerKey')?.trim()
  if (!providerKey) {
    return NextResponse.json({ error: 'providerKey query parameter is required' }, { status: 400 })
  }

  try {
    const state = deleteProvider(providerKey, 'main')
    return NextResponse.json({ ok: true, ...state })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Delete failed' }, { status: 400 })
  }
}
