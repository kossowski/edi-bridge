export function ActionError({ message }: { message: string }) {
  return (
    <p role="alert" className="text-destructive-text text-sm">
      {message}
    </p>
  )
}
