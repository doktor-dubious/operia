import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ImageUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { describeError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

// Fælles byggeklodser for design-editorerne (HomeDesignEditor og
// HandheldDesignEditor) — de to editorer deler upload-felt og til/fra-boks,
// kun bucket-mappen er forskellig (pathPrefix).

// Billedfelt: upload til den offentlige company-logos-bucket (+ valgfri URL,
// typisk kun for logoer) med forhåndsvisning og fjern-knap.
export function DesignImageField({
  url,
  onChange,
  kind,
  pathPrefix,
  companyId,
  allowUrl,
  hint,
}: {
  url: string
  onChange: (url: string) => void
  kind: 'logo' | 'hero' | 'tile'
  pathPrefix: string // filnavns-prefix, fx 'home-design' eller 'handheld-design'
  // Virksomhedens id skal være FØRSTE mappe-segment i stien: storage-RLS for
  // company-logos kræver (storage.foldername(name))[1] = current_company_id()
  // for at managers må uploade. Null = platform-admin (redigerer standarden),
  // som ikke er bundet af mappe-tjekket.
  companyId?: string | null
  allowUrl?: boolean
  // Valgfri hjælpetekst under upload-feltet (anbefalede mål/format).
  hint?: string
}) {
  const { t } = useTranslation()
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const upload = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error(t('customerDetail.logoNotImage'))
      return
    }
    const ext = file.name.split('.').pop()?.toLowerCase() ?? 'png'
    // Company-scope: {companyId}/{prefix}-{kind}-… (mappe-segmentet er company_id
    // så manager-RLS'en passerer). Platform-admin (companyId null): {prefix}/…
    const path = companyId
      ? `${companyId}/${pathPrefix}-${kind}-${Date.now()}.${ext}`
      : `${pathPrefix}/${kind}-${Date.now()}.${ext}`
    setUploading(true)
    const { error } = await supabase.storage.from('company-logos').upload(path, file, { upsert: true })
    setUploading(false)
    if (error) {
      console.error('Kunne ikke uploade billede:', error)
      toast.error(describeError(error, t))
      return
    }
    onChange(supabase.storage.from('company-logos').getPublicUrl(path).data.publicUrl)
  }

  return (
    <div className="flex max-w-xl flex-col gap-3">
      {allowUrl && (
        <Input
          value={url}
          placeholder="https://…/image.png"
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      <button
        type="button"
        disabled={uploading}
        className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-border p-6 text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground-light disabled:cursor-default disabled:opacity-60"
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          const file = e.dataTransfer.files?.[0]
          if (file) upload(file)
        }}
      >
        <ImageUp className="size-5" />
        <span className="text-[13px]">
          {uploading ? t('common.loading') : t('customerDetail.logoDropHint')}
        </span>
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) upload(file)
          e.target.value = ''
        }}
      />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {url && (
        <div className="flex items-center gap-3">
          <div
            className={cn(
              'flex items-center justify-center overflow-hidden rounded-md border bg-muted/30 p-2',
              kind === 'logo' ? 'h-16 w-32' : 'h-24 w-full',
            )}
          >
            <img src={url} alt="" className="max-h-full max-w-full object-contain" />
          </div>
          <Button size="sm" variant="ghost" onClick={() => onChange('')}>
            {t('customerDetail.removeLogo')}
          </Button>
        </div>
      )}
    </div>
  )
}

// Til/fra-boks omkring et indholdselement (titel/undertitel/logo/hero).
export function ToggleSection({
  id,
  label,
  checked,
  onCheckedChange,
  children,
}: {
  id: string
  label: string
  checked: boolean
  onCheckedChange: (v: boolean) => void
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-lg border p-3',
        checked && 'border-primary/30 bg-primary/5 dark:border-primary/20 dark:bg-primary/10',
      )}
    >
      <label htmlFor={id} className="flex cursor-pointer items-center gap-2">
        <Checkbox id={id} checked={checked} onCheckedChange={(v) => onCheckedChange(v === true)} />
        <span className="text-[13px] font-[450]">{label}</span>
      </label>
      {checked && <div className="pl-6">{children}</div>}
    </div>
  )
}
