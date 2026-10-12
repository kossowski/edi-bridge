import { CodeTranslationsScreen } from '@/components/code-translations/code-translations-screen'
import { pageMetadata } from '@/components/page-metadata'

export const generateMetadata = pageMetadata('codeTranslations')

export default function Page() {
  return <CodeTranslationsScreen />
}
