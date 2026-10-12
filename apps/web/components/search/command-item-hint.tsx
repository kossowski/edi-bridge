import { CommandShortcut } from '@edi-bridge/ui/components/command'
import { cn } from '@edi-bridge/ui/lib/utils'

export function CommandItemHint({ className, ...props }: React.ComponentProps<'span'>) {
  return <CommandShortcut className={cn('shrink-0 tracking-normal', className)} {...props} />
}
