import { describe, expect, it } from "vitest";
import { UI } from "./strings.js";

describe("UI.group.title", () => {
  it("singular for one partner", () => {
    expect(UI.group.title(1)).toBe("Invite your partner");
  });

  it("plural for two or more partners", () => {
    expect(UI.group.title(2)).toBe("Invite your partners");
    expect(UI.group.title(3)).toBe("Invite your partners");
  });
});
