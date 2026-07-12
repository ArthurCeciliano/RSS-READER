import { describe, expect, it } from 'vitest';
import {
  collectActionsForContext,
  matchesCondition,
  parseActions,
  parseConditions,
  ruleMatches,
  type RuleContext,
  type RuleRecord,
} from '../src/modules/rules/ruleEngine.js';

const ctx: RuleContext = {
  sourceTitle: 'Filipe Boni',
  folderName: 'YT- NEWS',
  title: 'A Indústria dos Games Tá F*dida com GTA 6',
  content: 'Me segue lá no Instagram, chave pix, torne-se membro do canal',
};

describe('matchesCondition', () => {
  it('matches a substring case-insensitively', () => {
    expect(matchesCondition({ field: 'title', value: 'gta 6' }, ctx)).toBe(true);
    expect(matchesCondition({ field: 'title', value: 'GTA 6' }, ctx)).toBe(true);
    expect(matchesCondition({ field: 'title', value: 'zelda' }, ctx)).toBe(false);
  });

  it('reads the right context field', () => {
    expect(matchesCondition({ field: 'source', value: 'boni' }, ctx)).toBe(true);
    expect(matchesCondition({ field: 'folder', value: 'yt-' }, ctx)).toBe(true);
    expect(matchesCondition({ field: 'content', value: 'pix' }, ctx)).toBe(true);
  });

  it('treats a null folderName as an empty string', () => {
    expect(matchesCondition({ field: 'folder', value: 'anything' }, { ...ctx, folderName: null })).toBe(false);
  });
});

describe('ruleMatches', () => {
  it('requires every condition to match (AND)', () => {
    expect(ruleMatches([{ field: 'source', value: 'boni' }, { field: 'title', value: 'gta' }], ctx)).toBe(true);
    expect(ruleMatches([{ field: 'source', value: 'boni' }, { field: 'title', value: 'zelda' }], ctx)).toBe(false);
  });

  it('never matches with zero conditions', () => {
    expect(ruleMatches([], ctx)).toBe(false);
  });
});

describe('parseConditions / parseActions', () => {
  it('filters out malformed entries instead of throwing', () => {
    expect(parseConditions([{ field: 'title', value: 'x' }, { field: 'bogus', value: 'x' }, 'nope', null])).toEqual([
      { field: 'title', value: 'x' },
    ]);
    expect(parseActions([{ type: 'mark_read' }, { type: 'not_a_real_action' }, 42])).toEqual([{ type: 'mark_read' }]);
  });

  it('returns empty for non-array json', () => {
    expect(parseConditions(null)).toEqual([]);
    expect(parseActions(undefined)).toEqual([]);
  });
});

describe('collectActionsForContext', () => {
  const rules: RuleRecord[] = [
    {
      id: '1',
      enabled: true,
      conditions: [{ field: 'source', value: 'boni' }],
      actions: [{ type: 'star' }, { type: 'apply_tag', tagName: 'politica' }],
    },
    {
      id: '2',
      enabled: true,
      conditions: [{ field: 'title', value: 'zelda' }],
      actions: [{ type: 'mark_read' }],
    },
    {
      id: '3',
      enabled: false,
      conditions: [{ field: 'source', value: 'boni' }],
      actions: [{ type: 'notify_desktop' }],
    },
  ];

  it('only collects actions from enabled rules whose conditions match', () => {
    const actions = collectActionsForContext(rules, ctx);
    expect(actions).toEqual([{ type: 'star' }, { type: 'apply_tag', tagName: 'politica' }]);
  });

  it('returns nothing when no rule matches', () => {
    expect(collectActionsForContext(rules, { ...ctx, sourceTitle: 'Someone Else', title: 'unrelated' })).toEqual([]);
  });
});
