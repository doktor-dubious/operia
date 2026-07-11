import { createFileRoute, redirect } from '@tanstack/react-router'

// /operia → /operia/templates (den skærm der er bygget indtil videre)
export const Route = createFileRoute('/_app/operia/')({
  beforeLoad: () => {
    throw redirect({ to: '/operia/templates' })
  },
})
