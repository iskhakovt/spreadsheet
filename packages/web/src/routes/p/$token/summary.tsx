import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { usePersonApp } from "../../../lib/person-app-context.js";
import { Summary } from "../../../screens/Summary.js";

export const Route = createFileRoute("/p/$token/summary")({
  component: SummaryRoute,
});

function SummaryRoute() {
  const { token, authedStatus, questionsData, setStartKey } = usePersonApp();
  const navigate = useNavigate();

  const otherAnatomies = useMemo(
    () =>
      authedStatus.members
        .filter((m) => m.id !== authedStatus.person.id)
        .map((m) => m.anatomy)
        .filter((a): a is string => a !== null),
    [authedStatus.members, authedStatus.person.id],
  );

  return (
    <Summary
      questions={questionsData.questions}
      categories={questionsData.categories}
      isAdmin={authedStatus.person.isAdmin}
      anatomy={authedStatus.person.anatomy ?? "both"}
      otherAnatomies={otherAnatomies}
      questionMode={authedStatus.group.questionMode}
      onNavigateToCategory={(catId) => {
        setStartKey(`welcome:${catId}`);
        void navigate({ to: "/p/$token/questions", params: { token } });
      }}
      onBack={() => void navigate({ to: "/p/$token/questions", params: { token } })}
      onReview={() => void navigate({ to: "/p/$token/review", params: { token } })}
      onViewGroup={() => void navigate({ to: "/p/$token/group", params: { token } })}
    />
  );
}
