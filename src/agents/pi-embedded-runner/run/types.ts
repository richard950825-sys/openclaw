import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { Api, AssistantMessage, Model } from "@mariozechner/pi-ai";
import type { AuthStorage, ModelRegistry } from "@mariozechner/pi-coding-agent";
import type { ThinkLevel } from "../../../auto-reply/thinking.js";
import type { SessionSystemPromptReport } from "../../../config/sessions/types.js";
import type { ContextEngine } from "../../../context-engine/types.js";
import type { EmbeddedPiQueueHandle } from "../runs.js";

/**
 * A mutable container passed from the outer run to each attempt.
 * The attempt writes its live handle and abort function here SYNCHRONOUSLY
 * (before any await), so the outer wrapper can forward queueMessage /
 * isStreaming / isCompacting / abort to the in-flight attempt immediately,
 * not just after the await returns.
 */
export type MutableAttemptRef = {
  current?: {
    /** The attempt's live queueHandle (queueMessage / isStreaming / isCompacting). */
    queueHandle: EmbeddedPiQueueHandle;
    /** The attempt's abortRun function for immediate abort forwarding. */
    abortRun: (isTimeout?: boolean, reason?: unknown) => void;
  };
};
import type { PluginHookBeforeAgentStartResult } from "../../../plugins/types.js";
import type { MessagingToolSend } from "../../pi-embedded-messaging.js";
import type { NormalizedUsage } from "../../usage.js";
import type { RunEmbeddedPiAgentParams } from "./params.js";

type EmbeddedRunAttemptBase = Omit<
  RunEmbeddedPiAgentParams,
  "provider" | "model" | "authProfileId" | "authProfileIdSource" | "thinkLevel" | "lane" | "enqueue"
>;

export type EmbeddedRunAttemptParams = EmbeddedRunAttemptBase & {
  /** Pluggable context engine for ingest/assemble/compact lifecycle. */
  contextEngine?: ContextEngine;
  /**
   * Mutable container for the outer wrapper to receive the attempt's live handle
   * and abort function BEFORE any await. Written synchronously at the top of
   * runEmbeddedAttempt, read after the await returns. Enables outer forwarding
   * of queueMessage/isStreaming/isCompacting/abort to the in-flight attempt.
   */
  attemptRef?: MutableAttemptRef;
  /** Resolved model context window in tokens for assemble/compact budgeting. */
  contextTokenBudget?: number;
  /** Auth profile resolved for this attempt's provider/model call. */
  authProfileId?: string;
  /** Source for the resolved auth profile (user-locked or automatic). */
  authProfileIdSource?: "auto" | "user";
  provider: string;
  modelId: string;
  model: Model<Api>;
  authStorage: AuthStorage;
  modelRegistry: ModelRegistry;
  thinkLevel: ThinkLevel;
  legacyBeforeAgentStartResult?: PluginHookBeforeAgentStartResult;
  /**
   * Stable queue handle created by the outer run loop. When provided, the
   * attempt uses it instead of creating its own, and the outer run is
   * responsible for setActiveEmbeddedRun / clearActiveEmbeddedRun.
   */
  queueHandle?: EmbeddedPiQueueHandle;
  /**
   * Keep the active-run registry entry alive until the caller explicitly
   * clears it. Used when retry/failover pacing happens after the attempt
   * returns, so the session does not look idle between attempts.
   */
  deferActiveRunCleanup?: boolean;
};

export type EmbeddedRunAttemptResult = {
  aborted: boolean;
  timedOut: boolean;
  /** True if the timeout occurred while compaction was in progress or pending. */
  timedOutDuringCompaction: boolean;
  promptError: unknown;
  sessionIdUsed: string;
  bootstrapPromptWarningSignaturesSeen?: string[];
  bootstrapPromptWarningSignature?: string;
  systemPromptReport?: SessionSystemPromptReport;
  messagesSnapshot: AgentMessage[];
  assistantTexts: string[];
  toolMetas: Array<{ toolName: string; meta?: string }>;
  lastAssistant: AssistantMessage | undefined;
  lastToolError?: {
    toolName: string;
    meta?: string;
    error?: string;
    mutatingAction?: boolean;
    actionFingerprint?: string;
  };
  didSendViaMessagingTool: boolean;
  didSendDeterministicApprovalPrompt?: boolean;
  messagingToolSentTexts: string[];
  messagingToolSentMediaUrls: string[];
  messagingToolSentTargets: MessagingToolSend[];
  successfulCronAdds?: number;
  cloudCodeAssistFormatError: boolean;
  attemptUsage?: NormalizedUsage;
  compactionCount?: number;
  /** Client tool call detected (OpenResponses hosted tools). */
  clientToolCall?: { name: string; params: Record<string, unknown> };
  /** True when sessions_yield tool was called during this attempt. */
  yieldDetected?: boolean;
  /**
   * The attempt's active queueHandle. Stored so the outer run can forward
   * queueMessage / isStreaming / isCompacting calls to the current attempt.
   */
  queueHandle?: EmbeddedPiQueueHandle;
};
