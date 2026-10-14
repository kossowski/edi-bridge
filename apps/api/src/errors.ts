import { Data } from 'effect'

export class NotFound extends Data.TaggedError('NotFound') {
  override get message() {
    return 'Not found'
  }
}
