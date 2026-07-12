import { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { Rule, RuleActionSpec, RuleActionType, RuleCondition, RuleField } from '../types';
import './Dialog.css';
import './RulesPage.css';

const FIELD_LABELS: Record<RuleField, string> = {
  source: 'Fonte',
  folder: 'Pasta',
  title: 'Título',
  content: 'Conteúdo',
};

const ACTION_LABELS: Record<RuleActionType, string> = {
  mark_read: 'Marcar como lido',
  star: 'Estrelar',
  apply_tag: 'Aplicar tag',
  notify_desktop: 'Notificar no desktop',
  play_sound: 'Tocar som',
};

interface RuleFormState {
  id: string | null;
  name: string;
  enabled: boolean;
  conditions: RuleCondition[];
  actionTypes: Set<RuleActionType>;
  tagName: string;
}

function emptyForm(): RuleFormState {
  return { id: null, name: '', enabled: true, conditions: [{ field: 'title', value: '' }], actionTypes: new Set(), tagName: '' };
}

function formToActions(form: RuleFormState): RuleActionSpec[] {
  return Array.from(form.actionTypes).map((type) =>
    type === 'apply_tag' ? { type, tagName: form.tagName.trim() } : { type },
  );
}

function ruleToForm(rule: Rule): RuleFormState {
  const tagAction = rule.actions.find((a) => a.type === 'apply_tag');
  return {
    id: rule.id,
    name: rule.name,
    enabled: rule.enabled,
    conditions: rule.conditions.length > 0 ? rule.conditions : [{ field: 'title', value: '' }],
    actionTypes: new Set(rule.actions.map((a) => a.type)),
    tagName: tagAction?.tagName ?? '',
  };
}

function describeConditions(conditions: RuleCondition[]): string {
  return conditions.map((c) => `${FIELD_LABELS[c.field]} contém "${c.value}"`).join(' E ');
}

function describeActions(actions: RuleActionSpec[]): string {
  return actions
    .map((a) => (a.type === 'apply_tag' ? `Aplicar tag "${a.tagName}"` : ACTION_LABELS[a.type]))
    .join(', ');
}

export function RulesPage() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [form, setForm] = useState<RuleFormState | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    api.getRules().then((r) => setRules(r.rules));
  }

  useEffect(load, []);

  function reportError(err: unknown, fallback: string) {
    setError(err instanceof ApiError ? err.message : fallback);
    setTimeout(() => setError(null), 4000);
  }

  async function handleToggleEnabled(rule: Rule) {
    try {
      await api.updateRule(rule.id, { enabled: !rule.enabled });
      load();
    } catch (err) {
      reportError(err, 'Falha ao atualizar regra.');
    }
  }

  async function handleDelete(rule: Rule) {
    if (!window.confirm(`Excluir a regra "${rule.name}"?`)) return;
    try {
      await api.deleteRule(rule.id);
      load();
    } catch (err) {
      reportError(err, 'Falha ao excluir regra.');
    }
  }

  async function handleSave() {
    if (!form) return;
    const name = form.name.trim();
    const conditions = form.conditions.filter((c) => c.value.trim().length > 0);
    const actions = formToActions(form);
    if (!name || conditions.length === 0 || actions.length === 0) {
      setError('Preencha um nome, ao menos uma condição e ao menos uma ação.');
      return;
    }
    try {
      if (form.id) {
        await api.updateRule(form.id, { name, enabled: form.enabled, conditions, actions });
      } else {
        await api.createRule({ name, enabled: form.enabled, conditions, actions });
      }
      setForm(null);
      load();
    } catch (err) {
      reportError(err, 'Falha ao salvar regra.');
    }
  }

  function updateCondition(index: number, patch: Partial<RuleCondition>) {
    if (!form) return;
    const conditions = form.conditions.map((c, i) => (i === index ? { ...c, ...patch } : c));
    setForm({ ...form, conditions });
  }

  function toggleAction(type: RuleActionType) {
    if (!form) return;
    const actionTypes = new Set(form.actionTypes);
    if (actionTypes.has(type)) actionTypes.delete(type);
    else actionTypes.add(type);
    setForm({ ...form, actionTypes });
  }

  return (
    <div className="rules-page">
      <div className="rules-header">
        <h2>Regras</h2>
        <button className="primary" onClick={() => setForm(emptyForm())}>
          + Nova regra
        </button>
      </div>
      {error && <p className="rules-error">{error}</p>}

      <div className="rules-list">
        {rules.length === 0 && <p className="rules-empty">Nenhuma regra criada ainda.</p>}
        {rules.map((rule) => (
          <div key={rule.id} className="rule-card">
            <div className="rule-card-header">
              <label className="rule-enabled-toggle">
                <input type="checkbox" checked={rule.enabled} onChange={() => handleToggleEnabled(rule)} />
                <strong>{rule.name}</strong>
              </label>
              <div className="rule-card-actions">
                <button onClick={() => setForm(ruleToForm(rule))}>Editar</button>
                <button className="danger" onClick={() => handleDelete(rule)}>
                  Excluir
                </button>
              </div>
            </div>
            <p className="rule-card-line">
              <span className="rule-card-label">SE</span> {describeConditions(rule.conditions)}
            </p>
            <p className="rule-card-line">
              <span className="rule-card-label">ENTÃO</span> {describeActions(rule.actions)}
            </p>
          </div>
        ))}
      </div>

      {form && (
        <div className="dialog-overlay" onClick={() => setForm(null)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <h2>{form.id ? 'Editar regra' : 'Nova regra'}</h2>

            <div className="dialog-row">
              <label>Nome</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="ex: Política" />
            </div>

            <p className="rule-form-section-label">SE (todas as condições precisam ser verdadeiras)</p>
            {form.conditions.map((cond, i) => (
              <div className="dialog-row" key={i}>
                <select value={cond.field} onChange={(e) => updateCondition(i, { field: e.target.value as RuleField })}>
                  {Object.entries(FIELD_LABELS).map(([field, label]) => (
                    <option key={field} value={field}>
                      {label}
                    </option>
                  ))}
                </select>
                <span>contém</span>
                <input value={cond.value} onChange={(e) => updateCondition(i, { value: e.target.value })} placeholder="texto" />
                {form.conditions.length > 1 && (
                  <button onClick={() => setForm({ ...form, conditions: form.conditions.filter((_, idx) => idx !== i) })}>
                    ✕
                  </button>
                )}
              </div>
            ))}
            <button className="link-btn" onClick={() => setForm({ ...form, conditions: [...form.conditions, { field: 'title', value: '' }] })}>
              + condição
            </button>

            <p className="rule-form-section-label">ENTÃO</p>
            <div className="rule-action-checks">
              {(Object.keys(ACTION_LABELS) as RuleActionType[]).map((type) => (
                <label key={type} className="rule-action-check">
                  <input type="checkbox" checked={form.actionTypes.has(type)} onChange={() => toggleAction(type)} />
                  {ACTION_LABELS[type]}
                </label>
              ))}
            </div>
            {form.actionTypes.has('apply_tag') && (
              <div className="dialog-row">
                <label>Tag</label>
                <input value={form.tagName} onChange={(e) => setForm({ ...form, tagName: e.target.value })} placeholder="nome da tag" />
              </div>
            )}

            <div className="dialog-actions">
              <button onClick={() => setForm(null)}>Cancelar</button>
              <button className="primary" onClick={handleSave}>
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
