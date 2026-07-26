import { Pool } from "pg";

let pool: Pool | null = null;

function getPool(): Pool {
  if (pool) return pool;
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error("DATABASE_URL is required in regulated mode");
  }
  pool = new Pool({ connectionString: url, max: 5 });
  return pool;
}

/**
 * Ensure Cognito principal exists in auth.users + user_profiles.
 * Cognito `sub` is a UUID string compatible with the schema.
 */
export async function ensureRegulatedUser(
  userId: string,
  email: string,
): Promise<void> {
  const db = getPool();
  const client = await db.connect();
  try {
    await client.query("begin");
    await client.query(
      `insert into auth.users (id, email)
       values ($1::uuid, $2)
       on conflict (id) do update
         set email = excluded.email,
             updated_at = now()`,
      [userId, email || null],
    );
    await client.query(
      `insert into public.user_profiles (user_id, email)
       values ($1::uuid, $2)
       on conflict (user_id) do update
         set email = coalesce(excluded.email, public.user_profiles.email),
             updated_at = now()`,
      [userId, email || null],
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
