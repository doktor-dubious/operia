import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'
import { ThemeProvider } from '@/components/theme-provider'
import { UiSettingsProvider } from '@/components/ui-settings-provider'
import { NotFoundPage, RouteErrorPage } from '@/components/error-page'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'
import './i18n'
import './index.css'

const queryClient = new QueryClient()

const router = createRouter({
  routeTree,
  defaultErrorComponent: RouteErrorPage,
  defaultNotFoundComponent: NotFoundPage,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <UiSettingsProvider>
        <TooltipProvider>
          <QueryClientProvider client={queryClient}>
            <RouterProvider router={router} />
            {/* Toasts (Sonner) — top/højre som i Supabase Studio */}
            <Toaster position="top-right" />
          </QueryClientProvider>
        </TooltipProvider>
      </UiSettingsProvider>
    </ThemeProvider>
  </StrictMode>,
)
