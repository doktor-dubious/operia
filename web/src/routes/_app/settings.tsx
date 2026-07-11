import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/password-input'
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

// Genbrugeligt valgkort: miniature-illustration øverst, radiomarkør + label
// nederst. Bruges til tema, navigation og sprog.
function SelectionCard({
  label,
  selected,
  onSelect,
  children,
}: {
  label: string
  selected: boolean
  onSelect: () => void
  children: React.ReactNode
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
      <div className="relative h-24 overflow-hidden border-b border-border">{children}</div>
      <div className="flex items-center gap-2 bg-panel px-3 py-2">
        <span
          className={cn(
            'flex h-3 w-3 shrink-0 items-center justify-center rounded-full border',
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

function ThemeCardThumb({ value }: { value: 'system' | 'dark' | 'light' }) {
  if (value === 'system') {
    return (
      <>
        <div className="absolute inset-0">
          <ThemeThumb variant="dark" />
        </div>
        {/* Diagonal deling: lys øverst/venstre, mørk nederst/højre */}
        <div className="absolute inset-0" style={{ clipPath: 'polygon(0 0, 100% 0, 0 100%)' }}>
          <ThemeThumb variant="light" />
        </div>
      </>
    )
  }
  return <ThemeThumb variant={value} />
}

// ── Navigations-miniaturer (temabevidste via tokens) ───────────────────────

function NavThumb({ variant }: { variant: 'classic' | 'modern' }) {
  return (
    <div className="flex h-full w-full bg-background">
      {variant === 'classic' ? (
        <div className="flex w-1/4 flex-col gap-1 border-r border-border p-1.5">
          <span className="h-1 w-full rounded-full bg-foreground/40" />
          <span className="h-1 w-4/5 rounded-full bg-foreground/15" />
          <span className="h-1 w-full rounded-full bg-foreground/15" />
          <span className="h-1 w-3/5 rounded-full bg-foreground/15" />
        </div>
      ) : (
        <div className="relative w-[14%] border-r border-border">
          {/* Menu der folder ud fra avataren nederst til venstre */}
          <span className="absolute bottom-1 left-1 h-2 w-2 rounded-full bg-foreground/40" />
          <div className="absolute bottom-4 left-1 z-10 flex w-10 flex-col gap-1 rounded-sm border border-border bg-panel p-1 shadow-sm">
            <span className="h-0.5 w-3/4 rounded-full bg-foreground/40" />
            <span className="h-0.5 w-full rounded-full bg-foreground/15" />
            <span className="h-0.5 w-2/3 rounded-full bg-foreground/15" />
          </div>
        </div>
      )}
      <div className="flex flex-1 flex-col gap-1 p-1.5">
        <div className="flex items-center gap-1">
          <span className="h-1.5 w-5 rounded-full bg-status-good-to-neutral" />
          <span className="h-1.5 w-6 rounded-full bg-foreground/15" />
        </div>
        <div className="flex flex-col gap-1 rounded-sm border border-border p-1.5">
          <span className="h-1 w-3/4 rounded-full bg-foreground/15" />
          <div className="flex items-center gap-1">
            <span className="h-1 w-1/3 rounded-full bg-foreground/15" />
            <span className="h-1 w-4 rounded-full bg-status-neutral" />
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Flag-illustrationer til sprogvalg ──────────────────────────────────────

function DannebrogFlag() {
  return (
    <svg viewBox="0 0 37 28" className="h-12 w-16 rounded-sm border border-border shadow-sm">
      <rect width="37" height="28" fill="#C8102E" />
      <rect x="11" width="5" height="28" fill="#fff" />
      <rect y="11.5" width="37" height="5" fill="#fff" />
    </svg>
  )
}

function UnionJackFlag() {
  return (
    <svg viewBox="0 0 60 40" className="h-12 w-16 rounded-sm border border-border shadow-sm">
      <rect width="60" height="40" fill="#012169" />
      <path d="M0,0 L60,40 M60,0 L0,40" stroke="#fff" strokeWidth="8" />
      <path d="M0,0 L60,40 M60,0 L0,40" stroke="#C8102E" strokeWidth="3.2" />
      <path d="M30,0 V40 M0,20 H60" stroke="#fff" strokeWidth="13" />
      <path d="M30,0 V40 M0,20 H60" stroke="#C8102E" strokeWidth="8" />
    </svg>
  )
}

function FlagThumb({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full w-full items-center justify-center bg-background">{children}</div>
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

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [savingPassword, setSavingPassword] = useState(false)

  const changePassword = async () => {
    if (newPassword.length < 8) {
      toast.error(t('setPassword.tooShort'))
      return
    }
    setSavingPassword(true)
    // Verificér den nuværende adgangskode ved at re-autentificere først.
    const { error: reauthError } = await supabase.auth.signInWithPassword({
      email: session?.user.email ?? '',
      password: currentPassword,
    })
    if (reauthError) {
      setSavingPassword(false)
      toast.error(t('settings.wrongCurrentPassword'))
      return
    }
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    setSavingPassword(false)
    if (error) {
      console.error('Kunne ikke skifte adgangskode:', error)
      toast.error(t('common.error'))
      return
    }
    setCurrentPassword('')
    setNewPassword('')
    toast.success(t('settings.passwordChanged'))
  }

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
              {(['system', 'dark', 'light'] as const).map((value) => (
                <SelectionCard
                  key={value}
                  label={t(`theme.${value}`)}
                  selected={theme === value}
                  onSelect={() => setTheme(value)}
                >
                  <ThemeCardThumb value={value} />
                </SelectionCard>
              ))}
            </div>
          </PanelRow>
          <PanelRow
            label={t('settings.navMode')}
            description={t('settings.navModeDescription')}
            wide
          >
            <div className="grid grid-cols-2 gap-3">
              {(['classic', 'modern'] as const).map((value) => (
                <SelectionCard
                  key={value}
                  label={t(value === 'classic' ? 'settings.navModeClassic' : 'settings.navModeModern')}
                  selected={navMode === value}
                  onSelect={() => setNavMode(value as NavMode)}
                >
                  <NavThumb variant={value} />
                </SelectionCard>
              ))}
            </div>
          </PanelRow>
        </Panel>
      </section>

      <section className="mt-10">
        <SectionHeader
          title={t('settings.languageLabel')}
          subtitle={t('settings.languageDescription')}
        />
        <Panel>
          <PanelRow
            label={t('settings.languageLabel')}
            description={t('settings.languageChoiceDescription')}
            wide
          >
            <div className="grid grid-cols-2 gap-3">
              <SelectionCard
                label="Dansk"
                selected={(i18n.resolvedLanguage ?? 'da') === 'da'}
                onSelect={() => i18n.changeLanguage('da')}
              >
                <FlagThumb>
                  <DannebrogFlag />
                </FlagThumb>
              </SelectionCard>
              <SelectionCard
                label="English"
                selected={i18n.resolvedLanguage === 'en'}
                onSelect={() => i18n.changeLanguage('en')}
              >
                <FlagThumb>
                  <UnionJackFlag />
                </FlagThumb>
              </SelectionCard>
            </div>
          </PanelRow>
        </Panel>
      </section>

      <section className="mt-10">
        <SectionHeader
          title={t('settings.passwordSection')}
          subtitle={t('settings.passwordSubtitle')}
        />
        <Panel>
          <PanelRow label={t('settings.currentPassword')}>
            <PasswordInput
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </PanelRow>
          <PanelRow
            label={t('settings.newPassword')}
            description={t('settings.newPasswordDescription')}
          >
            <PasswordInput
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </PanelRow>
          <div className="flex justify-end px-6 py-3">
            <Button
              size="sm"
              onClick={changePassword}
              disabled={savingPassword || !currentPassword || !newPassword}
            >
              {savingPassword ? t('common.loading') : t('settings.savePassword')}
            </Button>
          </div>
        </Panel>
      </section>
    </div>
  )
}
