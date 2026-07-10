import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useTheme } from '@/components/theme-provider'
import { useUiSettings, type NavMode } from '@/components/ui-settings-provider'
import { useSession } from '@/hooks/use-session'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/_app/settings')({
  component: SettingsPage,
})

// Indstillingsside efter Supabase Studios kontoside: centreret kolonne,
// sektioner som paneler med rækker (label venstre, kontrol højre) adskilt
// af delelinjer, gem-knap i panelets fod.

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="divide-y divide-border rounded-lg border bg-panel">{children}</div>
}

function PanelRow({
  label,
  description,
  children,
  wide,
}: {
  label: string
  description?: string
  children: React.ReactNode
  wide?: boolean
}) {
  return (
    <div className="flex items-start justify-between gap-8 px-6 py-4">
      <div className="pt-1">
        <p className="text-[13px] font-[450] text-foreground">{label}</p>
        {description && (
          <p className="mt-0.5 max-w-56 text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      <div className={cn('shrink-0', wide ? 'w-[26rem] max-w-full' : 'w-64')}>{children}</div>
    </div>
  )
}

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-lg font-medium text-foreground">{title}</h2>
      {subtitle && <p className="mt-0.5 text-[13px] text-foreground-light">{subtitle}</p>}
    </div>
  )
}

// ── Tema-forhåndsvisningskort (som Supabase: mini-mockup + radiomarkør) ────

function ThemeThumb({ variant }: { variant: 'light' | 'dark' }) {
  const bg = variant === 'dark' ? 'bg-[#181918]' : 'bg-white'
  const bar = variant === 'dark' ? 'bg-[#333433]' : 'bg-neutral-200'
  const dot = variant === 'dark' ? 'bg-[#333433]' : 'bg-neutral-300'
  return (
    <div className={cn('flex h-full w-full gap-2 p-2.5', bg)}>
      <div className="flex flex-col gap-1 pt-0.5">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={cn('h-1 w-1 rounded-full', dot)} />
        ))}
      </div>
      <div className="flex flex-1 flex-col gap-1.5">
        <div className="flex items-center gap-1">
          <span className="h-1.5 w-5 rounded-full bg-status-good-to-neutral" />
          <span className={cn('h-1.5 w-7 rounded-full', bar)} />
          <span className={cn('h-1.5 w-4 rounded-full', bar)} />
        </div>
        <div className={cn('flex flex-col gap-1 rounded-sm border p-1.5', variant === 'dark' ? 'border-[#333433]' : 'border-neutral-200')}>
          <div className="flex items-center gap-1">
            <span className={cn('h-1 w-8 rounded-full', bar)} />
            <span className="h-1 w-4 rounded-full bg-status-neutral" />
          </div>
          <span className={cn('h-1 w-10 rounded-full', bar)} />
        </div>
        <div className={cn('flex flex-col gap-1 rounded-sm border p-1.5', variant === 'dark' ? 'border-[#333433]' : 'border-neutral-200')}>
          <span className={cn('h-1 w-6 rounded-full', bar)} />
          <div className="flex items-center gap-1">
            <span className={cn('h-1 w-4 rounded-full', bar)} />
            <span className="h-1 w-5 rounded-full bg-status-neutral" />
          </div>
        </div>
      </div>
    </div>
  )
}

function ThemeCard({
  value,
  label,
  selected,
  onSelect,
}: {
  value: 'system' | 'dark' | 'light'
  label: string
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'cursor-pointer overflow-hidden rounded-lg border text-left transition-colors',
        selected ? 'border-foreground' : 'border-border hover:border-foreground/30',
      )}
    >
      <div className="relative h-24 overflow-hidden border-b border-border">
        {value === 'light' && <ThemeThumb variant="light" />}
        {value === 'dark' && <ThemeThumb variant="dark" />}
        {value === 'system' && (
          <>
            <div className="absolute inset-0">
              <ThemeThumb variant="dark" />
            </div>
            {/* Diagonal deling: lys øverst/venstre, mørk nederst/højre */}
            <div
              className="absolute inset-0"
              style={{ clipPath: 'polygon(0 0, 100% 0, 0 100%)' }}
            >
              <ThemeThumb variant="light" />
            </div>
          </>
        )}
      </div>
      <div className="flex items-center gap-2 bg-panel px-3 py-2">
        <span
          className={cn(
            'flex h-3 w-3 items-center justify-center rounded-full border',
            selected ? 'border-foreground' : 'border-muted-foreground',
          )}
        >
          {selected && <span className="h-1.5 w-1.5 rounded-full bg-foreground" />}
        </span>
        <span className="text-xs font-[450] text-foreground-light">{label}</span>
      </div>
    </button>
  )
}

