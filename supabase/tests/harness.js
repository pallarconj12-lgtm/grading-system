// Test harness: runs the REAL migrations inside an in-process PostgreSQL (PGlite)
// with a minimal stand-in for Supabase's `auth` schema, so RLS and triggers can be tested.
import { PGlite } from '@electric-sql/pglite'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const MIGRATIONS = path.join(here, '..', 'migrations')

const SUPABASE_STUBS = `
  create schema if not exists auth;
  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text unique,
    raw_user_meta_data jsonb not null default '{}'::jsonb
  );
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  create role anon nologin;
  create role authenticated nologin;
  grant usage on schema auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
`

export async function createDb() {
  const db = new PGlite()
  await db.exec(SUPABASE_STUBS)
  const files = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()
  for (const f of files) {
    try {
      await db.exec(fs.readFileSync(path.join(MIGRATIONS, f), 'utf8'))
    } catch (e) {
      throw new Error(`Migration ${f} failed: ${e.message}`)
    }
  }
  return db
}

export async function addUser(db, email, fullName = '') {
  const r = await db.query(
    `insert into auth.users (email, raw_user_meta_data) values ($1, jsonb_build_object('full_name', $2::text)) returning id`,
    [email, fullName],
  )
  return r.rows[0].id
}

// Run fn() as an authenticated Supabase user (RLS applies). Pass null for anon.
export async function as(db, userId, fn) {
  await db.exec(`reset role; set role ${userId ? 'authenticated' : 'anon'};`)
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId ?? ''])
  try {
    return await fn()
  } finally {
    await db.exec(`reset role;`)
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`)
  }
}

export const q = async (db, sql, params = []) => (await db.query(sql, params)).rows
