import {
  type Channel,
  type ChannelInput,
  channelInputSchema,
  type ChannelKind,
  channelKinds,
  type ChannelUpdate,
  channelUpdateSchema,
  pollingIntervalMinutes,
  type SftpAuthentication,
  sftpPort,
  webhookRateLimitPerMinute,
} from '@edi-bridge/contracts'

type KindKey<Kind> = Kind extends ChannelKind ? `${Kind['type']}-${Kind['direction']}` : never

export type ChannelKindKey = KindKey<ChannelKind>

export function channelKindKey<Kind extends ChannelKind>({ type, direction }: Kind) {
  // SAFETY: the key is built from this kind's own type and direction, which is KindKey<Kind>.
  return `${type}-${direction}` as KindKey<Kind>
}

export const channelKindKeys = channelKinds.map(channelKindKey)

export function channelKindOf(key: ChannelKindKey): ChannelKind {
  return channelKinds.find((kind) => channelKindKey(kind) === key) ?? channelKinds[0]
}

export function isChannelKindKey(value: unknown): value is ChannelKindKey {
  return channelKindKeys.some((key) => key === value)
}

export type ChannelFormValues = {
  kind: ChannelKindKey
  name: string
  tradingPartnerId: string
  host: string
  port: string
  username: string
  remotePath: string
  authentication: SftpAuthentication
  credential: string
  pollingIntervalMinutes: string
  rateLimitPerMinute: string
  url: string
  sendAuthorization: boolean
  authorization: string
}

export type ChannelField = Exclude<keyof ChannelFormValues, 'kind' | 'sendAuthorization'>

export type FieldError = 'required' | 'tooLong' | 'range' | 'format'

export type ChannelFormResult<Input> =
  { input: Input } | { errors: Partial<Record<ChannelField, FieldError>> }

// Choice fields cannot be left empty from the form, so their errors get the generic message.
const fieldKinds = {
  name: 'text',
  tradingPartnerId: 'choice',
  host: 'format',
  port: 'number',
  username: 'text',
  remotePath: 'format',
  authentication: 'choice',
  credential: 'text',
  pollingIntervalMinutes: 'number',
  rateLimitPerMinute: 'number',
  url: 'format',
  authorization: 'text',
} as const satisfies Record<ChannelField, 'text' | 'format' | 'number' | 'choice'>

type FieldKind = (typeof fieldKinds)[ChannelField]

export type FieldOfKind<Kind extends FieldKind> = {
  [Field in ChannelField]: (typeof fieldKinds)[Field] extends Kind ? Field : never
}[ChannelField]

export function isFieldOfKind<Kind extends FieldKind>(
  field: ChannelField,
  kind: Kind,
): field is FieldOfKind<Kind> {
  return fieldKinds[field] === kind
}

function isField(key: PropertyKey | undefined): key is ChannelField {
  return Object.keys(fieldKinds).some((field) => field === key)
}

function fieldError(field: ChannelField, issue: { code: string }, value: string): FieldError {
  if (isFieldOfKind(field, 'number')) {
    return 'range'
  }

  if (issue.code === 'too_big') {
    return 'tooLong'
  }

  return value.trim() === '' ? 'required' : 'format'
}

// A blank number field must fail as out of range, not silently become 0.
function toNumber(value: string) {
  return value.trim() === '' ? Number.NaN : Number(value)
}

function emptyToUndefined(value: string) {
  return value === '' ? undefined : value
}

function toBody(values: ChannelFormValues, secrets: { keep: boolean }) {
  const kind = channelKindOf(values.kind)

  const common = {
    ...kind,
    name: values.name,
    tradingPartnerId: values.tradingPartnerId === '' ? null : values.tradingPartnerId,
  }

  const credential = secrets.keep ? emptyToUndefined(values.credential) : values.credential

  switch (kind.type) {
    case 'sftp':
      return {
        ...common,
        host: values.host,
        port: toNumber(values.port),
        username: values.username,
        remotePath: values.remotePath,
        authentication: values.authentication,
        credential,
        ...(kind.direction === 'inbound' && {
          pollingIntervalMinutes: toNumber(values.pollingIntervalMinutes),
        }),
      }
    case 'webhook':
      return { ...common, rateLimitPerMinute: toNumber(values.rateLimitPerMinute) }
    case 'http':
      return {
        ...common,
        url: values.url.trim(),
        authorization: !values.sendAuthorization
          ? null
          : secrets.keep
            ? emptyToUndefined(values.authorization)
            : values.authorization,
      }
  }
}

function collectErrors(
  issues: ReadonlyArray<{ code: string; path: PropertyKey[] }>,
  values: ChannelFormValues,
) {
  const errors: Partial<Record<ChannelField, FieldError>> = {}

  for (const issue of issues) {
    const field = issue.path[0]

    if (isField(field)) {
      errors[field] ??= fieldError(field, issue, values[field])
    }
  }

  return errors
}

export function validateNewChannel(values: ChannelFormValues): ChannelFormResult<ChannelInput> {
  const parsed = channelInputSchema.safeParse(toBody(values, { keep: false }))

  return parsed.success
    ? { input: parsed.data }
    : { errors: collectErrors(parsed.error.issues, values) }
}

// Blank secrets keep the stored ones, except where nothing is stored yet or the stored one
// no longer fits: a password cannot serve as a private key.
export function validateChannelUpdate(
  values: ChannelFormValues,
  existing: Channel,
): ChannelFormResult<ChannelUpdate> {
  const body = toBody(values, { keep: true })
  const parsed = channelUpdateSchema.safeParse(body)
  const errors = parsed.success ? {} : collectErrors(parsed.error.issues, values)

  if (
    existing.type === 'sftp' &&
    'credential' in body &&
    body.credential === undefined &&
    values.authentication !== existing.authentication
  ) {
    errors.credential ??= 'required'
  }

  if (
    existing.type === 'http' &&
    'authorization' in body &&
    body.authorization === undefined &&
    existing.authorization === null
  ) {
    errors.authorization ??= 'required'
  }

  return parsed.success && Object.keys(errors).length === 0 ? { input: parsed.data } : { errors }
}

export function toFormValues(channel?: Channel): ChannelFormValues {
  const values: ChannelFormValues = {
    kind: channel ? channelKindKey(channel) : 'sftp-inbound',
    name: channel?.name ?? '',
    tradingPartnerId: channel?.tradingPartnerId ?? '',
    host: '',
    port: String(sftpPort.default),
    username: '',
    remotePath: '/',
    authentication: 'password',
    credential: '',
    pollingIntervalMinutes: String(pollingIntervalMinutes.default),
    rateLimitPerMinute: String(webhookRateLimitPerMinute.default),
    url: '',
    sendAuthorization: true,
    authorization: '',
  }

  switch (channel?.type) {
    case 'sftp':
      return {
        ...values,
        host: channel.host,
        port: String(channel.port),
        username: channel.username,
        remotePath: channel.remotePath,
        authentication: channel.authentication,
        ...(channel.direction === 'inbound' && {
          pollingIntervalMinutes: String(channel.pollingIntervalMinutes),
        }),
      }
    case 'webhook':
      return { ...values, rateLimitPerMinute: String(channel.rateLimitPerMinute) }
    case 'http':
      return { ...values, url: channel.url, sendAuthorization: channel.authorization !== null }
    default:
      return values
  }
}
