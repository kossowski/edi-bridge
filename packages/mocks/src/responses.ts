import { HttpResponse } from 'msw'

import {
  type AiBudget,
  type AiBudgetExhaustedProblem,
  aiBudgetExhaustedStatus,
  aiReviewOpenStatus,
  inviteUnusableProblem,
  type InviteUnusableReason,
  inviteUnusableStatus,
} from '@edi-bridge/contracts'

function problem(status: number, message: string) {
  return HttpResponse.json({ message }, { status })
}

export const badRequest = (message: string) => problem(400, message)

export const unauthorized = (message = 'Unauthorized') => problem(401, message)

export const forbidden = () => problem(403, 'Forbidden')

export const notFound = () => problem(404, 'Not found')

export const conflict = (message: string) => problem(409, message)

export const inviteUnusable = (reason: InviteUnusableReason) =>
  HttpResponse.json(inviteUnusableProblem(reason), { status: inviteUnusableStatus })

export const aiReviewOpen = () =>
  problem(aiReviewOpenStatus, 'The AI review of the Draft is still open.')

export const aiBudgetExhaustedProblem = (budget: AiBudget) =>
  HttpResponse.json(
    {
      code: 'aiBudgetExhausted',
      message: 'The daily AI budget of the Workspace is used up.',
      budget,
    } satisfies AiBudgetExhaustedProblem,
    { status: aiBudgetExhaustedStatus },
  )

export const unprocessable = (message: string) => problem(422, message)

export const serverError = () => problem(500, 'Internal Server Error')
