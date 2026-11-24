import { describe, expect, it } from "vitest";
import { isDuplicateError } from "./schedule-write-error";

describe("isDuplicateError", () => {
  it("reconhece o código 23505 e a mensagem do Postgres", () => {
    expect(isDuplicateError({ code: "23505", message: "x" })).toBe(true);
    expect(isDuplicateError({ message: 'duplicate key value violates unique constraint "daily_allocations_schedule_id_collaborator_id_key"' })).toBe(true);
    expect(isDuplicateError({ code: "42501", message: "permission denied" })).toBe(false);
    expect(isDuplicateError(null)).toBe(false);
  });
});
