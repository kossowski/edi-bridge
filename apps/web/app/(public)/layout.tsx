import { AppBrand } from '@/components/app-brand'
import { LocaleSwitcher } from '@/components/locale-switcher'
import { MainContentFocus } from '@/components/main-content-focus'
import { ThemeSwitcher } from '@/components/theme-switcher'

export default function PublicLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 px-4">
        <AppBrand />
        <div className="ml-auto flex items-center gap-1">
          <LocaleSwitcher />
          <ThemeSwitcher />
        </div>
      </header>
      <main
        id="main-content"
        tabIndex={-1}
        className="flex flex-1 items-center justify-center px-4 py-12 outline-none">
        {children}
        <MainContentFocus />
      </main>
    </div>
  )
}
