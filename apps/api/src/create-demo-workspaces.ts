import { z } from 'zod'

import { runSeedCommand } from './command.js'
import {
  type ShowcaseAndSandboxOutcome,
  ensureShowcaseAndSandbox,
  sandboxWorkspace,
  showcaseAdmin,
  showcaseViewer,
  showcaseWorkspace,
} from './showcase-and-sandbox.js'

const outcomeText = { created: 'created', found: 'found', membershipAdded: 'membership added' }

const summary = (outcome: ShowcaseAndSandboxOutcome) =>
  [
    `Showcase Workspace "${showcaseWorkspace.name}": ${outcomeText[outcome.showcase]}`,
    `Sandbox Workspace "${sandboxWorkspace.name}": ${outcomeText[outcome.sandbox]}`,
    `Viewer ${showcaseViewer.email} of the Showcase: ${outcomeText[outcome.viewer]}`,
    `Admin ${showcaseAdmin.email} of the Sandbox: ${outcomeText[outcome.admin]}`,
  ].join('\n')

await runSeedCommand(
  'The Showcase and Sandbox could not be created.',
  z.object({ SHOWCASE_ADMIN_PASSWORD: z.string().optional() }),
  async (db, secrets, env) => {
    const outcome = await ensureShowcaseAndSandbox(db, {
      secrets,
      adminPassword: env.SHOWCASE_ADMIN_PASSWORD,
    })

    console.log(summary(outcome))

    // Printed once to the terminal of this command only; the api never sees or logs it.
    if (outcome.generatedPassword !== null) {
      console.log(`Password of ${showcaseAdmin.email}: ${outcome.generatedPassword}`)
      console.log('Store it now: the command does not show it again.')
    }
  },
)
