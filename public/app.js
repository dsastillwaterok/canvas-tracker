(() => {
  const $app = document.getElementById('app');
  const $toast = document.getElementById('toast');

  const S = {
    me: '', appName: '', lists: null, tenants: [], features: {}, interactionFields: {}, formFields: [], extraFields: [], editable: [],
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
  function blankForm(t) {
    const st = sticky.get();
    return {
      building: t ? t.building : (st.building || ''), unit: t ? t.unit : '', who: '',
      type: st.type || '', response: '', discussed: '', followUp: '', followUpDate: '', phone: '', email: '', okPhone: false, okEmail: false, extra: {},
    };
  }
  const show = (f) => S.formFields.includes(f) && (['phone', 'email', 'okPhone', 'okEmail'].includes(f) ? S.features[f] : S.interactionFields[f]);
  const hasB = () => S.features.building;

  // A text box that suggests previous entries as you type but accepts anything new.
  function combo(id, field, value, placeholder, attrs = '') {
    return h`<div class="combo"><input class="text" id="${id}" data-combo="${field}" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="${esc(placeholder)}" value="${esc(value)}" ${attrs}><ul class="suggest" hidden></ul></div>`;
  }
  function comboOptions(field) {
    if (field === 'building') return (S.lists.buildings || []).slice();
    if (field === 'unit') {
      const b = (S.form.building || '').trim();
      const units = S.tenants.filter((t) => !b || t.building === b).map((t) => t.unit);
      return [...new Set(units)].sort((a, c) => a.localeCompare(c, undefined, { numeric: true }));
    }
    return [];
  }

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
        <div class="backrow"><button class="back" id="back">‹ All units</button><span class="who">Logging as ${esc(S.me)}</span></div>
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

        ${(t.grievanceTypes || []).length || t.grievances ? h`<div class="section"><h2>Grievances</h2>
          <div class="chips">${(t.grievanceTypes || []).map((g) => h`<span class="tag">${esc(g)}</span>`).join('')}</div>
          ${t.grievances ? h`<p style="margin-top:8px;white-space:pre-wrap">${esc(t.grievances)}</p>` : ''}</div>` : ''}

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
        <div class="field"><label for="who">Name</label>
          <input class="text" id="who" autocomplete="off" placeholder="Who you talked to, if anyone" value="${esc(f.who)}"></div>
        <div class="section" id="logSection"><h2>The conversation</h2>${renderLogForm({ skipWho: true })}</div>
      </div>
      <div class="fab-wrap"><button class="btn primary block" id="save" ${S.saving ? 'disabled' : ''}>${S.saving ? 'Saving…' : 'Save new unit and conversation'}</button></div>`;
  }

  function renderLogForm(opts = {}) {
    const f = S.form;
    const choice = (name, values) => h`<div class="choices" data-choice="${name}">
      ${values.map((v) => h`<button type="button" data-val="${esc(v)}" aria-pressed="${f[name] === v}">${esc(v)}</button>`).join('')}</div>`;
    return h`
      <div class="field"><span class="lbl">How <span class="hint">stays set for your next one</span></span>${choice('type', S.lists.types)}</div>
      <div class="field"><span class="lbl">What happened</span>${choice('response', S.lists.responses)}</div>
      ${opts.skipWho || !show('who') ? '' : h`<div class="field"><label for="who">Who you talked to <span class="hint">leave blank if it was ${esc(S.tenant && S.tenant.name ? S.tenant.name : 'the tenant')} or nobody answered</span></label>
        <input class="text" id="who" autocomplete="off" value="${esc(f.who)}"></div>`}
      ${show('discussed') ? h`<div class="field"><label for="discussed">What was discussed</label>
        <textarea class="textarea" id="discussed" placeholder="Grievances, how they feel about the union, anything worth remembering">${esc(f.discussed)}</textarea></div>` : ''}
      ${S.extraFields.map((x) => h`<div class="field"><label for="x_${esc(x.header)}">${esc(x.label || x.header)}</label>
        ${x.kind === 'textarea' ? h`<textarea class="textarea" data-extra="${esc(x.header)}">${esc(f.extra[x.header] || '')}</textarea>` : h`<input class="text" data-extra="${esc(x.header)}" value="${esc(f.extra[x.header] || '')}">`}</div>`).join('')}
      ${show('phone') || show('email') ? h`<div class="field two">
        ${show('phone') ? h`<div><label for="phone">Phone <span class="hint">if they gave it</span></label><input class="text" id="phone" type="tel" value="${esc(f.phone)}"></div>` : ''}
        ${show('email') ? h`<div><label for="email">Email</label><input class="text" id="email" type="email" value="${esc(f.email)}"></div>` : ''}
      </div>` : ''}
      ${show('okPhone') || show('okEmail') ? h`<div class="field"><span class="lbl">Did they say we can contact them? <span class="hint">leave unchecked if you didn't ask</span></span>
        ${show('okPhone') ? h`<label class="toggle"><input type="checkbox" id="okPhone" ${f.okPhone ? 'checked' : ''}> OK to call or text</label>` : ''}
        ${show('okEmail') ? h`<label class="toggle"><input type="checkbox" id="okEmail" ${f.okEmail ? 'checked' : ''}> OK to email</label>` : ''}</div>` : ''}
      ${show('followUp') || show('followUpDate') ? h`<div class="field two">
        ${show('followUp') ? h`<div><label for="followUp">Follow-up needed</label><input class="text" id="followUp" value="${esc(f.followUp)}" placeholder="e.g. bring a flyer"></div>` : ''}
        ${show('followUpDate') ? h`<div><label for="followUpDate">By when</label><input class="text" id="followUpDate" type="date" value="${esc(f.followUpDate)}"></div>` : ''}
      </div>` : ''}
      ${S.error ? h`<p class="err">${esc(S.error)}</p>` : ''}`;
  }

  function renderEdit(t) {
    const can = (f) => S.editable.includes(f) && S.features[f];
    const e = S.edit || (S.edit = {
      name: t.name || '', phone: t.phone || '', email: t.email || '', okPhone: !!t.okPhone, okEmail: !!t.okEmail, status: t.status || '', groupChat: !!t.groupChat,
      socialLead: !!t.socialLead, grievanceTypes: (t.grievanceTypes || []).slice(), accessibility: t.accessibility || '',
      notes: t.notes || '', connected: t.connected || '', housing: t.housing || '', residents: t.residents || '', grievances: t.grievances || '',
    });
    return h`
      <div class="field two">
        ${can('name') ? h`<div><label for="e_name">Name</label><input class="text" id="e_name" value="${esc(e.name)}"></div>` : ''}
        ${can('phone') ? h`<div><label for="e_phone">Phone</label><input class="text" id="e_phone" type="tel" value="${esc(e.phone)}"></div>` : ''}
      </div>
      ${can('email') ? h`<div class="field"><label for="e_email">Email</label><input class="text" id="e_email" type="email" value="${esc(e.email)}"></div>` : ''}
      ${can('okPhone') || can('okEmail') ? h`<div class="field"><span class="lbl">Contact permission</span>
        ${can('okPhone') ? h`<label class="toggle"><input type="checkbox" id="e_okPhone" ${e.okPhone ? 'checked' : ''}> OK to call or text</label>` : ''}
        ${can('okEmail') ? h`<label class="toggle"><input type="checkbox" id="e_okEmail" ${e.okEmail ? 'checked' : ''}> OK to email</label>` : ''}</div>` : ''}
      ${can('status') ? h`<div class="field"><span class="lbl">Status</span><div class="choices" data-echoice="status">
        ${(S.lists.statuses || []).map((v) => h`<button type="button" data-val="${esc(v)}" aria-pressed="${e.status === v}">${esc(v)}</button>`).join('')}</div></div>` : ''}
      ${can('housing') ? h`<div class="field"><span class="lbl">Housing assistance</span><div class="choices" data-echoice="housing">
        ${(S.lists.stay || ['Yes', 'No', 'Unsure']).map((v) => h`<button type="button" data-val="${esc(v)}" aria-pressed="${e.housing === v}">${esc(v)}</button>`).join('')}</div></div>` : ''}
      ${can('grievanceTypes') ? h`<div class="field"><span class="lbl">Grievance types</span><div class="choices tags" data-etags="grievanceTypes">
        ${(S.lists.grievanceTypes || []).map((v) => h`<button type="button" data-val="${esc(v)}" aria-pressed="${e.grievanceTypes.includes(v)}">${esc(v)}</button>`).join('')}</div></div>` : ''}
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
    on('#newUnit', 'click', () => { S.view = 'new'; S.form = blankForm(null); S.error = ''; render(); window.scrollTo(0, 0); });
    $app.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openTenant(b.dataset.open)));
    on('#back', 'click', () => { S.view = 'list'; S.tenant = null; S.edit = null; S.editing = false; S.error = ''; render(); });
    on('#showAll', 'click', () => { S.showAll = true; render(); });
    on('#editDetails', 'toggle', (e) => { S.editing = e.target.open; });

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
    $app.querySelectorAll('[data-etags]').forEach((group) => {
      group.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
        const arr = S.edit[group.dataset.etags];
        const i = arr.indexOf(b.dataset.val);
        if (i === -1) arr.push(b.dataset.val); else arr.splice(i, 1);
        b.setAttribute('aria-pressed', i === -1);
      }));
    });
    ['who', 'discussed', 'followUp', 'followUpDate', 'phone', 'email'].forEach((id) => on('#' + id, 'input', (e) => { S.form[id] = e.target.value; }));
    $app.querySelectorAll('[data-combo]').forEach((input) => {
      const field = input.dataset.combo;
      const list = input.nextElementSibling;
      const showList = () => {
        const q = input.value.trim().toLowerCase();
        const opts = comboOptions(field).filter((o) => !q || o.toLowerCase().includes(q)).slice(0, 8);
        list.innerHTML = opts.map((o) => h`<li role="option" data-val="${esc(o)}">${esc(o)}</li>`).join('');
        list.hidden = !opts.length;
      };
      input.addEventListener('focus', showList);
      input.addEventListener('input', () => { S.form[field] = input.value; showList(); });
      input.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 150));
      list.addEventListener('mousedown', (e) => {
        const li = e.target.closest('li'); if (!li) return;
        e.preventDefault(); input.value = li.dataset.val; S.form[field] = li.dataset.val; list.hidden = true;
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
    $app.querySelectorAll('[data-extra]').forEach((el) => el.addEventListener('input', (e) => { S.form.extra[el.dataset.extra] = e.target.value; }));
    on('#okPhone', 'change', (e) => { S.form.okPhone = e.target.checked; });
    on('#okEmail', 'change', (e) => { S.form.okEmail = e.target.checked; });
    on('#e_okPhone', 'change', (e) => { S.edit.okPhone = e.target.checked; });
    on('#e_okEmail', 'change', (e) => { S.edit.okEmail = e.target.checked; });
    on('#e_groupChat', 'change', (e) => { S.edit.groupChat = e.target.checked; });
    on('#e_socialLead', 'change', (e) => { S.edit.socialLead = e.target.checked; });

    on('#save', 'click', save);
    on('#saveEdit', 'click', saveEdit);
    $app.querySelectorAll('[data-done]').forEach((b) => b.addEventListener('click', async () => {
      try { await api(`/api/followup/${b.dataset.done}/done`, {}); toast('Follow-up marked done'); await openTenant(S.tenant.key, true); }
      catch (e) { toast(e.message); }
    }));
  }

  async function openTenant(key, keepForm) {
    try {
      const t = await api('/api/tenant/' + encodeURIComponent(key));
      S.tenant = t; S.view = 'tenant'; S.showAll = false; S.error = '';
      if (!keepForm) { S.form = blankForm(t); S.edit = null; S.editing = false; }
      render(); window.scrollTo(0, 0);
    } catch (e) { toast(e.message); }
  }

  async function save() {
    const f = S.form;
    S.error = '';
    if (S.view === 'new' && !f.unit.trim()) S.error = 'Enter the apartment number.';
    else if (!f.type) S.error = 'Pick how you reached them.';
    else if (!f.response) S.error = 'Pick what happened.';
    if (S.error) { render(); $app.querySelector('.err').scrollIntoView({ block: 'center' }); return; }
    S.saving = true; render();
    try {
      const r = await api('/api/interaction', f);
      sticky.set({ type: f.type, building: f.building });
      S.saving = false; render();
      toast(r.created ? 'Saved. New unit added.' : 'Saved');
      await refreshList();
      await openTenant(r.key);
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
    S.features = b.features || {}; S.interactionFields = b.interactionFields || {};
    S.formFields = b.formFields || []; S.extraFields = b.extraFields || []; S.editable = b.editable || [];
    document.title = `${S.appName} canvass`;
  }

  (async () => {
    try { await refreshList(); render(); }
    catch (e) { $app.innerHTML = `<p class="empty">${esc(e.message)}</p>`; }
  })();
})();
