import { HttpResponse } from 'msw'

function problem(status: number, message: string) {
  return HttpResponse.json({ message }, { status })
}

export const badRequest = (message: string) => problem(400, message)

export const unauthorized = (message = 'Unauthorized') => problem(401, message)

export const forbidden = () => problem(403, 'Forbidden')

export const notFound = () => problem(404, 'Not found')

export const conflict = (message: string) => problem(409, message)

export const unprocessable = (message: string) => problem(422, message)

export const serverError = () => problem(500, 'Internal Server Error')
