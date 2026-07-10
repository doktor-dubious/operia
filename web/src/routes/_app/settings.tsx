import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useTheme } from '@/components/theme-provider'
import { useUiSettings, type NavMode } from '@/components/ui-settings-provider'

export const Route = createFileRoute('/_app/settings')({
  component: SettingsPage,
})

function SettingsPage() {
  const { t, i18n } = useTranslation()
  const { theme, setTheme } = useTheme()
  const { navMode, setNavMode } = useUiSettings()

  return (
    <div className="flex max-w-lg flex-col gap-6">
      <Card className="bg-panel">
        <CardHeader>
          <CardTitle className="text-base">{t('settings.appearance')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <Label>{t('settings.navMode')}</Label>
            <Select value={navMode} onValueChange={(v) => setNavMode(v as NavMode)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="classic">{t('settings.navModeClassic')}</SelectItem>
                <SelectItem value="modern">{t('settings.navModeModern')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label>{t('settings.themeLabel')}</Label>
            <Select
              value={theme}
              onValueChange={(v) => setTheme(v as 'system' | 'light' | 'dark')}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="system">{t('theme.system')}</SelectItem>
                <SelectItem value="light">{t('theme.light')}</SelectItem>
                <SelectItem value="dark">{t('theme.dark')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label>{t('settings.languageLabel')}</Label>
            <Select
              value={i18n.resolvedLanguage ?? 'da'}
              onValueChange={(v) => i18n.changeLanguage(v)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="da">Dansk</SelectItem>
                <SelectItem value="en">English</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
