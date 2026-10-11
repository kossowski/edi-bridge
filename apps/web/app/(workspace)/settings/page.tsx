import { pageMetadata } from '@/components/page-metadata'
import { SettingsScreen } from '@/components/settings/settings-screen'

export const generateMetadata = pageMetadata('settings')

export default function Page() {
  return <SettingsScreen />
}
