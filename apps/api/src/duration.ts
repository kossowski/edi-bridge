export const minuteMs = 60 * 1000

export const hourMs = 60 * minuteMs

export const dayMs = 24 * hourMs

export const startOfUtcDay = (ms: number) => new Date(Math.floor(ms / dayMs) * dayMs)
