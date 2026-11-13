// `pg` ships no types and @types/pg is not installed; server/store-postgres.ts declares
// the few calls it uses (Pool, Client) with its own local types.
declare module 'pg'
