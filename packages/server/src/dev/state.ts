import { createDatabase } from "../db/index.js";
import { GroupStore } from "../store/groups.js";
import { QuestionStore } from "../store/questions.js";
import { SyncStore } from "../store/sync.js";

export interface DevState {
  stores: {
    groups: GroupStore;
    sync: SyncStore;
    questions: QuestionStore;
  };
  close: () => Promise<void>;
}

/**
 * Open the dev database pool and build the store trio. Called once from the
 * Vite plugin's configureServer hook; the result is stashed on `globalThis`
 * so the dev-entry (loaded later via Vite's SSR loader) can find the same
 * instances. See packages/web/vite.config.ts → spreadsheetDev.
 */
export function createDevState(opts: { databaseUrl: string }): DevState {
  const { db, close } = createDatabase(opts.databaseUrl);
  return {
    stores: {
      groups: new GroupStore(db),
      sync: new SyncStore(db),
      questions: new QuestionStore(db),
    },
    close,
  };
}
