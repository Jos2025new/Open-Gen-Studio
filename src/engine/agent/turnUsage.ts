import type { ChatMessageMeta, ChatMessageUsage } from '../feedMeta';
import type { ChatResult } from '../providers/llm';
import type { AssistantFeedItem, LlmProviderId } from '../types';
import { patchSession, updateFeedItem } from '../../store/store';
import { addSpend } from '../../store/spend';
import { recordMetric } from './metrics';

export interface TurnUsageTracker {
  clearPending: () => void;
  pendingMeta: (baseMeta: ChatMessageMeta, hasBubble: boolean) => ChatMessageMeta;
  takePendingMeta: (baseMeta: ChatMessageMeta, hasBubble: boolean) => ChatMessageMeta;
  recordCallUsage: (opts: {
    sessionId: string;
    provider: LlmProviderId;
    model: string;
    result: ChatResult;
    llmUsd: number;
    hasCatalogPrice: boolean;
    wrapUp: boolean;
    textItemId: string | null;
    hasBubble: boolean;
    bubbleMeta: ChatMessageMeta;
    bookedByGate?: boolean;
  }) => void;
}

/** Tracks pending token usage and cost across tool-calling rounds of a single agent turn. */
export function createTurnUsageTracker(): TurnUsageTracker {
  let pendingUsage: ChatMessageUsage | undefined;
  let pendingCost = 0;
  let pendingHasCost = false;
  let pendingEstimated = false;

  const clearPending = () => {
    pendingUsage = undefined;
    pendingCost = 0;
    pendingHasCost = false;
    pendingEstimated = false;
  };

  const pendingMeta = (baseMeta: ChatMessageMeta, hasBubble: boolean): ChatMessageMeta => {
    if (hasBubble || (!pendingUsage && !pendingHasCost)) return baseMeta;
    return {
      ...baseMeta,
      ...(pendingUsage ? { usage: pendingUsage } : {}),
      ...(pendingHasCost ? { costUsd: pendingCost, costEstimated: pendingEstimated } : {}),
    };
  };

  const takePendingMeta = (baseMeta: ChatMessageMeta, hasBubble: boolean): ChatMessageMeta => {
    const m = pendingMeta(baseMeta, hasBubble);
    if (!hasBubble) clearPending();
    return m;
  };

  const recordCallUsage: TurnUsageTracker['recordCallUsage'] = ({
    sessionId,
    provider,
    model,
    result,
    llmUsd,
    hasCatalogPrice,
    wrapUp,
    textItemId,
    hasBubble,
    bubbleMeta,
    bookedByGate,
  }) => {
    // Every tier counts: the provider's reported cost, else tokens × the catalog price (marked estimated). Never blocks.
    recordMetric(sessionId, {
      type: 'call',
      inputTokens: result.usage?.inputTokens ?? 0,
      outputTokens: result.usage?.outputTokens ?? 0,
      usd: llmUsd,
      wrapUp,
      timing: { ...result.timing, reasoningTokens: result.usage?.reasoningTokens, cachedTokens: result.usage?.cachedTokens },
    });
    if (!bookedByGate) addSpend(llmUsd, { category: 'agent', provider, model, sessionId, estimated: result.usage?.costUsd == null });
    if (result.usage) {
      const u = result.usage;
      patchSession(sessionId, (s) => ({
        ...s,
        usage: { inputTokens: s.usage.inputTokens + u.inputTokens, outputTokens: s.usage.outputTokens + u.outputTokens, llmUsd: s.usage.llmUsd + llmUsd },
      }));
      const cachedTokens = (pendingUsage?.cachedTokens ?? 0) + (u.cachedTokens ?? 0);
      const reasoningTokens = (pendingUsage?.reasoningTokens ?? 0) + (u.reasoningTokens ?? 0);
      pendingUsage = {
        inputTokens: (pendingUsage?.inputTokens ?? 0) + u.inputTokens,
        outputTokens: (pendingUsage?.outputTokens ?? 0) + u.outputTokens,
        ...(cachedTokens > 0 ? { cachedTokens } : {}),
        ...(reasoningTokens > 0 ? { reasoningTokens } : {}),
      };
      if (u.costUsd != null || hasCatalogPrice) {
        pendingCost += llmUsd;
        pendingHasCost = true;
        pendingEstimated = pendingEstimated || u.costUsd == null;
      }
    }
    if (hasBubble && textItemId && (pendingUsage || pendingHasCost)) {
      updateFeedItem<AssistantFeedItem>(sessionId, textItemId, {
        meta: {
          ...bubbleMeta,
          ...(pendingUsage ? { usage: pendingUsage } : {}),
          ...(pendingHasCost ? { costUsd: pendingCost, costEstimated: pendingEstimated } : {}),
        },
      });
    }
  };

  return { clearPending, pendingMeta, takePendingMeta, recordCallUsage };
}
