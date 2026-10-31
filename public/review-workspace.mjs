import { aiRequestSession } from './core.mjs';

const MAX_SECTIONS = 6;
const sectionsFor = workspace => Array.isArray(workspace?.review?.sections) && Array.isArray(workspace?.removed)
  ? workspace.review.sections : null;
const sectionIsValid = section => section && typeof section === 'object' &&
  ['id', 'label', 'text', 'source'].every(field => typeof section[field] === 'string');

// The review remains the caller's editable object. Recovery belongs only to
// this in-memory draft and never changes its title or the remaining sections.
export function createReviewWorkspace(review, sourceKey) {
  return { review, sourceKey, removed: [], nextNote: 1 };
}

export function removeReviewSection(workspace, index) {
  const sections = sectionsFor(workspace);
  if (!sections || !Number.isInteger(index) || index < 0 || index >= sections.length || !sectionIsValid(sections[index])) return false;
  let section;
  try { section = structuredClone(sections[index]); } catch { return false; }
  workspace.removed.push({ section, index });
  sections.splice(index, 1);
  return true;
}

export function undoReviewRemoval(workspace) {
  const sections = sectionsFor(workspace);
  if (!sections || !workspace.removed.length || sections.length >= MAX_SECTIONS) return false;
  const last = workspace.removed.at(-1);
  if (!Number.isInteger(last?.index) || last.index < 0 || !sectionIsValid(last.section) || sections.some(section => section.id === last.section.id)) return false;
  sections.splice(Math.min(last.index, sections.length), 0, last.section);
  workspace.removed.pop();
  return true;
}

export function restoreAllReviewSections(workspace) {
  let restored = false;
  while (undoReviewRemoval(workspace)) restored = true;
  return restored;
}

export function addReviewNote(workspace) {
  const sections = sectionsFor(workspace);
  if (!sections || sections.length + workspace.removed.length >= MAX_SECTIONS) return false;
  const ids = new Set([...sections.map(section => section.id), ...workspace.removed.map(item => item.section?.id)]);
  let next = Number.isSafeInteger(workspace.nextNote) && workspace.nextNote > 0 ? workspace.nextNote : 1;
  while (ids.has(`note_${next}`)) next++;
  sections.push({ id: `note_${next}`, label: '我想留下的话', text: '', source: '你在整理时补写的内容' });
  workspace.nextNote = next + 1;
  return true;
}

const stringOrNull = value => typeof value === 'string' ? value : null;

// Explicitly project request inputs: callers can pass their AI state, but keys,
// request IDs, view revisions and arbitrary route properties never enter this
// comparison. Fixed property order also makes equivalent option order stable.
export function reviewSourceKey(session, options = {}) {
  const route = options?.route;
  return JSON.stringify({ session: aiRequestSession(session), options: {
    route: {
      sourceMode: stringOrNull(route?.sourceMode), providerId: stringOrNull(route?.providerId), modelId: stringOrNull(route?.modelId),
      defaultRevision: Number.isSafeInteger(route?.defaultRevision) ? route.defaultRevision : null,
    },
    configVersion: stringOrNull(options?.configVersion), consentVersion: stringOrNull(options?.consentVersion),
    allowNextStep: options?.allowNextStep === true,
  } });
}

export function isReviewStale(workspace, sourceKey) {
  return !workspace || workspace.sourceKey !== sourceKey;
}
