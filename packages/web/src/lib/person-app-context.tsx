import type { CategoryData, Group as GroupData, GroupStatus, Person, QuestionData } from "@spreadsheet/shared";
import { createContext, useContext } from "react";

// Status with `person` narrowed to non-null — set up by the /p/$token layout
// route after it has verified the person exists (admin-token pre-setup returns
// early to GroupSetup before any child route renders).
export type AuthedGroupStatus = Omit<GroupStatus, "person"> & { person: Person };

export interface PersonAppContextValue {
  token: string;
  authedStatus: AuthedGroupStatus;
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
