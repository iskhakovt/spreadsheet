import type { CategoryData, QuestionData } from "@spreadsheet/shared";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { usePersonApp } from "../../../lib/person-app-context.js";
import { Review } from "../../../screens/Review.js";

export const Route = createFileRoute("/p/$token/review")({
  component: ReviewRoute,
});

function ReviewRoute() {
  const { token, questionsData, markComplete, setStartKey } = usePersonApp();
  const navigate = useNavigate();

  return (
    <Review
      questions={questionsData.questions as QuestionData[]}
      categories={questionsData.categories as CategoryData[]}
      onMarkComplete={markComplete}
      onViewProgress={() => void navigate({ to: "/p/$token/summary", params: { token } })}
      onEditQuestion={(key) => {
        setStartKey(key);
        void navigate({ to: "/p/$token/questions", params: { token } });
      }}
      onBack={() => void navigate({ to: "/p/$token/summary", params: { token } })}
    />
  );
}
