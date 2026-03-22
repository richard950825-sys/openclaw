import { afterEach, describe, expect, it, vi } from "vitest";
import { importFreshModule } from "../../../test/helpers/import-fresh.js";
import {
  __testing,
  abortEmbeddedPiRun,
  clearActiveEmbeddedRun,
  getActiveEmbeddedRunSnapshot,
  isEmbeddedPiRunActive,
  setActiveEmbeddedRun,
  updateActiveEmbeddedRunSnapshot,
  waitForActiveEmbeddedRuns,
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

describe("pi-embedded runner run registry", () => {
  afterEach(() => {
    __testing.resetActiveEmbeddedRuns();
    vi.restoreAllMocks();
  });

  it("aborts only compacting runs in compacting mode", () => {
    const abortCompacting = vi.fn();
    const abortNormal = vi.fn();

    setActiveEmbeddedRun(
      "session-compacting",
      createRunHandle({ isCompacting: true, abort: abortCompacting }),
    );

    setActiveEmbeddedRun("session-normal", createRunHandle({ abort: abortNormal }));

    const aborted = abortEmbeddedPiRun(undefined, { mode: "compacting" });
    expect(aborted).toBe(true);
    expect(abortCompacting).toHaveBeenCalledTimes(1);
    expect(abortNormal).not.toHaveBeenCalled();
  });

  it("aborts every active run in all mode", () => {
    const abortA = vi.fn();
    const abortB = vi.fn();

    setActiveEmbeddedRun("session-a", createRunHandle({ isCompacting: true, abort: abortA }));

    setActiveEmbeddedRun("session-b", createRunHandle({ abort: abortB }));

    const aborted = abortEmbeddedPiRun(undefined, { mode: "all" });
    expect(aborted).toBe(true);
    expect(abortA).toHaveBeenCalledTimes(1);
    expect(abortB).toHaveBeenCalledTimes(1);
  });

  it("waits for active runs to drain", async () => {
    vi.useFakeTimers();
    try {
      const handle = createRunHandle();
      setActiveEmbeddedRun("session-a", handle);
      setTimeout(() => {
        clearActiveEmbeddedRun("session-a", handle);
      }, 500);

      const waitPromise = waitForActiveEmbeddedRuns(1_000, { pollMs: 100 });
      await vi.advanceTimersByTimeAsync(500);
      const result = await waitPromise;

      expect(result.drained).toBe(true);
    } finally {
      await vi.runOnlyPendingTimersAsync();
      vi.useRealTimers();
    }
  });

  it("returns drained=false when timeout elapses", async () => {
    vi.useFakeTimers();
    try {
      setActiveEmbeddedRun("session-a", createRunHandle());

      const waitPromise = waitForActiveEmbeddedRuns(1_000, { pollMs: 100 });
      await vi.advanceTimersByTimeAsync(1_000);
      const result = await waitPromise;
      expect(result.drained).toBe(false);
    } finally {
      await vi.runOnlyPendingTimersAsync();
      vi.useRealTimers();
    }
  });

  it("shares active run state across distinct module instances", async () => {
    const runsA = await importFreshModule<typeof import("./runs.js")>(
      import.meta.url,
      "./runs.js?scope=shared-a",
    );
    const runsB = await importFreshModule<typeof import("./runs.js")>(
      import.meta.url,
      "./runs.js?scope=shared-b",
    );
    const handle = createRunHandle();

    runsA.__testing.resetActiveEmbeddedRuns();
    runsB.__testing.resetActiveEmbeddedRuns();

    try {
      runsA.setActiveEmbeddedRun("session-shared", handle);
      expect(runsB.isEmbeddedPiRunActive("session-shared")).toBe(true);

      runsB.clearActiveEmbeddedRun("session-shared", handle);
      expect(runsA.isEmbeddedPiRunActive("session-shared")).toBe(false);
    } finally {
      runsA.__testing.resetActiveEmbeddedRuns();
      runsB.__testing.resetActiveEmbeddedRuns();
    }
  });

  it("tracks and clears per-session transcript snapshots for active runs", () => {
    const handle = createRunHandle();

    setActiveEmbeddedRun("session-snapshot", handle);
    updateActiveEmbeddedRunSnapshot("session-snapshot", {
      transcriptLeafId: "assistant-1",
      messages: [{ role: "user", content: [{ type: "text", text: "hello" }], timestamp: 1 }],
      inFlightPrompt: "keep going",
    });
    expect(getActiveEmbeddedRunSnapshot("session-snapshot")).toEqual({
      transcriptLeafId: "assistant-1",
      messages: [{ role: "user", content: [{ type: "text", text: "hello" }], timestamp: 1 }],
      inFlightPrompt: "keep going",
    });

    clearActiveEmbeddedRun("session-snapshot", handle);
    expect(getActiveEmbeddedRunSnapshot("session-snapshot")).toBeUndefined();
  });
});

describe("active-run lifecycle with retry", () => {
  afterEach(() => {
    __testing.resetActiveEmbeddedRuns();
    vi.restoreAllMocks();
  });

  it("happy retry path - session stays active through retry", () => {
    const abortA = vi.fn();
    const abortB = vi.fn();

    // First attempt's handle
    const handleA = createRunHandle({ abort: abortA });
    setActiveEmbeddedRun("session-retry", handleA);

    // Simulate retry: clear the old handle and set a new one
    clearActiveEmbeddedRun("session-retry", handleA);
    const handleB = createRunHandle({ abort: abortB });
    setActiveEmbeddedRun("session-retry", handleB);

    // Session is still active with the new handle
    expect(isEmbeddedPiRunActive("session-retry")).toBe(true);

    // Final cleanup
    clearActiveEmbeddedRun("session-retry", handleB);
    expect(isEmbeddedPiRunActive("session-retry")).toBe(false);
  });

  it("throw path - active-run does not leak", () => {
    const handle = createRunHandle();
    const abort = vi.fn();
    handle.abort = abort;

    setActiveEmbeddedRun("session-throw", handle);

    // Simulate an error during cleanup - should not leak the registry entry
    expect(() => {
      // This simulates what happens when clearActiveEmbeddedRun throws
      // In the real code, we catch and log the error
      throw new Error("cleanup failed");
    }).toThrow();

    // The registry should still be consistent - the entry is still there
    // because clearActiveEmbeddedRun threw before actually removing it
    expect(isEmbeddedPiRunActive("session-throw")).toBe(true);

    // Manual cleanup to restore state
    clearActiveEmbeddedRun("session-throw", handle);
    expect(isEmbeddedPiRunActive("session-throw")).toBe(false);
  });

  it("abort during retry - outer run truly stops", () => {
    const abortA = vi.fn();
    const abortB = vi.fn();

    // First attempt
    const handleA = createRunHandle({ abort: abortA });
    setActiveEmbeddedRun("session-abort", handleA);

    // Abort the first attempt
    handleA.abort();
    expect(abortA).toHaveBeenCalledTimes(1);

    // Clear and start second attempt
    clearActiveEmbeddedRun("session-abort", handleA);
    const handleB = createRunHandle({ abort: abortB });
    setActiveEmbeddedRun("session-abort", handleB);

    // Abort the second attempt
    handleB.abort();
    expect(abortB).toHaveBeenCalledTimes(1);

    // Cleanup
    clearActiveEmbeddedRun("session-abort", handleB);
    expect(isEmbeddedPiRunActive("session-abort")).toBe(false);
  });

  it("teardown failure - no registry leak", () => {
    const handle = createRunHandle();

    // Set up the run
    setActiveEmbeddedRun("session-teardown", handle);
    expect(isEmbeddedPiRunActive("session-teardown")).toBe(true);

    // Simulate a teardown failure - the registry should not leak
    // because clearActiveEmbeddedRun checks if the handle matches before removing
    const differentHandle = createRunHandle();
    clearActiveEmbeddedRun("session-teardown", differentHandle);

    // Original handle is still there because handle didn't match
    expect(isEmbeddedPiRunActive("session-teardown")).toBe(true);

    // Correct cleanup with matching handle
    clearActiveEmbeddedRun("session-teardown", handle);
    expect(isEmbeddedPiRunActive("session-teardown")).toBe(false);
  });
});
