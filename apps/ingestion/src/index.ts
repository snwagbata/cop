import pg from "pg";
import { runCourtListenerPipeline } from "./courtlistener/run.js";
import { runNycCcrbPipeline } from "./nyc-ccrb/run.js";

const { Pool } = pg;

/**
 * CLI entry point, INGESTION_DESIGN.md §2's "standalone TypeScript script
 * (tsx)... invoked by its own GitHub Actions workflow" convention (mirrors
 * apps/api-internal/scripts/create-admin.ts's shape: read args/env, do one
 * job, exit). Dispatches by pipeline name so a future pipeline in this
 * workspace (none exist yet beyond 'courtlistener' -- the state-court
 * Juriscraper half of INGESTION_DESIGN.md §3.1 is deliberately out of
 * scope for this task) can be added as another case here without a new
 * npm script / workflow-invocation convention.
 *
 * Reads DATABASE_URL, COURTLISTENER_API_KEY, and ANTHROPIC_API_KEY from
 * process.env and fails fast (throws, non-zero exit) if any required one
 * is missing -- this is an unattended cron job with real API cost behind
 * it, so silently proceeding with a missing credential is not an option.
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}. Refusing to start.`);
  }
  return value;
}

async function main(): Promise<void> {
  const pipeline = process.argv[2] ?? "courtlistener";
  const databaseUrl = requireEnv("DATABASE_URL");

  if (pipeline === "courtlistener") {
    const courtListenerApiKey = requireEnv("COURTLISTENER_API_KEY");
    const anthropicApiKey = requireEnv("ANTHROPIC_API_KEY");

    const pool = new Pool({ connectionString: databaseUrl });
    try {
      await runCourtListenerPipeline(pool, { courtListenerApiKey, anthropicApiKey });
    } finally {
      await pool.end();
    }
    return;
  }

  if (pipeline === "nyc_ccrb") {
    // SOCRATA_APP_TOKEN is read directly (not via requireEnv) since it's
    // optional -- process.env.SOCRATA_APP_TOKEN is undefined when unset,
    // exactly the value NycCcrbRunEnv.socrataAppToken expects for "no
    // token provided."
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      await runNycCcrbPipeline(pool, { socrataAppToken: process.env.SOCRATA_APP_TOKEN });
    } finally {
      await pool.end();
    }
    return;
  }

  throw new Error(`Unknown pipeline: "${pipeline}". Known pipelines: courtlistener, nyc_ccrb.`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
