import { placeholderMetadata } from '@/components/page-placeholder'
import { TradingPartnersScreen } from '@/components/trading-partners/trading-partners-screen'

export const generateMetadata = placeholderMetadata('tradingPartners')

export default function Page() {
  return <TradingPartnersScreen />
}
