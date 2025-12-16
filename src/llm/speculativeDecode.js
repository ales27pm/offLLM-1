import { ensureModel } from './modelManager';
import { preferredQuantization } from './runtimePolicy';
import { proposeDraftTokens } from './draftPropose';
import { verifyDraftTokens } from './verifyDraft';

export async function speculativeStep({ tokens, maxDraftTokens = 4 }) {
  await ensureModel('int4');
  const draft = await proposeDraftTokens({ tokens, maxDraftTokens });

  if (draft.length === 0) return [];

  await ensureModel(preferredQuantization());
  return verifyDraftTokens({ prefixTokens: tokens, draftTokens: draft });
}

