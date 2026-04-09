const command = process.argv[2] ?? "serve";

switch (command) {
  case "serve":
    await import("./index.js");
    break;

  case "migrate": {
    const { createDatabase, runMigrations } = await import("./db/index.js");
    const db = createDatabase(requireEnv("DATABASE_URL"));
    await runMigrations(db);
    console.log("Migrations applied");
    process.exit(0);
  }

  case "seed": {
    const { createDatabase } = await import("./db/index.js");
    const { QuestionStore } = await import("./store/questions.js");
    const { seed } = await import("./db/seed.js");
    const db = createDatabase(requireEnv("DATABASE_URL"));
    await seed(new QuestionStore(db));
    console.log("Seed complete");
    process.exit(0);
  }

  case "setup": {
    const { createDatabase, runMigrations } = await import("./db/index.js");
    const { QuestionStore } = await import("./store/questions.js");
    const { seed } = await import("./db/seed.js");
    const db = createDatabase(requireEnv("DATABASE_URL"));
    await runMigrations(db);
    console.log("Migrations applied");
    await seed(new QuestionStore(db));
    console.log("Seed complete");
    process.exit(0);
  }

  default:
    console.error("Usage: main.ts [serve|migrate|seed|setup]");
    process.exit(1);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} required`);
  return value;
}
