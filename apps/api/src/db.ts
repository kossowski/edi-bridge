import { Context } from 'effect'

import type { Connection } from '@edi-bridge/db'

export type Database = Connection['db']

export class Db extends Context.Service<Db, Database>()('Db') {}
