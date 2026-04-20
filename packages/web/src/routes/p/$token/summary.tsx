import type { CategoryData, QuestionData } from "@spreadsheet/shared";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { usePersonApp } from "../../../lib/person-app-context.js";
import { Summary } from "../../../screens/Summary.js";

export const Route = createFileRoute("/p/$token/summary")({
  component: SummaryRoute,
});

function SummaryRoute() {
  const { token, authedStatus, questionsData, setStartKey } = usePersonApp();
  const navigate = useNavigate();

  return (
    <Summary
      questions={questionsData.questions as QuestionData[]}
      categories={questionsData.categories as CategoryData[]}
      isAdmin={authedStatus.person.isAdmin}
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
