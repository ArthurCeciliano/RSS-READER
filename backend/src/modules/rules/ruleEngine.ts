export type RuleField = 'source' | 'folder' | 'title' | 'content';

export interface RuleCondition {
  field: RuleField;
  value: string;
}

export type RuleActionType = 'mark_read' | 'star' | 'apply_tag' | 'notify_desktop' | 'play_sound';

export interface RuleActionSpec {
  type: RuleActionType;
  tagName?: string;
}

export interface RuleContext {
  sourceTitle: string;
  folderName: string | null;
  title: string;
  content: string;
}

export interface RuleRecord {
  id: string;
  enabled: boolean;
  conditions: unknown;
  actions: unknown;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

const VALID_FIELDS: RuleField[] = ['source', 'folder', 'title', 'content'];
const VALID_ACTION_TYPES: RuleActionType[] = ['mark_read', 'star', 'apply_tag', 'notify_desktop', 'play_sound'];

export function parseConditions(json: unknown): RuleCondition[] {
  if (!Array.isArray(json)) return [];
  return json.filter((c): c is RuleCondition => {
    if (!isRecord(c)) return false;
    return VALID_FIELDS.includes(c.field as RuleField) && typeof c.value === 'string' && c.value.length > 0;
  });
}

export function parseActions(json: unknown): RuleActionSpec[] {
  if (!Array.isArray(json)) return [];
  return json.filter((a): a is RuleActionSpec => isRecord(a) && VALID_ACTION_TYPES.includes(a.type as RuleActionType));
}

function fieldValue(field: RuleField, ctx: RuleContext): string {
  switch (field) {
    case 'source':
      return ctx.sourceTitle;
    case 'folder':
      return ctx.folderName ?? '';
    case 'title':
      return ctx.title;
    case 'content':
      return ctx.content;
  }
}

/** "SE [fonte/pasta/título/conteúdo contém X]" -- case-insensitive substring match. */
export function matchesCondition(condition: RuleCondition, ctx: RuleContext): boolean {
  return fieldValue(condition.field, ctx).toLowerCase().includes(condition.value.toLowerCase());
}

/** A rule with no conditions never matches -- an empty SE has no meaning to fire ENTAO. */
export function ruleMatches(conditions: RuleCondition[], ctx: RuleContext): boolean {
  if (conditions.length === 0) return false;
  return conditions.every((c) => matchesCondition(c, ctx));
}

/** Flattened, deduped actions from every enabled rule whose conditions all match. */
export function collectActionsForContext(rules: RuleRecord[], ctx: RuleContext): RuleActionSpec[] {
  const actions: RuleActionSpec[] = [];
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (!ruleMatches(parseConditions(rule.conditions), ctx)) continue;
    actions.push(...parseActions(rule.actions));
  }
  return actions;
}
