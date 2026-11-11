(() => {
  const $app = document.getElementById('app');
  const $toast = document.getElementById('toast');

  const S = {
    me: '', appName: '', lists: null, tenants: [], features: {}, formSpec: [], tagGroups: [], editable: [],
    view: 'list', q: '', onlyDue: false,
    tenant: null, showAll: false, editing: false,
    form: null, saving: false, error: '',
  };

  // ---- helpers ---------------------------------------------------------------
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const h = (strings, ...vals) => strings.reduce((a, s, i) => a + s + (i < vals.length ? vals[i] : ''), '');

  async function api(path, body) {
    const res = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  let toastTimer;
  function toast(msg) {
    $toast.textContent = msg; $toast.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { $toast.hidden = true; }, 2200);
  }

  function plate(t, size) {
    const tbd = /^TBD-/i.test(t.unit);
    const unit = tbd ? h`<span class="tbd">${esc(t.unit)}</span>` : esc(t.unit);
    const b = t.building ? esc(t.building) + '-' : '';
    return h`<span class="plate ${size}">${b}${unit}</span>`;
  }

  function statusClass(cs) {
    if (!cs) return 'plain';
    if (cs === 'Dead end') return 'stop';
    if (cs === 'Never contacted' || cs.startsWith('Overdue')) return 'go';
    return 'wait';
  }
  const statusChip = (cs) => cs ? h`<span class="status ${statusClass(cs)}">${esc(cs)}</span>` : '';

  const needsKnock = (t) => t.contactStatus === 'Never contacted' || (t.contactStatus || '').startsWith('Overdue');

  const sticky = {
    get() { try { return JSON.parse(localStorage.getItem('canvass.sticky') || '{}'); } catch { return {}; } },
    set(v) { try { localStorage.setItem('canvass.sticky', JSON.stringify(v)); } catch { /* private mode */ } },
  };
  // A fresh form: sticky answers carried over, tenant-row answers pre-filled from the tenant.
  function blankForm(t) {
    const st = sticky.get();
    const f = { building: t ? t.building : (st.building || ''), unit: t ? t.unit : '', who: '', peopleOpen: false,
      people: t && t.people ? t.people.map((p) => ({ name: p.name || '', phone: p.phone || '', email: p.email || '', okPhone: !!p.okPhone, okEmail: !!p.okEmail })) : [] };
    for (const q of S.formSpec) {
      let v = q.kind === 'tags' ? [] : q.kind === 'checkbox' ? false : '';
      if (q.sticky && st.values && q.id in st.values) v = st.values[q.id];
      if (q.target === 'tenant' && t && q.id in t && !/^h:/.test(q.id)) v = q.kind === 'tags' ? (t[q.id] || []).slice() : q.kind === 'checkbox' ? !!t[q.id] : (t[q.id] || '');
      f[q.id] = v;
    }
    return f;
  }
  function validateForm(f) {
    for (const q of S.formSpec) {
      const v = f[q.id];
      const empty = q.kind === 'tags' ? !(v && v.length) : q.kind === 'checkbox' ? false : !String(v || '').trim();
      if (q.required && empty) return (q.kind === 'choice' || q.kind === 'select') ? `Pick ${q.label.toLowerCase()}.` : q.kind === 'tags' ? `Pick at least one under ${q.label}.` : `${q.label} is required.`;
      if (empty) continue;
      const s = String(v).trim();
      if (q.kind === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return `${q.label} doesn't look like an email address.`;
      if (q.kind === 'number' && !/^-?\d+(\.\d+)?$/.test(s)) return `${q.label} needs a number.`;
      if (q.pattern && !['checkbox', 'tags'].includes(q.kind)) { try { if (!new RegExp(q.pattern).test(s)) return q.patternHint || `${q.label} isn't in the expected format.`; } catch { /* bad pattern: server decides */ } }
    }
    return null;
  }
  const stickyValues = (f) => Object.fromEntries(S.formSpec.filter((q) => q.sticky).map((q) => [q.id, f[q.id]]));
  const hasB = () => S.features.building;

  // Tags grouped by theme (config.tagGroups), in the group's order; anything ungrouped goes last.
  function tagGroups(all, grouped) {
    if (!grouped) return [{ label: '', tags: all }];
    const groups = (S.tagGroups || []).map((g) => ({ label: g.label, tags: (g.tags || []).filter((t) => all.includes(t)) })).filter((g) => g.tags.length);
    const placed = new Set(groups.flatMap((g) => g.tags));
    const rest = all.filter((t) => !placed.has(t));
    if (rest.length) groups.push({ label: groups.length ? 'Other' : '', tags: rest });
    return groups;
  }
  function tagPicker(attr, selected, all = S.lists.grievanceTypes || [], grouped = true) {
    return tagGroups(all, grouped).map((g) => h`<div class="tag-group">${g.label ? h`<span class="tag-group-label">${esc(g.label)}</span>` : ''}
      <div class="choices tags" ${attr}>${g.tags.map((v) => h`<button type="button" data-val="${esc(v)}" aria-pressed="${selected.includes(v)}">${esc(v)}</button>`).join('')}</div></div>`).join('');
  }

  // A text box that suggests previous entries as you type but accepts anything new.
  function combo(id, field, value, placeholder, attrs = '') {
    return h`<div class="combo"><input class="text" id="${id}" data-combo="${field}" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="${esc(placeholder)}" value="${esc(value)}" ${attrs}><ul class="suggest" hidden></ul></div>`;
  }
  function comboOptions(field) {
    const b = (S.form.building || '').trim();
    if (field === 'building') return (S.lists.buildings || []).map((v) => ({ value: v, label: v }));
    if (field === 'unit') {
      const seen = new Set();
      return S.tenants.filter((t) => !b || t.building === b).filter((t) => !seen.has(t.unit) && seen.add(t.unit))
        .sort((x, y) => x.unit.localeCompare(y.unit, undefined, { numeric: true }))
        .map((t) => ({ value: t.unit, label: t.unit, key: t.key }));
    }
    if (field === 'who') {
      return S.tenants.filter((t) => t.name && (!b || t.building === b))
        .sort((x, y) => x.name.localeCompare(y.name))
        .map((t) => ({ value: t.name, label: `${t.name} · ${t.key}`, key: t.key }));
    }
    return [];
  }
  const tenantFor = (building, unit) => S.tenants.find((t) => t.unit === (unit || '').trim() && (t.building || '') === (building || '').trim());

  // ---- navigation (browser history aware) -------------------------------------
  // Every screen change pushes a history entry, so the phone's back button and the
  // in-app back button do the same thing.
  function go(state, { replace = false, focus } = {}) {
    const fn = replace ? 'replaceState' : 'pushState';
    history[fn](state, '', state.view === 'list' ? '#' : '#' + state.view);
    applyState(state, focus);
  }
  function applyState(state, focus) {
    S.error = '';
    if (state.view === 'list') { S.view = 'list'; S.tenant = null; S.edit = null; S.editing = false; S.from = null; render(); return; }
    if (state.view === 'new') {
      S.view = 'new'; S.tenant = null; S.from = null;
      const f = blankForm(null);
      if (state.building !== undefined) f.building = state.building;
      if (state.unit !== undefined) f.unit = state.unit;
      S.form = f; render(); window.scrollTo(0, 0);
      if (focus) { const el = $app.querySelector('#' + focus); if (el) el.focus(); }
      return;
    }
    if (state.view === 'tenant') { S.from = state.from || null; openTenant(state.key, false, state.keepType); }
  }
  window.addEventListener('popstate', (e) => { if (e.state) applyState(e.state, e.state.focus); else applyState({ view: 'list' }); });

  // ---- rendering ---------------------------------------------------------------
  function render() {
    if (S.view === 'list') $app.innerHTML = renderList();
    else if (S.view === 'tenant') $app.innerHTML = renderTenant();
    else if (S.view === 'new') $app.innerHTML = renderNew();
    bind();
  }

  function renderList() {
    const q = S.q.trim().toLowerCase();
    let rows = S.tenants;
    if (S.onlyDue) rows = rows.filter(needsKnock);
    if (q) rows = rows.filter((t) => `${t.key} ${t.name} ${t.building} ${t.unit}`.toLowerCase().includes(q));
    rows = rows.slice().sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
    const dueCount = S.tenants.filter(needsKnock).length;

    const items = rows.map((t) => h`
      <li><button class="rowbtn" data-open="${esc(t.key)}">
        ${plate(t, 'md')}
        <span>
          <span class="name">${esc(t.name) || '<em>No name yet</em>'}</span>
          <span class="meta">${esc(t.status)}${t.lastContact ? ' · last contact ' + esc(t.lastContact) : ''}</span>
          <span class="meta">${statusChip(t.contactStatus)}</span>
        </span>
      </button></li>`).join('');

    return h`
      <div class="topbar">
        <div class="row"><span class="plate md">${esc(S.appName)}</span><span class="who">${esc(S.me)}</span></div>
        <input class="search" id="q" type="search" inputmode="search" autocomplete="off"
               placeholder="Unit, building, or name" value="${esc(S.q)}" aria-label="Search tenants">
        <div class="filters">
          <button class="chip-btn" id="onlyDue" aria-pressed="${S.onlyDue}">Needs a knock (${dueCount})</button>
          <button class="chip-btn" id="newUnit">New unit</button>
        </div>
      </div>
      ${rows.length ? h`<ul class="list">${items}</ul>` : h`<p class="empty">${q ? 'No unit or name matches that. Check the building number, or add it as a new unit.' : 'No tenants yet. Add the first one.'}</p>`}`;
  }

  function renderTenant() {
    const t = S.tenant;
    const hist = S.showAll ? t.history : t.history.slice(0, 1);
    const due = t.history.find((x) => x.followUpDate && !x.done);
    return h`
      <div class="screen">
        <div class="backrow"><button class="back" id="back">${S.from && S.from.view === 'new' ? '‹ Back to new unit' : '‹ All units'}</button><span class="who">Logging as ${esc(S.me)}</span></div>
        <div class="head">
          ${plate(t, 'lg')}
          <div class="name">${esc(t.name) || '<em>No name yet</em>'}</div>
          <div class="line">
            <span>${esc(t.status)}</span>
            ${statusChip(t.contactStatus)}
            ${t.phone ? (S.features.okPhone && !t.okPhone
              ? h`<span class="tel muted" title="Has not agreed to calls or texts">${esc(t.phone)} <span class="hint">(not OK'd for calls)</span></span>`
              : h`<a class="tel" href="tel:${esc(t.phone.replace(/[^\d+]/g, ''))}">${esc(t.phone)}</a>`) : ''}
            ${t.email ? (S.features.okEmail && !t.okEmail ? h`<span class="hint">${esc(t.email)} (not OK'd for email)</span>` : h`<a href="mailto:${esc(t.email)}">${esc(t.email)}</a>`) : ''}
            ${t.housing ? h`<span>Housing assistance: ${esc(t.housing)}</span>` : ''}
            ${t.language && t.language !== 'English' ? h`<span>${esc(t.language)}</span>` : ''}
          </div>
        </div>

        ${t.accessibility ? h`<div class="section"><div class="notice">Before you knock: ${esc(t.accessibility)}</div></div>` : ''}
        ${due ? h`<div class="section"><div class="notice go">Follow-up due ${esc(due.followUpDate)}: ${esc(due.followUp || 'see last conversation')}
          <div style="margin-top:8px"><button class="btn quiet" data-done="${due.row}">Mark done</button></div></div></div>` : ''}

        ${(t.people || []).length ? h`<div class="section"><h2>Also in this unit</h2>
          ${t.people.map((p) => h`<div class="line"><span><strong>${esc(p.name)}</strong></span>
            ${p.phone ? (S.features.okPhone && !p.okPhone ? h`<span class="hint">${esc(p.phone)} (not OK'd for calls)</span>` : h`<a class="tel" href="tel:${esc(p.phone.replace(/[^\d+]/g, ''))}">${esc(p.phone)}</a>`) : ''}
            ${p.email ? (S.features.okEmail && !p.okEmail ? h`<span class="hint">${esc(p.email)} (not OK'd for email)</span>` : h`<a href="mailto:${esc(p.email)}">${esc(p.email)}</a>`) : ''}
            ${p.notes ? h`<span class="hint">${esc(p.notes)}</span>` : ''}</div>`).join('')}</div>` : ''}
        ${(t.grievanceTypes || []).length || t.grievances ? h`<div class="section"><h2>Grievances</h2>
          ${(t.grievanceTypes || []).length ? h`<div class="chips">${t.grievanceTypes.map((g) => h`<span class="tag">${esc(g)}</span>`).join('')}</div>` : ''}
          ${t.grievances ? h`<p class="detail">${esc(t.grievances)}</p>` : ''}</div>` : ''}

        <div class="section">
          <h2>${t.history.length ? (S.showAll ? 'All conversations' : 'Last conversation') : 'No conversations logged yet'}</h2>
          ${hist.map((c) => h`<div class="convo">
            <div class="meta">${esc(c.date)} · ${esc(c.canvasser)} · ${esc(c.type)} · ${esc(c.response)}${c.who ? ' · ' + esc(c.who) : ''}</div>
            ${c.discussed ? h`<div class="body">${esc(c.discussed)}</div>` : ''}
            ${c.followUp ? h`<div class="meta" style="margin-top:4px">Follow-up: ${esc(c.followUp)}${c.followUpDate ? ' by ' + esc(c.followUpDate) : ''}${c.done ? ' (done)' : ''}</div>` : ''}
          </div>`).join('')}
          ${t.history.length > 1 && !S.showAll ? h`<p style="margin-top:8px"><button class="linkish" id="showAll">Show all ${t.history.length}</button></p>` : ''}
        </div>

        ${t.notes ? h`<div class="section"><h2>Notes</h2><p style="white-space:pre-wrap">${esc(t.notes)}</p></div>` : ''}

        <div class="section">
          ${S.editable.length ? h`<details class="more" ${S.editing ? 'open' : ''} id="editDetails"><summary>Edit tenant details</summary>
            ${renderEdit(t)}
          </details>` : ''}
          <details class="more" id="replaceDetails" ${S.replacing ? 'open' : ''}><summary>Someone new lives here</summary>
            <p class="hint" style="margin:8px 0">Use this when ${esc(t.name || 'the previous tenant')} has moved out. Their name, contact details and consents are cleared and noted in Notes; the unit's grievances and conversation history stay.</p>
            <div class="field"><label for="newName">New tenant's name</label><input class="text" id="newName" autocapitalize="words" value="${esc(S.newName || '')}"></div>
            <div class="field"><button class="btn" id="replaceTenant" ${S.replacingBusy ? 'disabled' : ''}>${S.replacingBusy ? 'Updating…' : 'Replace the tenant'}</button></div>
          </details>
        </div>

        <div class="section" id="logSection">
          <h2>Log a conversation</h2>
          ${renderLogForm()}
        </div>
      </div>
      <div class="fab-wrap"><button class="btn primary block" id="save" ${S.saving ? 'disabled' : ''}>${S.saving ? 'Saving…' : 'Save conversation'}</button></div>`;
  }

  function renderNew() {
    const f = S.form;
    return h`
      <div class="screen">
        <div class="backrow"><button class="back" id="back">‹ All units</button><span class="who">Logging as ${esc(S.me)}</span></div>
        <div class="head"><span class="plate lg">New unit</span></div>
        ${hasB() ? h`<div class="field"><label for="building">Building <span class="hint">the number on the outside; new ones are added to the list</span></label>
          ${combo('building', 'building', f.building, 'e.g. 8659', 'inputmode="numeric"')}</div>` : ''}
        <div class="field"><label for="unit">Apartment number <span class="hint">pick an existing unit or type a new one</span></label>
          ${combo('unit', 'unit', f.unit, 'e.g. 4')}</div>
        <div class="field"><label for="who">Name <span class="hint">pick someone already on file to add to their page</span></label>
          ${combo('who', 'who', f.who, 'Who you talked to, if anyone', 'autocapitalize="words"')}</div>
        <div class="section" id="logSection"><h2>The conversation</h2>${renderLogForm({ skipWho: true })}</div>
      </div>
      <div class="fab-wrap"><button class="btn primary block" id="save" ${S.saving ? 'disabled' : ''}>${S.saving ? 'Saving…' : 'Save new unit and conversation'}</button></div>`;
  }

  const choicesFor = (q) => (q.options && q.options.length ? q.options : (q.list && S.lists[q.list]) || []);

  // One question. `nested` means it sits inside the previous question's box.
  function renderQuestion(q, f) {
    const id = 'f_' + q.id.replace(/[^a-z0-9]/gi, '_');
    const lbl = (tag) => h`<${tag} class="${tag === 'label' ? '' : 'lbl'}" ${tag === 'label' ? `for="${id}"` : ''}>${esc(q.label)}${q.hint ? h` <span class="hint">${esc(q.hint)}</span>` : ''}</${tag}>`;
    const v = f[q.id];
    const attrs = `id="${id}" data-q="${esc(q.id)}" ${q.placeholder ? `placeholder="${esc(q.placeholder)}"` : ''}`;
    switch (q.kind) {
      case 'choice': return h`${lbl('span')}<div class="choices" data-choice="${esc(q.id)}">${choicesFor(q).map((c) => h`<button type="button" data-val="${esc(c)}" aria-pressed="${v === c}">${esc(c)}</button>`).join('')}</div>`;
      case 'select': return h`${lbl('label')}<select class="text" ${attrs}><option value="">${q.required ? 'Choose one' : 'None'}</option>${choicesFor(q).map((c) => h`<option ${v === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>`;
      case 'tags': return h`${lbl('span')}${tagPicker(`data-ftags="${esc(q.id)}"`, v || [], choicesFor(q), q.grouped)}`;
      case 'checkbox': return h`<label class="toggle"><input type="checkbox" data-q="${esc(q.id)}" ${v ? 'checked' : ''}> ${esc(q.label)}${q.hint ? h` <span class="hint">${esc(q.hint)}</span>` : ''}</label>`;
      case 'textarea': return h`${lbl('label')}<textarea class="textarea" ${attrs}>${esc(v)}</textarea>`;
      case 'date': return h`${lbl('label')}<input class="text" type="date" ${attrs} value="${esc(v)}">`;
      case 'number': return h`${lbl('label')}<input class="text" type="text" inputmode="decimal" ${attrs} value="${esc(v)}">`;
      case 'tel': return h`${lbl('label')}<input class="text" type="tel" ${attrs} value="${esc(v)}">`;
      case 'email': return h`${lbl('label')}<input class="text" type="email" autocapitalize="off" ${attrs} value="${esc(v)}">`;
      default: return h`${lbl('label')}<input class="text" type="text" autocomplete="off" ${attrs} value="${esc(v)}">`;
    }
  }

  // Other people in the unit: hidden behind a button until the canvasser needs it.
  const blankPerson = () => ({ name: '', phone: '', email: '', okPhone: false, okEmail: false });
  function renderPeople(f) {
    if (!S.features.people) return '';
    const n = f.people.filter((p) => p.name.trim()).length;
    if (!f.peopleOpen) return h`<div class="field"><button type="button" class="btn quiet" id="peopleOpen">${n ? `Other people in this unit (${n})` : 'Add another person in this unit'}</button></div>`;
    const list = f.people.length ? f.people : [blankPerson()];
    if (!f.people.length) f.people = list;
    return h`<div class="field people"><span class="lbl">Other people in this unit <span class="hint">roommates, family, anyone else who answers the door</span></span>
      ${list.map((p, i) => h`<div class="person">
        <label for="p_name_${i}">Name</label><input class="text" id="p_name_${i}" data-p="${i}" data-pf="name" autocapitalize="words" value="${esc(p.name)}">
        <div class="contact-pair">
          <div class="contact"><label for="p_phone_${i}">Phone</label><input class="text" id="p_phone_${i}" type="tel" data-p="${i}" data-pf="phone" value="${esc(p.phone)}">
            <label class="toggle"><input type="checkbox" data-p="${i}" data-pf="okPhone" ${p.okPhone ? 'checked' : ''}> OK to call or text</label></div>
          <div class="contact"><label for="p_email_${i}">Email</label><input class="text" id="p_email_${i}" type="email" autocapitalize="off" data-p="${i}" data-pf="email" value="${esc(p.email)}">
            <label class="toggle"><input type="checkbox" data-p="${i}" data-pf="okEmail" ${p.okEmail ? 'checked' : ''}> OK to email</label></div>
        </div></div>`).join('')}
      <button type="button" class="btn quiet" id="personAdd">Add another person</button>
    </div>`;
  }

  // Lay the questions out: section headings, side-by-side rows, and boxes with a checkbox tucked under a field.
  function renderLogForm(opts = {}) {
    const f = S.form;
    const spec = S.formSpec.filter((q) => !(opts.skipWho && q.id === 'who'));
    // Group: a question plus any `under` questions that follow it.
    const units = [];
    for (const q of spec) {
      if (q.under && units.length) units[units.length - 1].under.push(q);
      else units.push({ q, under: [] });
    }
    // Then rows: consecutive units whose lead question shares a row name.
    const blocks = [];
    for (const u of units) {
      const last = blocks[blocks.length - 1];
      if (u.q.row && last && last.row === u.q.row) last.units.push(u);
      else blocks.push({ row: u.q.row, units: [u] });
    }
    const unitHtml = (u) => {
      const boxed = u.under.length > 0;
      const inner = renderQuestion(u.q, f) + u.under.map((x) => renderQuestion(x, f)).join('');
      return boxed ? h`<div class="contact">${inner}</div>` : h`<div>${inner}</div>`;
    };
    let out = '';
    // The "other people" section follows the block that holds the tenant's own phone/email, or goes last.
    const contactBlock = blocks.findIndex((b) => b.units.some((u) => ['phone', 'email'].includes(u.q.id)));
    blocks.forEach((b, i) => {
      const lead = b.units[0].q;
      const section = lead.section ? h`<span class="lbl">${esc(lead.section)}${lead.sectionHint ? h` <span class="hint">${esc(lead.sectionHint)}</span>` : ''}</span>` : '';
      if (b.units.length > 1) out += h`<div class="field">${section}<div class="${b.units.some((u) => u.under.length) ? 'contact-pair' : 'two'}">${b.units.map(unitHtml).join('')}</div></div>`;
      else out += h`<div class="field">${section}${b.units[0].under.length ? h`<div class="contact-pair">${unitHtml(b.units[0])}</div>` : unitHtml(b.units[0]).replace(/^<div>|<\/div>$/g, '')}</div>`;
      if (i === contactBlock) out += renderPeople(f);
    });
    if (contactBlock === -1) out += renderPeople(f);
    return out + (S.error ? h`<p class="err">${esc(S.error)}</p>` : '');
  }

  function renderEdit(t) {
    const can = (f) => S.editable.includes(f) && S.features[f];
    const e = S.edit || (S.edit = {
      name: t.name || '', phone: t.phone || '', email: t.email || '', okPhone: !!t.okPhone, okEmail: !!t.okEmail, status: t.status || '', groupChat: !!t.groupChat,
      socialLead: !!t.socialLead, grievanceTypes: (t.grievanceTypes || []).slice(), accessibility: t.accessibility || '',
      notes: t.notes || '', connected: t.connected || '', housing: t.housing || '', residents: t.residents || '', grievances: t.grievances || '',
    });
    return h`
      ${can('name') ? h`<div class="field"><label for="e_name">Name</label><input class="text" id="e_name" value="${esc(e.name)}"></div>` : ''}
      ${can('phone') || can('email') || can('okPhone') || can('okEmail') ? h`<div class="field"><span class="lbl">Contact info <span class="hint">the box means they said we may use it</span></span>
        <div class="contact-pair">
          ${can('phone') || can('okPhone') ? h`<div class="contact">
            ${can('phone') ? h`<label for="e_phone">Phone</label><input class="text" id="e_phone" type="tel" value="${esc(e.phone)}">` : ''}
            ${can('okPhone') ? h`<label class="toggle"><input type="checkbox" id="e_okPhone" ${e.okPhone ? 'checked' : ''}> OK to call or text</label>` : ''}
          </div>` : ''}
          ${can('email') || can('okEmail') ? h`<div class="contact">
            ${can('email') ? h`<label for="e_email">Email</label><input class="text" id="e_email" type="email" value="${esc(e.email)}">` : ''}
            ${can('okEmail') ? h`<label class="toggle"><input type="checkbox" id="e_okEmail" ${e.okEmail ? 'checked' : ''}> OK to email</label>` : ''}
          </div>` : ''}
        </div></div>` : ''}
      ${can('status') ? h`<div class="field"><span class="lbl">Status</span><div class="choices" data-echoice="status">
        ${(S.lists.statuses || []).map((v) => h`<button type="button" data-val="${esc(v)}" aria-pressed="${e.status === v}">${esc(v)}</button>`).join('')}</div></div>` : ''}
      ${can('housing') ? h`<div class="field"><span class="lbl">Housing assistance</span><div class="choices" data-echoice="housing">
        ${(S.lists.stay || ['Yes', 'No', 'Unsure']).map((v) => h`<button type="button" data-val="${esc(v)}" aria-pressed="${e.housing === v}">${esc(v)}</button>`).join('')}</div></div>` : ''}
      ${can('grievanceTypes') ? h`<div class="field"><span class="lbl">Grievance types</span>${tagPicker('data-etags="grievanceTypes"', e.grievanceTypes)}</div>` : ''}
      ${can('grievances') ? h`<div class="field"><label for="e_griev">Grievances</label><textarea class="textarea" id="e_griev">${esc(e.grievances)}</textarea></div>` : ''}
      ${can('groupChat') || can('socialLead') ? h`<div class="field">
        ${can('groupChat') ? h`<label class="toggle"><input type="checkbox" id="e_groupChat" ${e.groupChat ? 'checked' : ''}> In the group chat</label>` : ''}
        ${can('socialLead') ? h`<label class="toggle"><input type="checkbox" id="e_socialLead" ${e.socialLead ? 'checked' : ''}> Social lead</label>` : ''}</div>` : ''}
      ${can('connected') ? h`<div class="field"><label for="e_conn">Connected to (units or names)</label><input class="text" id="e_conn" value="${esc(e.connected)}"></div>` : ''}
      ${can('residents') ? h`<div class="field"><label for="e_res">Residents in unit</label><input class="text" id="e_res" inputmode="numeric" value="${esc(e.residents)}"></div>` : ''}
      ${can('accessibility') ? h`<div class="field"><label for="e_acc">Accessibility / visit notes</label><input class="text" id="e_acc" value="${esc(e.accessibility)}" placeholder="e.g. hard of hearing, knock loud"></div>` : ''}
      ${can('notes') ? h`<div class="field"><label for="e_notes">Notes</label><textarea class="textarea" id="e_notes">${esc(e.notes)}</textarea></div>` : ''}
      <div class="field"><button class="btn" id="saveEdit">Save details</button></div>`;
  }

  // ---- events ----------------------------------------------------------------
  function bind() {
    const on = (sel, ev, fn) => { const el = $app.querySelector(sel); if (el) el.addEventListener(ev, fn); };

    on('#q', 'input', (e) => { S.q = e.target.value; const pos = e.target.selectionStart; render(); const q = $app.querySelector('#q'); q.focus(); q.setSelectionRange(pos, pos); });
    on('#onlyDue', 'click', () => { S.onlyDue = !S.onlyDue; render(); });
    on('#newUnit', 'click', () => go({ view: 'new' }));
    $app.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => go({ view: 'tenant', key: b.dataset.open })));
    on('#back', 'click', () => history.back());
    on('#showAll', 'click', () => { S.showAll = true; render(); });
    on('#editDetails', 'toggle', (e) => { S.editing = e.target.open; });
    on('#replaceDetails', 'toggle', (e) => { S.replacing = e.target.open; });
    on('#newName', 'input', (e) => { S.newName = e.target.value; });
    on('#replaceTenant', 'click', async () => {
      const name = (S.newName || '').trim();
      if (!name) { toast('Enter the new tenant\'s name.'); $app.querySelector('#newName').focus(); return; }
      if (!confirm(`Replace ${S.tenant.name || 'the current tenant'} with ${name}? Their phone, email and consents will be cleared.`)) return;
      S.replacingBusy = true; render();
      try {
        const t = await api('/api/tenant/' + encodeURIComponent(S.tenant.key) + '/replace', { name });
        S.tenant = t; S.replacing = false; S.newName = ''; S.replacingBusy = false; S.form = blankForm(t); S.edit = null; S.editing = false;
        toast('Tenant replaced'); await refreshList(); render();
      } catch (e) { S.replacingBusy = false; render(); toast(e.message); }
    });

    // Choice buttons write straight into the form so re-rendering keeps state.
    $app.querySelectorAll('[data-choice]').forEach((group) => {
      group.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
        S.form[group.dataset.choice] = b.dataset.val;
        group.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x === b));
      }));
    });
    $app.querySelectorAll('[data-echoice]').forEach((group) => {
      group.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
        S.edit[group.dataset.echoice] = b.dataset.val;
        group.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x === b));
      }));
    });
    $app.querySelectorAll('[data-ftags]').forEach((group) => {
      group.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
        const arr = S.form[group.dataset.ftags];
        const i = arr.indexOf(b.dataset.val);
        if (i === -1) arr.push(b.dataset.val); else arr.splice(i, 1);
        b.setAttribute('aria-pressed', i === -1);
      }));
    });
    $app.querySelectorAll('[data-etags]').forEach((group) => {
      group.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
        const arr = S.edit[group.dataset.etags];
        const i = arr.indexOf(b.dataset.val);
        if (i === -1) arr.push(b.dataset.val); else arr.splice(i, 1);
        b.setAttribute('aria-pressed', i === -1);
      }));
    });
    $app.querySelectorAll('[data-q]').forEach((el) => {
      if (el.type === 'checkbox') el.addEventListener('change', () => { S.form[el.dataset.q] = el.checked; });
      else el.addEventListener('input', () => { S.form[el.dataset.q] = el.value; });
    });
    $app.querySelectorAll('[data-combo]').forEach((input) => {
      const field = input.dataset.combo;
      const list = input.nextElementSibling;
      const showList = () => {
        const q = input.value.trim().toLowerCase();
        const opts = comboOptions(field).filter((o) => !q || o.label.toLowerCase().includes(q)).slice(0, 8);
        list.innerHTML = opts.map((o) => h`<li role="option" data-val="${esc(o.value)}" data-key="${esc(o.key || '')}">${esc(o.label)}</li>`).join('');
        list.hidden = !opts.length;
      };
      input.addEventListener('focus', showList);
      input.addEventListener('input', () => { S.form[field] = input.value; showList(); });
      input.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 150));
      list.addEventListener('mousedown', (e) => {
        const li = e.target.closest('li'); if (!li) return;
        e.preventDefault(); input.value = li.dataset.val; S.form[field] = li.dataset.val; list.hidden = true;
        // Picking a person or a unit that already exists means "add a conversation there", not a new row.
        const existing = li.dataset.key ? S.tenants.find((t) => t.key === li.dataset.key) : null;
        if (existing && S.view === 'new') {
          // Leave the new-unit screen in history with building and unit, name cleared and focused, for a mis-tap.
          history.replaceState({ view: 'new', building: S.form.building, unit: field === 'who' ? S.form.unit : '', focus: 'who' }, '', '#new');
          go({ view: 'tenant', key: existing.key, from: { view: 'new' }, keepType: stickyValues(S.form) });
          return;
        }
        if (field === 'building') { const u = $app.querySelector('[data-combo="unit"]'); if (u) u.focus(); }
      });
    });
    on('#e_name', 'input', (e) => { S.edit.name = e.target.value; });
    on('#e_phone', 'input', (e) => { S.edit.phone = e.target.value; });
    on('#e_email', 'input', (e) => { S.edit.email = e.target.value; });
    on('#e_acc', 'input', (e) => { S.edit.accessibility = e.target.value; });
    on('#e_notes', 'input', (e) => { S.edit.notes = e.target.value; });
    on('#e_griev', 'input', (e) => { S.edit.grievances = e.target.value; });
    on('#e_conn', 'input', (e) => { S.edit.connected = e.target.value; });
    on('#e_res', 'input', (e) => { S.edit.residents = e.target.value; });
    on('#e_okPhone', 'change', (e) => { S.edit.okPhone = e.target.checked; });
    on('#e_okEmail', 'change', (e) => { S.edit.okEmail = e.target.checked; });
    on('#e_groupChat', 'change', (e) => { S.edit.groupChat = e.target.checked; });
    on('#e_socialLead', 'change', (e) => { S.edit.socialLead = e.target.checked; });

    on('#peopleOpen', 'click', () => { S.form.peopleOpen = true; render(); const el = $app.querySelector('#p_name_0'); if (el) { el.scrollIntoView({ block: 'center' }); el.focus(); } });
    on('#personAdd', 'click', () => { S.form.people.push(blankPerson()); render(); const i = S.form.people.length - 1; const el = $app.querySelector('#p_name_' + i); if (el) { el.scrollIntoView({ block: 'center' }); el.focus(); } });
    $app.querySelectorAll('[data-p]').forEach((el) => {
      const p = () => S.form.people[parseInt(el.dataset.p, 10)];
      if (el.type === 'checkbox') el.addEventListener('change', () => { p()[el.dataset.pf] = el.checked; });
      else el.addEventListener('input', () => { p()[el.dataset.pf] = el.value; });
    });
    on('#save', 'click', save);
    on('#saveEdit', 'click', saveEdit);
    $app.querySelectorAll('[data-done]').forEach((b) => b.addEventListener('click', async () => {
      try { await api(`/api/followup/${b.dataset.done}/done`, {}); toast('Follow-up marked done'); await openTenant(S.tenant.key, true); }
      catch (e) { toast(e.message); }
    }));
  }

  async function openTenant(key, keepForm, keepType) {
    try {
      const t = await api('/api/tenant/' + encodeURIComponent(key));
      S.tenant = t; S.view = 'tenant'; S.showAll = false; S.error = '';
      if (!keepForm) { S.form = blankForm(t); if (keepType) Object.assign(S.form, keepType); S.edit = null; S.editing = false; }
      render(); window.scrollTo(0, 0);
    } catch (e) { toast(e.message); }
  }

  async function save() {
    const f = S.form;
    S.error = '';
    if (S.view === 'new' && !f.unit.trim()) S.error = 'Enter the apartment number.';
    else S.error = validateForm(f) || '';
    if (!S.error) for (const p of f.people) {
      if (!p.name.trim() && (p.phone.trim() || p.email.trim() || p.okPhone || p.okEmail)) { S.error = 'Give the other person a name, or clear their details.'; break; }
      if (p.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email.trim())) { S.error = `${p.name.trim() || 'The other person'}'s email doesn't look right.`; break; }
    }
    if (S.error) { render(); $app.querySelector('.err').scrollIntoView({ block: 'center' }); return; }
    S.saving = true; render();
    try {
      const r = await api('/api/interaction', { ...f, people: f.people.filter((p) => p.name.trim()) });
      sticky.set({ building: f.building, values: stickyValues(f) });
      S.saving = false; render();
      toast(r.created ? 'Saved. New unit added.' : 'Saved');
      await refreshList();
      go({ view: 'tenant', key: r.key }, { replace: true });
    } catch (e) { S.saving = false; S.error = e.message; render(); }
  }

  async function saveEdit() {
    try {
      const payload = {};
      for (const [k, v] of Object.entries(S.edit)) if (S.editable.includes(k) && S.features[k]) payload[k] = v;
      const t = await api('/api/tenant/' + encodeURIComponent(S.tenant.key), payload);
      S.tenant = t; S.edit = null; S.editing = false; toast('Details saved');
      await refreshList(); render();
    } catch (e) { toast(e.message); }
  }

  async function refreshList() {
    const b = await api('/api/bootstrap');
    S.me = b.me; S.appName = b.appName; S.lists = b.lists; S.tenants = b.tenants;
    S.features = b.features || {}; S.formSpec = b.form || []; S.tagGroups = b.tagGroups || []; S.editable = b.editable || [];
    document.title = `${S.appName} canvass`;
  }

  (async () => {
    try { await refreshList(); go({ view: 'list' }, { replace: true }); }
    catch (e) { $app.innerHTML = `<p class="empty">${esc(e.message)}</p>`; }
  })();
})();
