import { ANATOMY_LABEL_PRESETS, type Anatomy, type AnatomyLabels } from "@spreadsheet/shared";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AnatomyPicker } from "../../../components/AnatomyPicker.js";
import { Button } from "../../../components/Button.js";
import { Card } from "../../../components/Card.js";
import { usePersonApp } from "../../../lib/person-app-context.js";
import { useSaveProfile } from "../../../lib/use-save-profile.js";

export const Route = createFileRoute("/p/$token/anatomy")({
  component: AnatomyRoute,
});

function AnatomyRoute() {
  const { authedStatus } = usePersonApp();
  const { save, saving } = useSaveProfile();

  const anatomyLabelKey = (authedStatus.group.anatomyLabels ?? "anatomical") as AnatomyLabels;
  const labels = ANATOMY_LABEL_PRESETS[anatomyLabelKey];
  const [selected, setSelected] = useState<Anatomy | "">("");

  return (
    <Card>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">One quick thing</h1>
        <p className="text-text-muted">Pick your body type so we can show you relevant questions.</p>
        <AnatomyPicker selected={selected} onSelect={setSelected} labels={labels} />
        <Button
          fullWidth
          disabled={!selected || saving}
          onClick={() => {
            if (!selected) return;
            // `authedStatus` holds the decrypted status, so the name is
            // plaintext here. useSaveProfile re-wraps it; sending it as-is
            // would overwrite its ciphertext with plaintext.
            void save({ name: authedStatus.person.name, anatomy: selected });
          }}
        >
          Continue
        </Button>
      </div>
    </Card>
  );
}
