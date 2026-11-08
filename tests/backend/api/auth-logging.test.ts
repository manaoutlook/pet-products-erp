import { describe, it, expect, vi, beforeEach } from "vitest";
import { crypto } from "../../../server/auth";

describe("auth logging", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("does not log the password salt or hash while hashing", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const hash = await crypto.hash("test123");
    const printed = log.mock.calls.flat().join(" ");
    const salt = hash.split(".")[1];
    expect(printed).not.toContain(salt);
    expect(printed.toLowerCase()).not.toContain("salt");
  });

  it("does not log stored password material when the format is invalid", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(crypto.compare("x", "no-separator-here")).rejects.toThrow();
    const printed = err.mock.calls.flat().join(" ");
    expect(printed).not.toContain("no-separator-here");
  });
});
