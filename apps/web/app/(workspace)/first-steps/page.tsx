import { FirstStepsScreen } from '@/components/first-steps/first-steps-screen'
import { pageMetadata } from '@/components/page-metadata'

export const generateMetadata = pageMetadata('firstSteps')

export default function Page() {
  return <FirstStepsScreen />
}
