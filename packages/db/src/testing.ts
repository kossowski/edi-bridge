import { PostgreSqlContainer } from '@testcontainers/postgresql'

import { migrate } from './migrate.js'

const image = 'postgres:18.6-alpine3.24'

export async function startTestDatabase() {
  const container = await new PostgreSqlContainer(image).start()
  const url = container.getConnectionUri()

  await migrate(url)

  return {
    url,
    stop: async () => {
      await container.stop()
    },
  }
}

export type TestDatabase = Awaited<ReturnType<typeof startTestDatabase>>
