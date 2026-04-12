import { logger } from "./logger.js";

const command = process.argv[2] ?? "serve";

switch (command) {
  case "serve":
    await import("./index.js");
    break;

  case "migrate": {
    const { createDatabase, runMigrations } = await import("./db/index.js");
    const db = createDatabase(requireEnv("DATABASE_URL"));
    await runMigrations(db);
    logger.info("migrations applied");
    process.exit(0);
    break;
  }

  case "seed": {
    const { createDatabase } = await import("./db/index.js");
    const { QuestionStore } = await import("./store/questions.js");
    const { seed } = await import("./db/seed.js");
    const db = createDatabase(requireEnv("DATABASE_URL"));
    await seed(new QuestionStore(db));
    logger.info("seed complete");
    process.exit(0);
    break;
  }

  case "setup": {
    const { createDatabase, runMigrations } = await import("./db/index.js");
    const { QuestionStore } = await import("./store/questions.js");
    const { seed } = await import("./db/seed.js");
    const db = createDatabase(requireEnv("DATABASE_URL"));
    await runMigrations(db);
    logger.info("migrations applied");
    await seed(new QuestionStore(db));
    logger.info("seed complete");
    process.exit(0);
    break;
  }

  default:
    logger.fatal({ command }, "usage: main.ts [serve|migrate|seed|setup]");
    process.exit(1);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} required`);
  return value;
}
