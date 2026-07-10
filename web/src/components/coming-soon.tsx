import { useTranslation } from 'react-i18next'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

// Pladsholder for skærme fra prototypens scope der ikke er bygget endnu.
export function ComingSoon({ titleKey }: { titleKey: string }) {
  const { t } = useTranslation()
  return (
    <Card className="max-w-lg bg-panel">
      <CardHeader>
        <CardTitle className="text-base">{t(titleKey)}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">{t('common.comingSoon')}</p>
      </CardContent>
    </Card>
  )
}
