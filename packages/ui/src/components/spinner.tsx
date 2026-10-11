import { Loading03Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { cn } from 'cn'

function Spinner({ className, ...props }: Omit<React.ComponentProps<'svg'>, 'strokeWidth'>) {
  return (
    <HugeiconsIcon
      icon={Loading03Icon}
      role="status"
      strokeWidth={2}
      aria-label="Loading"
      className={cn('size-4 animate-spin', className)}
      data-slot="spinner"
      {...props}
    />
  )
}

export { Spinner }
