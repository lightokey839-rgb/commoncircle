/** Configuration of the CommonCircle chat / sign-in server, from environment variables.
 *
 * Production (COMMONCIRCLE_ENV=production or NODE_ENV=production) refuses to start
 * unless it has a database, a signing secret, the browser origins and the NEP-413
 * recipients it will accept. It never falls back to local JSON files.
 */

export type ServerConfig = {
  production: boolean
  host: string
  port: number
  rpcUrl: string
  contractId: string
  databaseUrl: string | null
  databaseSsl: boolean
  dataDir: string
  jwtSecret: string | null // null in development = generate/read a local file
  sessionTtlSec: number
  origins: string[]
  recipients: string[]
  trustProxy: boolean
  maxChallenges: number
}

export class ConfigError extends Error {}

const list = (value: string | undefined) => (value ?? '').split(',').map((v) => v.trim()).filter(Boolean)

export function loadConfig(env: Record<string, string | undefined>, defaults: { dataDir: string }): ServerConfig {
  const production = env.COMMONCIRCLE_ENV === 'production' || env.NODE_ENV === 'production'
  // Back-compat: APP_DOMAIN (one host) was the only setting before APP_ORIGINS.
  const legacyDomain = env.APP_DOMAIN?.trim()
  const origins = list(env.APP_ORIGINS)
  if (!origins.length && legacyDomain) origins.push(legacyDomain.startsWith('http') ? legacyDomain : `https://${legacyDomain}`)
  if (!production) origins.push('http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:4173', 'http://127.0.0.1:4173')
  const recipients = list(env.NEAR_AUTH_RECIPIENTS ?? env.NEAR_AUTH_RECIPIENT)
  if (!recipients.length) {
    for (const origin of origins) { try { recipients.push(new URL(origin).host) } catch { /* skipped */ } }
  }
  const config: ServerConfig = {
    production,
    host: env.HOST ?? (production ? '0.0.0.0' : '127.0.0.1'),
    port: Number(env.PORT ?? env.AUTH_PORT ?? 3001),
    rpcUrl: env.NEAR_RPC_URL ?? env.NEAR_TESTNET_RPC_URL ?? 'https://test.rpc.fastnear.com',
    contractId: env.CIRCLE_CONTRACT_ID ?? 'commoncircle-light.testnet',
    databaseUrl: env.DATABASE_URL?.trim() || null,
    databaseSsl: env.DATABASE_SSL === '1' || env.DATABASE_SSL === 'true',
    dataDir: env.COMMONCIRCLE_DATA_DIR ?? defaults.dataDir,
    jwtSecret: env.AUTH_JWT_SECRET?.trim() || null,
    sessionTtlSec: Number(env.AUTH_SESSION_TTL_SEC ?? 12 * 3600),
    origins: [...new Set(origins)],
    recipients: [...new Set(recipients)],
    trustProxy: env.AUTH_TRUST_PROXY === '1',
    maxChallenges: Number(env.AUTH_MAX_CHALLENGES ?? 10_000),
  }
  const problems: string[] = []
  if (!Number.isInteger(config.port) || config.port <= 0 || config.port > 65535) problems.push('PORT must be a TCP port number.')
  if (!Number.isInteger(config.sessionTtlSec) || config.sessionTtlSec < 300 || config.sessionTtlSec > 7 * 86400) problems.push('AUTH_SESSION_TTL_SEC must be between 300 and 604800.')
  if (config.jwtSecret !== null && config.jwtSecret.length < 32) problems.push('AUTH_JWT_SECRET must be at least 32 characters (use: openssl rand -hex 32).')
  if (!/\.testnet$/.test(config.contractId)) problems.push('CIRCLE_CONTRACT_ID must be a .testnet account: this server is for the testnet demo only.')
  if (production) {
    if (!config.databaseUrl) problems.push('DATABASE_URL is required in production (PostgreSQL). Local JSON files are for development only.')
    if (!config.jwtSecret) problems.push('AUTH_JWT_SECRET is required in production.')
    if (!list(env.APP_ORIGINS).length && !legacyDomain) problems.push('APP_ORIGINS is required in production, e.g. https://lightokey839-rgb.github.io')
    if (config.origins.some((o) => !o.startsWith('https://'))) problems.push('Every APP_ORIGINS entry must be an https:// origin in production.')
    if (!config.recipients.length) problems.push('NEAR_AUTH_RECIPIENTS is required in production (the host shown in the wallet).')
  }
  if (problems.length) throw new ConfigError(`Chat server configuration is not valid:\n- ${problems.join('\n- ')}`)
  return config
}
