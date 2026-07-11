import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema'

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is not set')
}

// Local databases usually run without TLS; remote ones (e.g. Neon) use
// certificates signed by public CAs, so full verification works out of the box.
const isLocalDatabase = ['localhost', '127.0.0.1'].includes(
  new URL(connectionString).hostname
)

const pool = new Pool({
  connectionString,
  ssl: isLocalDatabase ? false : { rejectUnauthorized: true }
})

export const db = drizzle(pool, { schema })