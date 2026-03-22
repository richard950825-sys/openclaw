import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __testing,
  abortEmbeddedPiRun,
  clearActiveEmbeddedRun,
  isEmbeddedPiRunActive,
  setActiveEmbeddedRun,
} from "./runs.js";

type RunHandle = Parameters<typeof setActiveEmbeddedRun>[1];

function createRunHandle(
  overrides: { isCompacting?: boolean; abort?: () => void } = {},
): RunHandle {
  const abort = overrides.abort ?? (() => {});
  return {
    queueMessage: async () => {},
    isStreaming: () => true,
    isCompacting: () => overrides.isCompacting ?? false,
    abort,
  };
}

describe("pi-embedded runner lifecycle", () => {
  afterEach(() => {
    __testing.resetActiveEmbeddedRuns();
    vi.restoreAllMocks();
  });

  describe("handle identity", () => {
    it("clears the same handle object that was registered", () => {
      const handle = createRunHandle();
      const sessionId = "session-test";

      // Register a handle
      setActiveEmbeddedRun(sessionId, handle, "sessionKey");

      // Verify it's registered
      expect(isEmbeddedPiRunActive(sessionId)).toBe(true);

      // Clear with the SAME handle object
      clearActiveEmbeddedRun(sessionId, handle, "sessionKey");

      // Should be cleared
      expect(isEmbeddedPiRunActive(sessionId)).toBe(false);
    });

    it("does NOT clear if handle object is different", () => {
      const handle1 = createRunHandle();
      const handle2 = createRunHandle();
      const sessionId = "session-test";

      // Register handle1
      setActiveEmbeddedRun(sessionId, handle1, "sessionKey");

      // Try to clear with handle2 (different object)
      clearActiveEmbeddedRun(sessionId, handle2, "sessionKey");

      // Should still be registered (handle1)
      expect(isEmbeddedPiRunActive(sessionId)).toBe(true);

      // Clean up with correct handle
      clearActiveEmbeddedRun(sessionId, handle1, "sessionKey");
    });
  });

  describe("abort forwarding", () => {
    it("forwards abort to the registered handle", () => {
      const abortFn = vi.fn();
      const handle = createRunHandle({ abort: abortFn });
      const sessionId = "session-abort";

      setActiveEmbeddedRun(sessionId, handle, "sessionKey");

      abortEmbeddedPiRun(sessionId);

      expect(abortFn).toHaveBeenCalledTimes(1);

      // Cleanup
      clearActiveEmbeddedRun(sessionId, handle, "sessionKey");
    });

    it("preserves abort reason when forwarding", () => {
      const abortFn = vi.fn();
      const customReason = new Error("custom abort reason");
      const handle: RunHandle = {
        queueMessage: async () => {},
        isStreaming: () => true,
        isCompacting: () => false,
        abort: abortFn,
      };
      const sessionId = "session-reason";

      setActiveEmbeddedRun(sessionId, handle, "sessionKey");

      abortEmbeddedPiRun(sessionId, { reason: customReason });

      expect(abortFn).toHaveBeenCalledTimes(1);

      // Cleanup
      clearActiveEmbeddedRun(sessionId, handle, "sessionKey");
    });
  });
});
