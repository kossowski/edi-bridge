import { withCheckDigit } from '@edi-bridge/contracts'
import { connect, migrate, workspaces } from '@edi-bridge/db'

import { config } from './config.js'
import { developmentWorkspace } from './development-workspace.js'
import { ensureOperator } from './operator.js'

const developmentOperator = {
  email: 'operator@edi-bridge.example',
  name: 'Development Operator',
  password: 'edi-bridge-operator',
}

await migrate(config.databaseUrl)

const connection = connect(config.databaseUrl)

try {
  await connection.db
    .insert(workspaces)
    .values({ ...developmentWorkspace, gln: withCheckDigit('021234500000') })
    .onConflictDoNothing()
  await ensureOperator(
    connection.db,
    {
      email: developmentOperator.email,
      name: developmentOperator.name,
      workspaceName: developmentWorkspace.name,
    },
    () => Promise.resolve(developmentOperator.password),
  )
} finally {
  await connection.close()
}
