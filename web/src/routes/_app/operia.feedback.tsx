import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Lightbulb, TriangleAlert } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { DataTable, type ColumnDef } from '@/components/data-table'
import { DetailTabs } from '@/components/detail-tabs'
import { Field } from '@/components/detail-field'
import { supabase } from '@/lib/supabase'

// Operia → Feedback: DCA's indbakke for Feedback-knappen i topbjælken.
// Kun platform-admins (RLS på public.feedback). Skrivebeskyttet — feedback er
// append-only; hver post er også logget som 'feedback.received' i audit_log.
export const Route = createFileRoute('/_app/operia/feedback')({
  component: FeedbackPage,
})

const dateFormat = new Intl.DateTimeFormat('da-DK', { dateStyle: 'short', timeStyle: 'short' })

type Row = NonNullable<ReturnType<typeof useRows>['data']>[number]

function useRows() {
  return useQuery({
    queryKey: ['platform-feedback'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('feedback')
        .select(
          'id, kind, message, screenshot_path, page_path, created_at, user_id, company:companies (name)',
        )
        .order('created_at', { ascending: false })
        .limit(300)
      if (error) throw error
      // Afsenderens navn: feedback.user_id peger på auth.users, så der er ingen
      // FK at embedde app_users på — slå navnene op separat.
      const ids = [...new Set(data.map((d) => d.user_id).filter(Boolean))] as string[]
      const names: Record<string, string> = {}
      if (ids.length) {
        const { data: users } = await supabase
          .from('app_users')
          .select('user_id, full_name, email')
          .in('user_id', ids)
        users?.forEach((u) => {
          names[u.user_id] = u.full_name || u.email || ''
        })
      }
      return data.map((d) => ({
        ...d,
        userName: d.user_id ? (names[d.user_id] ?? null) : null,
      }))
    },
  })
}

function KindBadge({ kind }: { kind: string }) {
  const { t } = useTranslation()
  const isIssue = kind === 'issue'
  const Icon = isIssue ? TriangleAlert : Lightbulb
  return (
    <Badge
      variant="secondary"
      className={
        isIssue
          ? 'gap-1 border-destructive/40 bg-destructive/10 font-normal text-destructive'
          : 'gap-1 font-normal'
      }
    >
      <Icon className="size-3" />
      {t(isIssue ? 'feedback.issue' : 'feedback.idea')}
    </Badge>
  )
}

function FeedbackDetail({ row, onClose }: { row: Row; onClose: () => void }) {
  const { t } = useTranslation()
  const [tab, setTab] = useState('details')

  // Skærmbilledet ligger i den private 'feedback'-bucket → signeret URL.
  const { data: shotUrl } = useQuery({
    queryKey: ['feedback-shot', row.id, row.screenshot_path],
    enabled: !!row.screenshot_path,
    queryFn: async () => {
      const { data } = await supabase.storage
        .from('feedback')
        .createSignedUrl(row.screenshot_path!, 3600)
      return data?.signedUrl ?? null
    },
  })

  return (
    <DetailTabs
      tabs={[{ key: 'details', label: t('detail.tabDetails') }]}
      active={tab}
      onChange={setTab}
      onClose={onClose}
    >
      <div className="flex max-w-2xl flex-col gap-5">
        <Field label={t('feedbackPage.kind')}>
          <div>
            <KindBadge kind={row.kind} />
          </div>
        </Field>
        <Field label={t('feedbackPage.message')}>
          <span className="whitespace-pre-wrap text-[13px]">{row.message}</span>
        </Field>
        <Field label={t('usersPage.company')}>
          <span className="text-[13px]">{row.company?.name ?? '—'}</span>
        </Field>
        <Field label={t('feedbackPage.from')}>
          <span className="text-[13px]">{row.userName ?? '—'}</span>
        </Field>
        <Field label={t('feedbackPage.page')}>
          <span className="font-mono text-xs">{row.page_path ?? '—'}</span>
        </Field>
        <Field label={t('feedbackPage.received')}>
          <span className="text-[13px]">{dateFormat.format(new Date(row.created_at))}</span>
        </Field>
        {row.screenshot_path && (
          <Field label={t('feedbackPage.screenshot')}>
            {shotUrl ? (
              <a href={shotUrl} target="_blank" rel="noreferrer" className="w-fit">
                <img
                  src={shotUrl}
                  alt=""
                  className="max-h-64 rounded-md border object-contain transition-opacity hover:opacity-90"
                />
              </a>
            ) : (
              <Skeleton className="h-32 w-48" />
            )}
          </Field>
        )}
      </div>
    </DetailTabs>
  )
}

function FeedbackPage() {
  const { t } = useTranslation()
  const { data, isPending } = useRows()
  const [activeId, setActiveId] = useState<string | null>(null)

  if (isPending) return <Skeleton className="h-40 w-full" />

  const columns: ColumnDef<Row>[] = [
    {
      key: 'created_at',
      header: t('feedbackPage.received'),
      sortable: true,
      sortValue: (r) => r.created_at,
      render: (r) => dateFormat.format(new Date(r.created_at)),
    },
    {
      key: 'kind',
      header: t('feedbackPage.kind'),
      sortable: true,
      sortValue: (r) => r.kind,
      render: (r) => <KindBadge kind={r.kind} />,
    },
    {
      key: 'message',
      header: t('feedbackPage.message'),
      render: (r) => <span className="block max-w-96 truncate">{r.message}</span>,
    },
    {
      key: 'company',
      header: t('usersPage.company'),
      sortable: true,
      sortValue: (r) => r.company?.name ?? '',
      render: (r) => <span className="block max-w-40 truncate">{r.company?.name ?? '—'}</span>,
    },
    {
      key: 'user',
      header: t('feedbackPage.from'),
      sortable: true,
      sortValue: (r) => r.userName ?? '',
      render: (r) => <span className="block max-w-40 truncate">{r.userName ?? '—'}</span>,
    },
  ]

  const activeRow = data?.find((row) => row.id === activeId) ?? null

  return (
    <div className="flex min-h-full flex-col gap-6">
      <DataTable
        rows={data ?? []}
        columns={columns}
        entityLabel={t('nav.operiaFeedback').toLowerCase()}
        searchText={(row) =>
          [row.message, row.company?.name, row.userName, row.page_path].filter(Boolean).join(' ')
        }
        storageKey="platform-feedback"
        onRowClick={(row) => setActiveId(row.id === activeId ? null : row.id)}
        activeRowId={activeId}
      />
      {activeRow && (
        <FeedbackDetail
          key={activeRow.id}
          row={activeRow}
          onClose={() => setActiveId(null)}
        />
      )}
    </div>
  )
}
