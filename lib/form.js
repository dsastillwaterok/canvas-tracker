// The door form: which questions it asks, in what order, how each looks and what
// counts as a valid answer. Defined by config.form.fields; the phone renders it and
// the server validates and writes it from the same definition.
//
// A field:
//   id        a column key from config.columns (interactions by default, tenants with
//             target: "tenant"), or "h:<Header text>" for any other column, with tab
//   kind      text | textarea | tel | email | date | number | checkbox | choice | select | tags
//   list      for choice/select/tags: a lists-tab key (types, responses, grievanceTypes...)
//   options   ...or inline choices, ["Yes", "No"]
//   grouped   tags only: group the chips by config.tagGroups
//   label, hint, placeholder
//   required  true to refuse an empty answer
//   pattern   a regular expression the answer must match; patternHint says what's wanted
//   sticky    keep the answer filled in for the next conversation
//   onlyOn    checkbox on the tenant row that the door form can turn on but never off (consent)
//   section   heading shown above this field; sectionHint under it
//   row       fields sharing a row name sit side by side
//   under     render inside the previous field's box (a consent box under a phone number)

const KINDS = ['text', 'textarea', 'tel', 'email', 'date', 'number', 'checkbox', 'choice', 'select', 'tags'];
const FIXED = ['date', 'unit', 'building', 'canvasser', 'done']; // written by the app, never asked

// The Woodland Manor form. Also what older configs (formFields / extraFields) migrate to.
const DEFAULT_FIELDS = [
  { id: 'type', kind: 'choice', list: 'types', label: 'How', hint: 'stays set for your next one', required: true, sticky: true },
  { id: 'response', kind: 'choice', list: 'responses', label: 'What happened', required: true },
  { id: 'who', kind: 'text', label: 'Who you talked to', hint: 'leave blank if it was the tenant or nobody answered' },
  { id: 'discussed', kind: 'textarea', label: 'What was discussed', placeholder: 'Grievances, how they feel about the union, anything worth remembering' },
  { id: 'grievanceTypes', target: 'tenant', kind: 'tags', list: 'grievanceTypes', grouped: true, label: 'Grievances they raised', hint: 'tap all that apply' },
  { id: 'phone', target: 'tenant', kind: 'tel', label: 'Phone', row: 'contact', section: 'Contact info', sectionHint: 'if they gave it. Tick the box only if they said we may use it.' },
  { id: 'okPhone', target: 'tenant', kind: 'checkbox', label: 'OK to call or text', under: true, onlyOn: true },
  { id: 'email', target: 'tenant', kind: 'email', label: 'Email', row: 'contact' },
  { id: 'okEmail', target: 'tenant', kind: 'checkbox', label: 'OK to email', under: true, onlyOn: true },
  { id: 'followUp', kind: 'text', label: 'Follow-up needed', placeholder: 'e.g. bring a flyer', row: 'follow' },
  { id: 'followUpDate', kind: 'date', label: 'By when', row: 'follow' },
];

const trim = (v) => (v === undefined || v === null ? '' : String(v).trim());
const isHeaderId = (id) => /^h:/.test(id);
const headerOf = (f) => (isHeaderId(f.id) ? f.id.slice(2) : null);

function normalizeField(raw) {
  const f = { ...raw };
  f.id = trim(f.id);
  f.target = f.target === 'tenant' ? 'tenant' : 'interaction';
  if (!KINDS.includes(f.kind)) f.kind = 'text';
  f.label = trim(f.label) || (headerOf(f) || f.id);
  for (const k of ['hint', 'placeholder', 'pattern', 'patternHint', 'section', 'sectionHint', 'row', 'list']) f[k] = trim(f[k]);
  if (Array.isArray(f.options)) f.options = f.options.map(trim).filter(Boolean); else delete f.options;
  for (const k of ['required', 'sticky', 'grouped', 'onlyOn', 'under']) f[k] = !!f[k];
  if (f.kind !== 'checkbox') { f.onlyOn = false; f.under = false; }
  if (!['choice', 'select', 'tags'].includes(f.kind)) { delete f.list; delete f.options; f.grouped = false; }
  if (f.kind !== 'tags') f.grouped = false;
  if (f.pattern) { try { new RegExp(f.pattern); } catch { f.pattern = ''; } }
  return f;
}

// The form as configured, or migrated from the older formFields/extraFields keys.
function formSpec(config) {
  let fields;
  if (config.form && Array.isArray(config.form.fields)) {
    fields = config.form.fields;
  } else {
    const on = config.formFields || DEFAULT_FIELDS.map((f) => f.id);
    fields = DEFAULT_FIELDS.filter((f) => f.required || on.includes(f.id));
    for (const x of config.extraFields || []) {
      if (!trim(x.header)) continue;
      fields.push({ id: 'h:' + trim(x.header), kind: x.kind === 'textarea' ? 'textarea' : 'text', label: trim(x.label) || trim(x.header) });
    }
  }
  return fields.map(normalizeField).filter((f) => f.id && !FIXED.includes(f.id));
}

// Drop fields whose column the sheet doesn't have, so a form definition can be shared
// between sheets that differ a little. `cols` is { interactions: {...}, tenants: {...} }
// from Schema.tab(); _headers is the lower-cased header row.
function availableFields(spec, cols) {
  return spec.filter((f) => {
    const tab = f.target === 'tenant' ? cols.tenants : cols.interactions;
    const header = headerOf(f);
    if (header !== null) return tab._headers.includes(header.trim().toLowerCase());
    return tab[f.id] !== undefined && tab[f.id] !== -1;
  });
}

const choicesFor = (f, lists) => (f.options && f.options.length ? f.options : (lists && f.list && lists[f.list]) || []);

// Returns the first problem as a sentence, or null. `lists` may be omitted to skip list checks.
function validate(spec, input, lists) {
  for (const f of spec) {
    const v = input[f.id];
    const empty = f.kind === 'tags' ? !(Array.isArray(v) && v.length) : (f.kind === 'checkbox' ? false : !trim(v));
    if (f.required && empty) {
      if (f.kind === 'choice' || f.kind === 'select') return `Pick ${f.label.toLowerCase()}.`;
      if (f.kind === 'tags') return `Pick at least one under ${f.label}.`;
      return `${f.label} is required.`;
    }
    if (empty) continue;
    const s = trim(v);
    if (f.kind === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return `${f.label} doesn't look like an email address.`;
    if (f.kind === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${f.label} needs a date.`;
    if (f.kind === 'number' && !/^-?\d+(\.\d+)?$/.test(s)) return `${f.label} needs a number.`;
    if (f.pattern && !['checkbox', 'tags'].includes(f.kind) && !new RegExp(f.pattern).test(s)) return f.patternHint || `${f.label} isn't in the expected format.`;
    if (lists && (f.kind === 'choice' || f.kind === 'select')) {
      const ok = choicesFor(f, lists);
      if (ok.length && !ok.includes(s)) return `${f.label}: "${s}" isn't one of the choices.`;
    }
    if (lists && f.kind === 'tags') {
      const ok = choicesFor(f, lists);
      const bad = v.find((t) => ok.length && !ok.includes(t));
      if (bad) return `${f.label}: "${bad}" isn't one of the choices.`;
    }
  }
  return null;
}

module.exports = { KINDS, FIXED, DEFAULT_FIELDS, formSpec, availableFields, validate, normalizeField, headerOf, choicesFor };
