/** Runtime configuration from the environment, with defaults matching the local Compose services. */
export const config = {
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  healthPort: Number(process.env.WORKER_HEALTH_PORT ?? 3002),
}
