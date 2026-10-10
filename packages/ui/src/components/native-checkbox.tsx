import { cn } from 'cn'
import * as React from 'react'

function NativeCheckbox({ className, ...props }: Omit<React.ComponentProps<'input'>, 'type'>) {
  return (
    <input
      type="checkbox"
      className={cn(
        'accent-primary focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 size-4 shrink-0 cursor-pointer rounded-[4px] outline-none focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:ring-3',
        className,
      )}
      data-slot="native-checkbox"
      {...props}
    />
  )
}

export { NativeCheckbox }