// ── Siden ──────────────────────────────────────────────────────────────────

function SettingsPage() {
  const { t, i18n } = useTranslation()
  const { theme, setTheme } = useTheme()
  const { navMode, setNavMode } = useUiSettings()
  const { session } = useSession()

  const meta = session?.user.user_metadata ?? {}
  const [firstName, setFirstName] = useState<string>(meta.first_name ?? '')
  const [lastName, setLastName] = useState<string>(meta.last_name ?? '')
  const [username, setUsername] = useState<string>(meta.username ?? '')
  const [saving, setSaving] = useState(false)

  const saveProfile = async () => {
    setSaving(true)
    const { error } = await supabase.auth.updateUser({
      data: { first_name: firstName, last_name: lastName, username },
    })
    setSaving(false)
    if (error) {
      console.error('Kunne ikke gemme profil:', error)
      toast.error(t('settings.saveError'))
      return
    }
    toast.success(t('settings.saved'))
  }

  return (
    <div className="mx-auto w-full max-w-3xl py-6">
      <header className="mb-10">
        <h1 className="text-2xl font-medium text-foreground">{t('settings.preferences')}</h1>
        <p className="mt-1 text-sm text-foreground-light">{t('settings.preferencesSubtitle')}</p>
      </header>

      <section className="mb-10">
        <SectionHeader title={t('settings.profileSection')} />
        <Panel>
          <PanelRow label={t('settings.firstName')}>
            <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </PanelRow>
          <PanelRow label={t('settings.lastName')}>
            <Input value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </PanelRow>
          <PanelRow
            label={t('settings.username')}
            description={t('settings.usernameDescription')}
          >
            <Input value={username} onChange={(e) => setUsername(e.target.value)} />
          </PanelRow>
          <PanelRow label={t('auth.email')} description={t('settings.emailDescription')}>
            <Input value={session?.user.email ?? ''} disabled />
          </PanelRow>
          <div className="flex justify-end px-6 py-3">
            <Button size="sm" onClick={saveProfile} disabled={saving}>
              {saving ? t('common.loading') : t('common.save')}
            </Button>
          </div>
        </Panel>
      </section>

      <section>
        <SectionHeader
          title={t('settings.appearance')}
          subtitle={t('settings.appearanceSubtitle')}
        />
        <Panel>
          <PanelRow
            label={t('settings.themeMode')}
            description={t('settings.themeModeDescription')}
            wide
          >
            <div className="grid grid-cols-2 gap-3">
              <ThemeCard
                value="system"
                label={t('theme.system')}
                selected={theme === 'system'}
                onSelect={() => setTheme('system')}
              />
              <ThemeCard
                value="dark"
                label={t('theme.dark')}
                selected={theme === 'dark'}
                onSelect={() => setTheme('dark')}
              />
              <ThemeCard
                value="light"
                label={t('theme.light')}
                selected={theme === 'light'}
                onSelect={() => setTheme('light')}
              />
            </div>
          </PanelRow>
          <PanelRow label={t('settings.navMode')} description={t('settings.navModeDescription')}>
            <Select value={navMode} onValueChange={(v) => setNavMode(v as NavMode)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="classic">{t('settings.navModeClassic')}</SelectItem>
                <SelectItem value="modern">{t('settings.navModeModern')}</SelectItem>
              </SelectContent>
            </Select>
          </PanelRow>
          <PanelRow
            label={t('settings.languageLabel')}
            description={t('settings.languageDescription')}
          >
            <Select
              value={i18n.resolvedLanguage ?? 'da'}
              onValueChange={(v) => i18n.changeLanguage(v)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="da">Dansk</SelectItem>
                <SelectItem value="en">English</SelectItem>
              </SelectContent>
            </Select>
          </PanelRow>
        </Panel>
      </section>
    </div>
  )
}
