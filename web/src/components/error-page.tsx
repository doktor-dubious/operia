import { useEffect } from 'react'
import { Link, useRouter, type ErrorComponentProps } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { PackageX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

// Fejl må aldrig dumpes rå til brugeren: teknisk detalje logges til konsollen,
// brugeren får en venlig side med en vej videre. Bruges som routerens
// defaultErrorComponent (render-/loader-fejl) og defaultNotFoundComponent.

export function RouteErrorPage({ error, reset }: ErrorComponentProps) {
  const { t } = useTranslation()
  const router = useRouter()

  useEffect(() => {
    console.error('Ufanget fejl i route:', error)
  }, [error])

  const retry = () => {
    reset()
    router.invalidate()
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-6">
      <Card className="w-full max-w-sm bg-panel">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PackageX className="h-5 w-5 text-destructive" />
            {t('errors.title')}
          </CardTitle>
          <CardDescription>{t('errors.description')}</CardDescription>
        </CardHeader>
        <CardContent className="flex gap-3">
          <Button onClick={retry}>{t('errors.retry')}</Button>
          <Button variant="outline" asChild>
            <Link to="/">{t('errors.home')}</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  )
}

export function NotFoundPage() {
  const { t } = useTranslation()
  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-6">
      <Card className="w-full max-w-sm bg-panel">
        <CardHeader>
          <CardTitle>{t('errors.notFoundTitle')}</CardTitle>
          <CardDescription>{t('errors.notFoundDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link to="/">{t('errors.home')}</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  )
}
