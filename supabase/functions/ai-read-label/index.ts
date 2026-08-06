// ai-read-label — læser en pakkelabel (foto) med kundens valgte AI-model og
// returnerer strukturerede felter til modtagelses-formularen.
//
// Browseren/appen er utroværdig (se CLAUDE.md): funktionen udleder kalderens
// virksomhed server-side, genchecker at platformen udbyder AI, at kundens valg
// ligger inden for platformens udvalg, og at modellen kan læse billeder — og
// først derefter kaldes udbyderen med DCA's API-nøgle (edge-secret, aldrig i
// databasen eller klienten). Kataloget her skal holdes i sync med
// web/src/lib/ai.ts og check-constraints i 20260806163530_ai_integration.sql.

import { createClient } from 'jsr:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

// Spejl af web/src/lib/ai.ts — model → udbyder + vision-egenskab.
const MODELS: Record<string, { provider: string; vision: boolean }> = {
  'claude-haiku-4-5': { provider: 'anthropic', vision: true },
  'claude-sonnet-5': { provider: 'anthropic', vision: true },
  'claude-opus-5': { provider: 'anthropic', vision: true },
  'claude-fable-5': { provider: 'anthropic', vision: true },
  'gemini-3.6-flash': { provider: 'google', vision: true },
  'gemini-3.5-flash': { provider: 'google', vision: true },
  'gemini-3.5-flash-lite': { provider: 'google', vision: true },
  'gemini-3.1-flash-lite': { provider: 'google', vision: true },
  'gemini-3-flash-preview': { provider: 'google', vision: true },
  'deepseek-chat': { provider: 'deepseek', vision: false },
  'deepseek-reasoner': { provider: 'deepseek', vision: false },
}

// Felterne modtagelses-formularen kan udfylde. Alle nullable — modellen skal
// hellere svare null end gætte. Skemaet håndhæves af structured outputs, så
// svaret altid kan JSON.parses uden hegn-strip eller retry.
const LABEL_SCHEMA = {
  type: 'object',
  properties: {
    receiver_name: { type: ['string', 'null'] },
    receiver_address: { type: ['string', 'null'] },
    receiver_phone: { type: ['string', 'null'] },
    sender_name: { type: ['string', 'null'] },
    sender_address: { type: ['string', 'null'] },
    sender_phone: { type: ['string', 'null'] },
    carrier: { type: ['string', 'null'] },
    service: { type: ['string', 'null'] },
    tracking_number: { type: ['string', 'null'] },
    reference: { type: ['string', 'null'] },
    weight_kg: { type: ['number', 'null'] },
    label_date: { type: ['string', 'null'] },
  },
  required: [
    'receiver_name', 'receiver_address', 'receiver_phone',
    'sender_name', 'sender_address', 'sender_phone',
    'carrier', 'service', 'tracking_number', 'reference',
    'weight_kg', 'label_date',
  ],
  additionalProperties: false,
} as const

const PROMPT = `Læs pakkelabelen på billedet og udfyld felterne.
Regler:
- Svar null for felter der ikke fremgår tydeligt — gæt aldrig.
- receiver_* er modtageren ("To"/"Til"/"Modtager"); sender_* er afsenderen ("From"/"Fra"). Byt dem aldrig om.
- receiver_address/sender_address: fuld adresse på én linje (vej, postnr., by).
- carrier: transportøren (fx PostNord, GLS, DAO, UPS, DHL, Bring) — udled evt. fra logo eller label-layout.
- service: serviceproduktet (fx Erhvervspakke, MyPack Home, MyPack Collect).
- tracking_number: pakkens sporingsnummer — typisk det lange tal under stregkoden mærket Shipment ID / Parcel-ID / Shipment Item ID. Udelad en foranstillet "(00)"-præfiks og mellemrum.
- weight_kg: vægt i kg som tal (dansk komma → punktum).
- label_date: labelens dato som YYYY-MM-DD hvis muligt.`

type Body = { image?: string; mediaType?: string; companyId?: string }

const IMAGE_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

/** Fejl med maskin-læsbar årsag som UI'et kan oversætte. */
class ProviderError extends Error {
  constructor(readonly reason: string, detail?: string) {
    super(detail ?? reason)
  }
}

function reasonFromStatus(status?: number): string {
  if (status === 401 || status === 403) return 'provider_auth'
  if (status === 429) return 'rate_limited'
  if (status === 400) return 'provider_rejected'
  if (status && status >= 500) return 'provider_down'
  return 'provider_error'
}

// SDK'en hentes først når Anthropic faktisk skal bruges. Som top-level import
// betalte *alle* kald (også Gemini-kundernes) for npm-modulets opstart, og en
// kold isolate kunne nå wall clock-loftet og blive dræbt før udbyder-kaldet —
// hvilket kun viste sig som en generisk fejl i UI'et.
async function readWithAnthropic(
  model: string,
  mediaType: string,
  image: string,
): Promise<unknown> {
  const apiKey = Deno.env.get('CLAUDE_API')
  if (!apiKey) throw new ProviderError('provider_key_missing')
  const { default: Anthropic } = await import('npm:@anthropic-ai/sdk')
  const anthropic = new Anthropic({ apiKey })
  let response
  try {
    response = await anthropic.messages.create({
      model,
      max_tokens: 1024,
      output_config: {
        format: { type: 'json_schema', schema: LABEL_SCHEMA },
      },
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: image },
            },
            { type: 'text', text: PROMPT },
          ],
        },
      ],
    })
  } catch (e) {
    const status = (e as { status?: number }).status
    throw new ProviderError(reasonFromStatus(status), e instanceof Error ? e.message : String(e))
  }
  if (response.stop_reason === 'refusal') throw new ProviderError('refused')
  if (response.stop_reason === 'max_tokens') throw new ProviderError('truncated')
  const text = response.content.find((b) => b.type === 'text')?.text
  if (!text) throw new ProviderError('empty_response')
  return JSON.parse(text)
}

