import { z } from 'zod'

import { runSeedCommand } from './command.js'
import { resetTheSandbox } from './sandbox-reset.js'

await runSeedCommand('The Sandbox could not be reset.', z.object({}), async (db, secrets) => {
  const name = await resetTheSandbox(db, { secrets })

  console.log(`Sandbox Workspace "${name}": reset to its seed`)
})
