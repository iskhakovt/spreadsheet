import type { CategoryData, GroupStatus, Person, QuestionData } from "@spreadsheet/shared";
import { createContext, useContext } from "react";
import type { GroupCodec } from "./codec.js";
import type { LiveGroupStatus } from "./decrypt-status.js";

// Status with `person` narrowed to non-null — set up by the /p/$token layout
// route after it has verified the person exists (admin-token pre-setup returns
// early to GroupSetup before any child route renders).
export type AuthedGroupStatus = Omit<LiveGroupStatus, "person"> & { person: Person };

export interface PersonAppContextValue {
  token: string;
  authedStatus: AuthedGroupStatus;
  /** Seals and opens this group's sensitive values. The only way to produce a `Sealed<T>` for a tRPC input. */
  codec: GroupCodec;
  sortedMembers: GroupStatus["members"];
  questionsData: { questions: QuestionData[]; categories: CategoryData[] };
  markComplete: () => Promise<void>;
  markReady: () => void;
  refreshStatus: () => Promise<void>;
  startKey: string | undefined;
  setStartKey: (key: string | undefined) => void;
}

export const PersonAppContext = createContext<PersonAppContextValue | null>(null);

export function usePersonApp(): PersonAppContextValue {
  const ctx = useContext(PersonAppContext);
  if (!ctx) throw new Error("usePersonApp must be used inside PersonApp layout");
  return ctx;
}