// Gemini via det klassiske generateContent-endepunkt + response_json_schema —
// verificeret mod API'et 2026-08-06 (begge Flash-modeller, samme skema).
async function readWithGemini(model: string, mediaType: string, image: string): Promise<unknown> {
  const apiKey = Deno.env.get('GEMINI_API')
  if (!apiKey) throw new ProviderError('provider_key_missing')
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { inline_data: { mime_type: mediaType, data: image } },
              { text: PROMPT },
            ],
          },
        ],
        generationConfig: {
          response_mime_type: 'application/json',
          response_json_schema: LABEL_SCHEMA,
        },
      }),
    },
  )
  if (!res.ok) {
    throw new ProviderError(reasonFromStatus(res.status), (await res.text()).slice(0, 500))
  }
  const data = await res.json()
  const candidate = data.candidates?.[0]
  // Intet kandidat-svar = prompten/billedet blev blokeret af sikkerhedsfiltre.
  if (!candidate) throw new ProviderError('refused', data.promptFeedback?.blockReason)
  if (candidate.finishReason === 'MAX_TOKENS') throw new ProviderError('truncated')
  if (candidate.finishReason && candidate.finishReason !== 'STOP') {
    throw new ProviderError('refused', candidate.finishReason)
  }
  const text = (candidate.content?.parts ?? [])
    .map((p: { text?: string }) => p.text ?? '')
    .join('')
  if (!text) throw new ProviderError('empty_response')
  return JSON.parse(text)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const authHeader = req.headers.get('Authorization') ?? ''
  const asCaller = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } })
  const { data: userData, error: userErr } = await asCaller.auth.getUser()
  if (userErr || !userData.user) return json({ error: 'unauthorized' }, 401)

  const body = (await req.json().catch(() => ({}))) as Body
  const image = (body.image ?? '').trim()
  const mediaType = body.mediaType ?? 'image/jpeg'
  if (!image) return json({ error: 'image_required' }, 400)
  if (!IMAGE_MEDIA_TYPES.includes(mediaType)) return json({ error: 'unsupported_media_type' }, 400)
  // Håndterminalen nedskalerer til ≤1600 px JPEG; alt væsentligt større er
  // ikke vores klient. Base64 er ~4/3 af råstørrelsen — loftet svarer til ~6 MB.
  if (image.length > 8_000_000) return json({ error: 'image_too_large' }, 413)

  // Virksomheden udledes af kalderen — aldrig af request-body'en for
  // kunde-brugere.
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })
  const { data: appUser } = await admin
    .from('app_users')
    .select('company_id')
    .eq('user_id', userData.user.id)
    .maybeSingle()
  let companyId = appUser?.company_id

  // Platform-admins (DCA-ansatte) har ingen app_users-række og dermed ingen
  // egen virksomhed — de arbejder i den kunde, de har valgt i UI'et. Kun her
  // må virksomheden komme fra request-body'en, og kun efter at rollen er
  // verificeret server-side mod platform_admins. Uden dette fik enhver
  // platform-admin 403 og kunne slet ikke bruge label-scanning.
  if (!companyId) {
    const { data: isPlatformAdmin } = await admin
      .from('platform_admins')
      .select('user_id')
      .eq('user_id', userData.user.id)
      .maybeSingle()
    const requested = (body.companyId ?? '').trim()
    if (isPlatformAdmin && requested) {
      const { data: company } = await admin
        .from('companies')
        .select('id')
        .eq('id', requested)
        .maybeSingle()
      companyId = company?.id
    }
  }
  if (!companyId) return json({ error: 'forbidden' }, 403)

  // Hele kæden gencheckes her: platformens hovedafbryder og udvalg …
  const { data: platform } = await admin
    .from('platform_settings')
    .select('ai_enabled, ai_providers, ai_models')
    .maybeSingle()
  if (!platform?.ai_enabled) return json({ ok: false, reason: 'integration_disabled' })

  // … og kundens valg inden for udvalget.
  const { data: cfg } = await admin
    .from('company_ai_config')
    .select('provider, model')
    .eq('company_id', companyId)
    .maybeSingle()
  const provider = cfg?.provider ?? ''
  const model = cfg?.model ?? ''
  if (!provider || !model) return json({ ok: false, reason: 'not_configured' })
  const catalog = MODELS[model]
  if (
    !catalog ||
    catalog.provider !== provider ||
    !(platform.ai_providers ?? []).includes(provider) ||
    !(platform.ai_models ?? []).includes(model)
  ) {
    return json({ ok: false, reason: 'not_allowed' })
  }
  if (!catalog.vision) return json({ ok: false, reason: 'model_no_vision' })

  try {
    const fields =
      provider === 'anthropic'
        ? await readWithAnthropic(model, mediaType, image)
        : provider === 'google'
          ? await readWithGemini(model, mediaType, image)
          // Rammes kun hvis kataloget udvides uden at funktionen følger med.
          : (() => {
              throw new ProviderError('provider_unsupported')
            })()
    return json({ ok: true, model, fields })
  } catch (e) {
    const reason = e instanceof ProviderError ? e.reason : 'provider_error'
    const detail = e instanceof Error ? e.message : String(e)
    console.error('ai-read-label failed', { companyId, model, reason, detail })
    return json({ ok: false, reason, detail })
  }
})
