import { useRef, useState } from 'react'
import { Check } from 'lucide-react'
import { AnimateIcon } from '@/components/animate-ui/icons/icon'
import { Copy } from '@/components/animate-ui/icons/copy'
import { Button } from '@/components/ui/button'

// Animeret kopiér-til-udklipsholder: hover animerer kopi-ikonet, klik
// kopierer og viser et flueben et øjeblik.

export function CopyButton({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 1500)
    } catch (error) {
      console.error('Kunne ikke kopiere:', error)
    }
  }

  return (
    <AnimateIcon animateOnHover asChild>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-8 w-8 shrink-0 cursor-pointer text-muted-foreground hover:text-foreground"
        onClick={copy}
        aria-label={label ?? 'Copy'}
        title={label ?? 'Copy'}
      >
        {copied ? <Check className="size-4 text-status-good-to-neutral" /> : <Copy size={16} />}
      </Button>
    </AnimateIcon>
  )
}
