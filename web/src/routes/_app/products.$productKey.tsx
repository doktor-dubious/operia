import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { navGroups } from '@/lib/nav'

// Pladsholder for add-on-produkterne (aktiver, skabe, IoT, forsendelse,
// ruter, booking). Gates på has_product() når entitlements kobles på UI'et.
export const Route = createFileRoute('/_app/products/$productKey')({
  component: ProductPlaceholderPage,
})

function ProductPlaceholderPage() {
  const { t } = useTranslation()
  const { productKey } = Route.useParams()
  const item = navGroups
    .flatMap((g) => g.items)
    .find((p) => p.productKey === productKey)

  return (
    <Card className="max-w-lg bg-panel">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {item && <item.icon className="h-4 w-4 text-primary" />}
          {item ? t(`nav.${item.labelKey}`) : productKey}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">{t('products.comingSoon')}</p>
      </CardContent>
    </Card>
  )
}
