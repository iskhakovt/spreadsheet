import { logger } from "./logger.js";

// One-shot commands only. `serve` is handled separately at the call site
// because it keeps the event loop alive via the Hono server's listener
// handle, and process.exit() would tear that down immediately.
async function runOneShot(command: string): Promise<number> {
  switch (command) {
    case "migrate": {
      const { createDatabase, runMigrations } = await import("./db/index.js");
      const { db, close } = createDatabase(requireEnv("DATABASE_URL"));
      try {
        await runMigrations(db);
        logger.info("migrations applied");
        return 0;
      } finally {
        await close();
      }
    }

    case "seed": {
      const { createDatabase } = await import("./db/index.js");
      const { QuestionStore } = await import("./store/questions.js");
      const { seed } = await import("./db/seed.js");
      const { db, close } = createDatabase(requireEnv("DATABASE_URL"));
      try {
        await seed(new QuestionStore(db));
        logger.info("seed complete");
        return 0;
      } finally {
        await close();
      }
    }

    case "setup": {
      const { createDatabase, runMigrations } = await import("./db/index.js");
      const { QuestionStore } = await import("./store/questions.js");
      const { seed } = await import("./db/seed.js");
      const { db, close } = createDatabase(requireEnv("DATABASE_URL"));
      try {
        await runMigrations(db);
        logger.info("migrations applied");
        await seed(new QuestionStore(db));
        logger.info("seed complete");
        return 0;
      } finally {
        await close();
      }
    }

    default:
      logger.fatal({ command }, "usage: main.ts [serve|migrate|seed|setup]");
      return 1;
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} required`);
  return value;
}

const command = process.argv[2] ?? "serve";
if (command === "serve") {
  await import("./index.js");
} else {
  // process.exitCode (not process.exit) so pino's async writes flush before
  // Node tears down. The event loop drains naturally once runOneShot returns
  // because each one-shot case closes its DB connection pool in a finally
  // block — without that close, postgres.js's TCP sockets would keep the
  // loop alive and the process would hang after the command finishes.
  process.exitCode = await runOneShot(command);
}
