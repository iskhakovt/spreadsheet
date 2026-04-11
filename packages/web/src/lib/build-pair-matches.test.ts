import type { Answer } from "@spreadsheet/shared";
import { describe, expect, it } from "vitest";
import type { QuestionInfo } from "./build-pair-matches.js";
import { buildPairMatches } from "./build-pair-matches.js";

// --- Helpers ---

const yes: Answer = { rating: "yes", timing: "now" };
const yesLater: Answer = { rating: "yes", timing: "later" };
const no: Answer = { rating: "no", timing: null };
const maybe: Answer = { rating: "maybe", timing: null };
const fantasy: Answer = { rating: "fantasy", timing: null };
const ifPartner: Answer = { rating: "if-partner-wants", timing: "now" };

const mutualQ: QuestionInfo = { text: "Kissing", categoryId: "basics", giveText: null, receiveText: null };
const giveReceiveQ: QuestionInfo = {
  text: "Oral sex",
  categoryId: "oral",
  giveText: "Give oral",
  receiveText: "Receive oral",
};

function questions(qs: Record<string, QuestionInfo>): Record<string, QuestionInfo> {
  return qs;
}

// --- Tests ---

describe("buildPairMatches", () => {
  describe("mutual questions", () => {
    const qMap = questions({ kissing: mutualQ });

    it("both yes → match", () => {
      const result = buildPairMatches({ "kissing:mutual": yes }, { "kissing:mutual": yes }, qMap);
      expect(result).toHaveLength(1);
      expect(result[0].questionId).toBe("kissing");
      expect(result[0].matchType).toBe("green-light");
      expect(result[0].displayText).toBe("Kissing");
    });

    it("both yes but different timing → match (not green-light)", () => {
      const result = buildPairMatches({ "kissing:mutual": yes }, { "kissing:mutual": yesLater }, qMap);
      expect(result).toHaveLength(1);
      expect(result[0].matchType).toBe("match");
    });

    it("both maybe → both-maybe", () => {
      const result = buildPairMatches({ "kissing:mutual": maybe }, { "kissing:mutual": maybe }, qMap);
      expect(result).toHaveLength(1);
      expect(result[0].matchType).toBe("both-maybe");
    });

    it("both fantasy → fantasy", () => {
      const result = buildPairMatches({ "kissing:mutual": fantasy }, { "kissing:mutual": fantasy }, qMap);
      expect(result).toHaveLength(1);
      expect(result[0].matchType).toBe("fantasy");
    });

    it("yes + if-partner-wants → green-light", () => {
      const result = buildPairMatches({ "kissing:mutual": yes }, { "kissing:mutual": ifPartner }, qMap);
      expect(result).toHaveLength(1);
      expect(result[0].matchType).toBe("green-light");
    });

    it("yes + maybe → possible", () => {
      const result = buildPairMatches({ "kissing:mutual": yes }, { "kissing:mutual": maybe }, qMap);
      expect(result).toHaveLength(1);
      expect(result[0].matchType).toBe("possible");
    });

    it("either says no → hidden (not in results)", () => {
      const result = buildPairMatches({ "kissing:mutual": yes }, { "kissing:mutual": no }, qMap);
      expect(result).toHaveLength(0);
    });

    it("only A answered → skipped", () => {
      const result = buildPairMatches({ "kissing:mutual": yes }, {}, qMap);
      expect(result).toHaveLength(0);
    });

    it("only B answered → skipped", () => {
      const result = buildPairMatches({}, { "kissing:mutual": yes }, qMap);
      expect(result).toHaveLength(0);
    });

    it("question not in map → skipped", () => {
      const result = buildPairMatches({ "unknown:mutual": yes }, { "unknown:mutual": yes }, {});
      expect(result).toHaveLength(0);
    });
  });

  describe("give/receive questions — cross-role matching", () => {
    const qMap = questions({ oral: giveReceiveQ });

    it("A:give + B:receive both yes → match", () => {
      const result = buildPairMatches({ "oral:give": yes }, { "oral:receive": yes }, qMap);
      expect(result).toHaveLength(1);
      expect(result[0].questionId).toBe("oral");
      expect(result[0].matchType).toBe("green-light");
    });

    it("A:receive + B:give both yes → match", () => {
      const result = buildPairMatches({ "oral:receive": yes }, { "oral:give": yes }, qMap);
      expect(result).toHaveLength(1);
      expect(result[0].matchType).toBe("green-light");
    });

    it("A:give + B:receive — A yes, B no → hidden", () => {
      const result = buildPairMatches({ "oral:give": yes }, { "oral:receive": no }, qMap);
      expect(result).toHaveLength(0);
    });

    it("A:give + B:give (same role) → NO match (meaningless)", () => {
      const result = buildPairMatches({ "oral:give": yes }, { "oral:give": yes }, qMap);
      expect(result).toHaveLength(0);
    });

    it("A:receive + B:receive (same role) → NO match (meaningless)", () => {
      const result = buildPairMatches({ "oral:receive": yes }, { "oral:receive": yes }, qMap);
      expect(result).toHaveLength(0);
    });

    it("only A answered give, B has nothing → skipped", () => {
      const result = buildPairMatches({ "oral:give": yes }, {}, qMap);
      expect(result).toHaveLength(0);
    });

    it("question not in map → skipped", () => {
      const result = buildPairMatches({ "unknown:give": yes }, { "unknown:receive": yes }, {});
      expect(result).toHaveLength(0);
    });
  });

  describe("all-questions mode — both directions", () => {
    const qMap = questions({ oral: giveReceiveQ });

    it("both answered give AND receive → TWO separate matches", () => {
      const aAnswers = { "oral:give": yes, "oral:receive": yes };
      const bAnswers = { "oral:give": yes, "oral:receive": yes };
      const result = buildPairMatches(aAnswers, bAnswers, qMap);
      // A:give ↔ B:receive AND A:receive ↔ B:give
      expect(result).toHaveLength(2);
      expect(result.map((r) => r.questionId)).toEqual(["oral", "oral"]);
    });

    it("both directions have independent classifications", () => {
      const aAnswers = { "oral:give": yes, "oral:receive": no };
      const bAnswers = { "oral:give": yes, "oral:receive": yes };
      const result = buildPairMatches(aAnswers, bAnswers, qMap);
      // A:give ↔ B:receive = yes vs yes = green-light
      // A:receive ↔ B:give = no vs yes = hidden
      expect(result).toHaveLength(1);
      expect(result[0].matchType).toBe("green-light");
    });

    it("no duplicates: each direction appears exactly once", () => {
      const aAnswers = { "oral:give": yes, "oral:receive": maybe };
      const bAnswers = { "oral:give": maybe, "oral:receive": yes };
      const result = buildPairMatches(aAnswers, bAnswers, qMap);
      // A:give ↔ B:receive = yes vs yes = green-light
      // A:receive ↔ B:give = maybe vs maybe = both-maybe
      expect(result).toHaveLength(2);
      const types = result.map((r) => r.matchType).sort();
      expect(types).toEqual(["both-maybe", "green-light"]);
    });
  });

  describe("filtered mode — asymmetric anatomy", () => {
    const qMap = questions({ oral: giveReceiveQ });

    it("A only has receive, B only has give → cross-match works", () => {
      const result = buildPairMatches({ "oral:receive": yes }, { "oral:give": yes }, qMap);
      expect(result).toHaveLength(1);
      expect(result[0].matchType).toBe("green-light");
    });

    it("A only has give, B only has receive → cross-match works", () => {
      const result = buildPairMatches({ "oral:give": yes }, { "oral:receive": yes }, qMap);
      expect(result).toHaveLength(1);
      expect(result[0].matchType).toBe("green-light");
    });

    it("same anatomy — both only have give → no match", () => {
      const result = buildPairMatches({ "oral:give": yes }, { "oral:give": yes }, qMap);
      expect(result).toHaveLength(0);
    });

    it("same anatomy — both only have receive → no match", () => {
      const result = buildPairMatches({ "oral:receive": yes }, { "oral:receive": yes }, qMap);
      expect(result).toHaveLength(0);
    });

    it("A has give+receive, B only has receive → one match", () => {
      const aAnswers = { "oral:give": yes, "oral:receive": yes };
      const bAnswers = { "oral:receive": yes };
      // A:give ↔ B:receive = green-light
      // A:receive has no B:give → skipped
      const result = buildPairMatches(aAnswers, bAnswers, qMap);
      expect(result).toHaveLength(1);
      expect(result[0].matchType).toBe("green-light");
    });
  });

  describe("mixed question types", () => {
    const qMap = questions({
      kissing: mutualQ,
      oral: giveReceiveQ,
    });

    it("mutual + give/receive both match independently", () => {
      const aAnswers = { "kissing:mutual": yes, "oral:give": yes };
      const bAnswers = { "kissing:mutual": yes, "oral:receive": yes };
      const result = buildPairMatches(aAnswers, bAnswers, qMap);
      expect(result).toHaveLength(2);
      const qIds = result.map((r) => r.questionId).sort();
      expect(qIds).toEqual(["kissing", "oral"]);
    });

    it("mutual matches even when give/receive doesn't", () => {
      const aAnswers = { "kissing:mutual": yes, "oral:give": no };
      const bAnswers = { "kissing:mutual": yes, "oral:receive": yes };
      const result = buildPairMatches(aAnswers, bAnswers, qMap);
      expect(result).toHaveLength(1);
      expect(result[0].questionId).toBe("kissing");
    });
  });

  describe("display text", () => {
    const qMap = questions({ oral: giveReceiveQ });

    it("mutual question uses base text", () => {
      const q2 = questions({ kissing: mutualQ });
      const result = buildPairMatches({ "kissing:mutual": yes }, { "kissing:mutual": yes }, q2);
      expect(result[0].displayText).toBe("Kissing");
    });

    it("give/receive uses role-specific text with name parenthetical", () => {
      const result = buildPairMatches({ "oral:give": yes }, { "oral:receive": yes }, qMap, { aName: "Alice" });
      expect(result[0].displayText).toBe("Give oral (Alice)");
    });

    it("give/receive omits parenthetical when A is the viewer", () => {
      // When the pair's A is the current viewer, the row already reads from
      // A's perspective (giveText/receiveText are implicitly about A), so
      // "(You)" would be redundant and grammatically stilted.
      const result = buildPairMatches({ "oral:give": yes }, { "oral:receive": yes }, qMap, {
        aName: "You",
        aIsViewer: true,
      });
      expect(result[0].displayText).toBe("Give oral");
    });

    it("give/receive keeps parenthetical when A is not the viewer (other-vs-other pair)", () => {
      // In a 3+ person group, pairs like (Bob, Carol) viewed by Alice still
      // need the parenthetical — otherwise "Give oral" on its own doesn't
      // say whose perspective it's from.
      const result = buildPairMatches({ "oral:give": yes }, { "oral:receive": yes }, qMap, {
        aName: "Bob",
        aIsViewer: false,
      });
      expect(result[0].displayText).toBe("Give oral (Bob)");
    });

    it("give/receive falls back to base text when no role text", () => {
      const q2 = questions({ q: { text: "Activity", categoryId: "c", giveText: null, receiveText: null } });
      const result = buildPairMatches({ "q:give": yes }, { "q:receive": yes }, q2);
      expect(result[0].displayText).toBe("Activity");
    });
  });

  describe("3+ people (pairwise)", () => {
    const qMap = questions({ kissing: mutualQ, oral: giveReceiveQ });

    it("each pair produces independent results", () => {
      // Simulate 3-person group: Alice, Bob, Carol
      // Alice: kissing=yes, oral:give=yes
      // Bob: kissing=yes, oral:receive=yes
      // Carol: kissing=maybe, oral:give=yes

      const alice = { "kissing:mutual": yes, "oral:give": yes };
      const bob = { "kissing:mutual": yes, "oral:receive": yes };
      const carol: Record<string, Answer> = { "kissing:mutual": maybe, "oral:give": yes };

      const ab = buildPairMatches(alice, bob, qMap);
      const ac = buildPairMatches(alice, carol, qMap);
      const bc = buildPairMatches(bob, carol, qMap);

      // Alice-Bob: kissing green-light + oral green-light
      expect(ab).toHaveLength(2);

      // Alice-Carol: kissing possible (yes+maybe), oral give↔give = no match
      expect(ac).toHaveLength(1);
      expect(ac[0].questionId).toBe("kissing");
      expect(ac[0].matchType).toBe("possible");

      // Bob-Carol: kissing possible (yes+maybe), oral receive↔give = green-light
      expect(bc).toHaveLength(2);
    });
  });

  describe("edge cases", () => {
    it("empty answers → no matches", () => {
      const result = buildPairMatches({}, {}, questions({ kissing: mutualQ }));
      expect(result).toHaveLength(0);
    });

    it("answers with no questions in map → no matches", () => {
      const result = buildPairMatches(
        { "foo:mutual": yes, "bar:give": yes },
        { "foo:mutual": yes, "bar:receive": yes },
        {},
      );
      expect(result).toHaveLength(0);
    });

    it("malformed key without colon → skipped gracefully", () => {
      const qMap = questions({ kissing: mutualQ });
      // Key without role part — split produces undefined role
      const result = buildPairMatches({ kissing: yes }, { kissing: yes }, qMap);
      expect(result).toHaveLength(0);
    });
  });
});
