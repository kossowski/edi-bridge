/** Runtime configuration from the environment, with defaults matching the local Compose services. */
export const config = {
  databaseUrl:
    process.env.DATABASE_URL ?? 'postgres://edi_bridge:edi_bridge@localhost:5432/edi_bridge',
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  port: Number(process.env.API_PORT ?? 3001),
}
