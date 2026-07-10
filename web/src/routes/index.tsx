import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { AnimateIcon } from '@/components/animate-ui/icons/icon'
import { Bell } from '@/components/animate-ui/icons/bell'
import { TruckIcon } from '@/components/ui/truck'

export const Route = createFileRoute('/')({
  component: Index,
})

function Index() {
  const { t } = useTranslation()

  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-2xl">
            <TruckIcon size={28} />
            {t('app.name')}
          </CardTitle>
          <CardDescription>{t('app.tagline')}</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center gap-3">
          <AnimateIcon animateOnHover>
            <Button variant="outline">
              <Bell />
              {t('auth.signIn')}
            </Button>
          </AnimateIcon>
        </CardContent>
      </Card>
    </main>
  )
}
