// Synthetic, controlled review-only cases. This is not natural scene routing or
// an end-to-end conversation: no invented model questions or user answers.
import { MATERIAL_SAMPLES } from '../../ai/fixtures/clarity-material-samples.mjs';
import { buildClarityContext } from '../../public/clarity-contract.mjs';
import { createClaritySession, addExpression, beginClarityRequest, wireSession } from '../../public/clarity-state.mjs';

export const MATERIAL_LIVE_CASE_IDS = Object.freeze(['H06_CROSS_SENTENCE', 'H03_SELF_DOUBT', 'H08_REVISED_PLAN']);
export const MATERIAL_LIVE_LABEL = 'liubai-material-preview-1';
export const MATERIAL_LIVE_ORIGIN = 'http://127.0.0.1:4199';
export const MATERIAL_LIVE_GOAL = '核对原句、顾虑与条件';
export const MATERIAL_LIVE_TTL_MS = 20 * 60 * 1000;
export const MATERIAL_LIVE_ROUTE = Object.freeze({ sourceMode: 'default', providerId: 'bailian', modelId: 'deepseek-v4-pro-0813', defaultRevision: 3 });
export const validMaterialRunId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{8,32}$/.test(value);

export function createMaterialReviewCase(caseId, runId) {
  if (!validMaterialRunId(runId) || !MATERIAL_LIVE_CASE_IDS.includes(caseId)) throw new TypeError('invalid_material_case');
  const fixture = MATERIAL_SAMPLES.find(value => value.id === caseId);
  if (!fixture) throw new TypeError('missing_material_case');
  const session = createClaritySession();
  session.id = `material_${runId}_${caseId}`;
  for (const statement of fixture.statements) addExpression(session, statement.text, { kind: statement.kind });
  session.modeId = 'concern'; session.goal = MATERIAL_LIVE_GOAL;
  // Preserve the real begin/apply lifecycle, but force review as an explicit
  // synthetic Host test condition. Do not invent three previous dialogue turns.
  const ticket = beginClarityRequest(session);
  ticket.requestId = `material_${runId}_${caseId}`;
  ticket.context = buildClarityContext({ session: wireSession(session), revision: session.revision, stage: 'review', allowNextStep: false });
  session.pending = structuredClone(ticket);
  return { caseId, session, ticket, context: structuredClone(ticket.context), requirements: [...fixture.requirements] };
}
