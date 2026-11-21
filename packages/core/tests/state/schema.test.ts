import { describe, expect, it } from "vitest";
import {
  ACTIVE_DRAFT_STATUSES,
  STATE_SCHEMA_SQL,
  defaultStateDbPath,
} from "../../src/state/index.js";

describe("state schema + defaults", () => {
  it("defaults to ~/.envlo/state.db", () => {
    expect(defaultStateDbPath()).toMatch(/\.envlo[/\\]state\.db$/);
  });

  it("DDL covers inboxes, threads, messages, drafts", () => {
    for (const table of ["inboxes", "threads", "messages", "drafts"]) {
      expect(STATE_SCHEMA_SQL).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
    for (const status of [
      "DRAFT",
      "PENDING_APPROVAL",
      "APPROVED",
      "REJECTED_WITH_FEEDBACK",
      "SENT",
    ]) {
      expect(STATE_SCHEMA_SQL).toContain(`'${status}'`);
    }
    expect(STATE_SCHEMA_SQL).toContain("original_draft_markdown");
    expect(STATE_SCHEMA_SQL).toContain("final_sent_markdown");
    expect(STATE_SCHEMA_SQL).toContain("human_feedback");
  });

  it("active drafts exclude SENT only", () => {
    expect(ACTIVE_DRAFT_STATUSES).toEqual([
      "DRAFT",
      "PENDING_APPROVAL",
      "APPROVED",
      "REJECTED_WITH_FEEDBACK",
    ]);
  });
});
