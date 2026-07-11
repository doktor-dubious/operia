// Fælles ramme for Operia-konfigurationssiderne: centreret kolonne med titel
// og valgfri undertekst — samme layout som præferencesiden (/settings).
export function OperiaPage({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children?: React.ReactNode
}) {
  return (
    <div className="mx-auto w-full max-w-3xl py-6">
      <header className="mb-8">
        <h1 className="text-2xl font-medium text-foreground">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-foreground-light">{subtitle}</p>}
      </header>
      {children}
    </div>
  )
}
