/**
 * Bootstrap/reset a reviewer's login password.
 *
 * Usage:
 *   npm run create-admin -- --email=reviewer@example.org --password=<pw>
 *
 * Upsert-by-email: if a `reviewers` row with that email already exists
 * (e.g. the seeded 'reviewer@example.org' row with password_hash=NULL),
 * its password_hash is updated in place. Otherwise a new reviewer row is
 * inserted with role='admin', active=true.
 */
import bcrypt from "bcryptjs";
import { pool } from "../src/db.js";

function parseArgs(argv: string[]): { email?: string; password?: string; name?: string } {
  const out: { email?: string; password?: string; name?: string } = {};
  for (const arg of argv) {
    const match = /^--([a-zA-Z]+)=(.*)$/.exec(arg);
    if (!match) continue;
    const [, key, value] = match;
    if (key === "email") out.email = value;
    if (key === "password") out.password = value;
    if (key === "name") out.name = value;
  }
  return out;
}

async function main() {
  const { email, password, name } = parseArgs(process.argv.slice(2));

  if (!email || !password) {
    console.error("Usage: npm run create-admin -- --email=<email> --password=<password> [--name=<name>]");
    process.exitCode = 1;
    return;
  }
  if (password.length < 8) {
    console.error("Password must be at least 8 characters.");
    process.exitCode = 1;
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const normalizedEmail = email.trim().toLowerCase();

  const existing = await pool.query<{ id: string }>(`SELECT id FROM reviewers WHERE lower(email) = $1`, [
    normalizedEmail,
  ]);

  if (existing.rows[0]) {
    await pool.query(`UPDATE reviewers SET password_hash = $1 WHERE id = $2`, [passwordHash, existing.rows[0].id]);
    console.log(`Updated password_hash for existing reviewer ${normalizedEmail} (id=${existing.rows[0].id}).`);
  } else {
    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO reviewers (name, email, role, active, password_hash)
       VALUES ($1, $2, 'admin', true, $3)
       RETURNING id`,
      [name ?? normalizedEmail, normalizedEmail, passwordHash],
    );
    console.log(`Created new admin reviewer ${normalizedEmail} (id=${inserted.rows[0].id}).`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
