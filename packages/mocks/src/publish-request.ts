import {
  publishMappingDraftEndpoint,
  type PublishMappingDraftBody,
  toPath,
} from '@edi-bridge/contracts'

export function publishDraft(
  apiUrl: string,
  mappingId: string,
  body: Partial<PublishMappingDraftBody> = { changeNote: '' },
) {
  return fetch(`${apiUrl}${toPath(publishMappingDraftEndpoint.path, { mappingId })}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}
