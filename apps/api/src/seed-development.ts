import { withCheckDigit } from '@edi-bridge/contracts'
import { connect, migrate, workspaces } from '@edi-bridge/db'

import { config } from './config.js'
import { createOperator } from './operator.js'

const developmentWorkspace = {
  id: '5f0c3a52-7d1e-4b8a-9c61-2e4f8d9a1b07',
  name: 'Nordwind Handel GmbH',
  gln: withCheckDigit('021234500000'),
}

const developmentOperator = {
  email: 'operator@edi-bridge.example',
  name: 'Development Operator',
  password: 'edi-bridge-operator',
}

await migrate(config.databaseUrl)

const connection = connect(config.databaseUrl)

try {
  await connection.db.insert(workspaces).values(developmentWorkspace).onConflictDoNothing()
  await createOperator(
    connection.db,
    {
      email: developmentOperator.email,
      name: developmentOperator.name,
      workspace: developmentWorkspace.name,
    },
    () => Promise.resolve(developmentOperator.password),
  )
} finally {
  await connection.close()
}
