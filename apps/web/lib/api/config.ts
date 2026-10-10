export const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

export const isMockingEnabled = process.env.NEXT_PUBLIC_API_MOCKING === 'enabled'

export const mockLiveEvents =
  process.env.NEXT_PUBLIC_API_MOCK_LIVE_EVENTS === 'quiet' ? 'quiet' : 'live'
