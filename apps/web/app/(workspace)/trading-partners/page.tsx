import { pageMetadata } from '@/components/page-metadata'
import { TradingPartnersScreen } from '@/components/trading-partners/trading-partners-screen'

export const generateMetadata = pageMetadata('tradingPartners')

export default function Page() {
  return <TradingPartnersScreen />
}
