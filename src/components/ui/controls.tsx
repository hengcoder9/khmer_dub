import * as React from 'react'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import * as Menu from '@radix-ui/react-dropdown-menu'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

export const Popover = PopoverPrimitive.Root
export const PopoverTrigger = PopoverPrimitive.Trigger
export const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = 'start', sideOffset = 6, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      className={cn('z-50 rounded-xl border bg-popover p-3 text-popover-foreground shadow-2xl outline-none', className)}
      {...props}
    />
  </PopoverPrimitive.Portal>
))
PopoverContent.displayName = 'PopoverContent'

export const DropdownMenu = Menu.Root
export const DropdownTrigger = Menu.Trigger
export function DropdownContent({ className, ...props }: Menu.DropdownMenuContentProps) {
  return (
    <Menu.Portal>
      <Menu.Content sideOffset={4} className={cn('z-50 min-w-48 rounded-md border bg-popover p-1 text-popover-foreground shadow-xl', className)} {...props} />
    </Menu.Portal>
  )
}
export function DropdownItem({ className, ...props }: Menu.DropdownMenuItemProps) {
  return (
    <Menu.Item
      className={cn(
        'flex cursor-default select-none items-center gap-2 rounded px-2 py-1.5 text-sm outline-none data-[disabled]:pointer-events-none data-[highlighted]:bg-accent data-[disabled]:opacity-50 [&_svg]:size-4',
        className
      )}
      {...props}
    />
  )
}
export const DropdownSeparator = () => <Menu.Separator className="my-1 h-px bg-border" />
export const DropdownLabel = ({ children }: { children: React.ReactNode }) => (
  <Menu.Label className="px-2 py-1 text-xs font-medium text-muted-foreground">{children}</Menu.Label>
)

/** Styled native <select> — reliable keyboard + long lists without extra deps. */
export function Select({
  value,
  onChange,
  options,
  className,
  title,
  disabled
}: {
  value: string
  onChange: (v: string) => void
  options: Array<{ value: string; label: string; group?: string }>
  className?: string
  title?: string
  disabled?: boolean
}) {
  const groups = [...new Set(options.map((o) => o.group ?? ''))]
  return (
    <div className={cn('relative inline-flex', className)}>
      <select
        title={title}
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-full appearance-none truncate rounded-md border bg-background pl-2 pr-7 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
      >
        {groups.length > 1
          ? groups.map((g) => (
              <optgroup key={g} label={g || '—'}>
                {options.filter((o) => (o.group ?? '') === g).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </optgroup>
            ))
          : options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 opacity-60" />
    </div>
  )
}

export function Switch({ checked, onChange, label, title }: { checked: boolean; onChange: (v: boolean) => void; label?: React.ReactNode; title?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      title={title}
      onClick={() => onChange(!checked)}
      className="inline-flex items-center gap-2 text-sm"
    >
      <span className={cn('relative h-5 w-9 rounded-full transition-colors', checked ? 'bg-primary' : 'bg-secondary')}>
        <span className={cn('absolute top-0.5 size-4 rounded-full bg-white shadow transition-all', checked ? 'left-[18px]' : 'left-0.5')} />
      </span>
      {label}
    </button>
  )
}

export function Toggle({ on, onClick, children, title, className }: { on: boolean; onClick: () => void; children: React.ReactNode; title?: string; className?: string }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors [&_svg]:size-3.5',
        on ? 'border-primary/60 bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-accent',
        className
      )}
    >
      {children}
    </button>
  )
}

export function Slider({
  value,
  onChange,
  min,
  max,
  step = 0.01,
  className,
  label,
  format
}: {
  value: number
  onChange: (v: number) => void
  min: number
  max: number
  step?: number
  className?: string
  label?: string
  format?: (v: number) => string
}) {
  return (
    <label className={cn('flex items-center gap-2 text-xs', className)}>
      {label && <span className="shrink-0 text-muted-foreground">{label}</span>}
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="min-w-0 flex-1" />
      <span className="w-10 shrink-0 text-right font-mono tabular-nums">{format ? format(value) : value}</span>
    </label>
  )
}

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn('h-8 rounded-md border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring', className)} {...props} />
}

export function Field({ label, children, hint }: { label: React.ReactNode; children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </label>
  )
}

export function Checkbox({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: React.ReactNode }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <span
        className={cn('grid size-4 place-items-center rounded border', checked ? 'border-primary bg-primary text-primary-foreground' : 'bg-background')}
        onClick={(e) => {
          e.preventDefault()
          onChange(!checked)
        }}
      >
        {checked && <Check className="size-3" />}
      </span>
      <span onClick={() => onChange(!checked)}>{label}</span>
    </label>
  )
}

export function Progress({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cn('h-1.5 overflow-hidden rounded-full bg-secondary', className)}>
      <div className="h-full rounded-full bg-brand transition-[width]" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  )
}
