// Builds an in-memory sheet from the config, so the mock always matches whatever
// headers the config names. Every person, number and note here is invented.

const { loadConfig } = require('../lib/schema');

module.exports = function seed(config) {
  const cfg = config || loadConfig();
  const C = cfg.columns;

  const headerRow = (tab) => Object.values(C[tab]);
  const idx = (tab) => Object.fromEntries(Object.keys(C[tab]).map((k, i) => [k, i]));
  const TI = idx('tenants'), II = idx('interactions'), LI = idx('lists');

  // Lists tab from the config defaults, plus sample canvassers and buildings.
  const lists = { ...cfg.defaultLists, canvassers: ['Ana L', 'Ben K', 'Cal M', 'Dee P'], canvasserEmails: ['ana@example.org', 'ben@example.org', '', ''], buildings: ['8633', '8645', '8651', '8653', '8659', '8663', '8667', '8669', '8671', '8673'] };
  const n = Math.max(...Object.values(lists).map((a) => a.length));
  const Lists = [headerRow('lists')];
  for (let i = 0; i < n; i++) {
    const r = new Array(headerRow('lists').length).fill('');
    for (const [field, j] of Object.entries(LI)) r[j] = (lists[field] || [])[i] || '';
    Lists.push(r);
  }

  const checks = (tab) => (cfg.checkboxFields[tab] || []);
  const tenantRow = (o) => {
    const r = new Array(headerRow('tenants').length).fill('');
    checks('tenants').forEach((f) => { r[TI[f]] = 'FALSE'; });
    for (const [k, v] of Object.entries(o)) if (TI[k] !== undefined) r[TI[k]] = typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : v;
    r[TI.key] = o.building ? `${o.building}-${o.unit}` : o.unit;
    return r;
  };
  const Tenants = [headerRow('tenants'),
    tenantRow({ building: '8659', unit: '4', name: 'Dale Finch', status: 'Contacted', grievanceTypes: 'Plumbing, Appliances, Fees, Rent', grievances: 'Garbage disposal broken, late fee after the payment system changed.', organizer: 'Ana L', lastContact: '2026-11-07', lastResponse: 'Talked', contacts: '1', contactStatus: 'Contacted 4 days ago' }),
    tenantRow({ building: '8659', unit: 'TBD-Rae', name: 'Rae', status: 'Contacted', grievanceTypes: 'Trash, Grounds, Rent', grievances: 'Trash piling up, rent went up, yard not kept.', organizer: 'Ana L', lastContact: '2026-11-07', lastResponse: 'Talked', contacts: '1', contactStatus: 'Contacted 4 days ago' }),
    tenantRow({ building: '8663', unit: '13', name: 'Opal Brandt', phone: '(918) 555-0105', accessibility: "doesn't drive", housing: 'Yes', groupChat: true, status: 'Supportive', grievanceTypes: 'Pests, Hot water, Unit repairs, Maintenance responsiveness', grievances: 'Roaches in the building; water heater out for weeks.', organizer: 'Ana L', notes: 'Tenure: many years\nMeetings: Yes', lastContact: '2026-08-01', lastResponse: 'Talked', contacts: '1', contactStatus: 'Overdue' }),
    tenantRow({ building: '8669', unit: '13', name: 'Marla Quist', phone: '(918) 555-0118', accessibility: 'ground floor', housing: 'No', groupChat: true, socialLead: true, status: 'Supportive', grievanceTypes: 'Trash, Pests, Grounds, Safety hazards, Maintenance responsiveness', grievances: 'No dumpsters, smoke alarm missing, pest control no-shows, loose stairs.', organizer: 'Ana L', notes: 'Text/voicemail: Voicemail only', lastContact: '2026-08-04', lastResponse: 'Talked', contacts: '1', contactStatus: 'Overdue' }),
    tenantRow({ building: '8653', unit: '9', name: 'Nita Oyelaran', phone: '(918) 555-0125', housing: 'Yes', status: 'Supportive', grievanceTypes: 'Mold, Hot water, Plumbing, Unit repairs', grievances: 'Water heater leak patched, mold under the carpet.', organizer: 'Ana L', lastContact: '2026-08-12', lastResponse: 'Talked', contacts: '1', contactStatus: 'Overdue' }),
    tenantRow({ building: '8633', unit: '13', name: 'Ken & Bea Tolliver', phone: '(918) 555-0112', status: 'Moved out', grievanceTypes: 'Heating', grievances: 'Weatherization', organizer: 'Ana L', lastContact: '2026-08-01', lastResponse: 'No answer', contacts: '1', contactStatus: 'Dead end' }),
    tenantRow({ building: '', unit: 'TBD-Marsh', name: 'Clyde Marsh', phone: '(918) 555-0101', status: 'No answer', grievanceTypes: 'Unit repairs', grievances: 'Carpet not cleaned', organizer: 'Ana L', lastContact: '2026-08-01', lastResponse: 'No answer', contacts: '1', contactStatus: 'Overdue' }),
    tenantRow({ building: '8671', unit: '12', name: 'Paulette Kerr', phone: '(918) 555-0111', groupChat: true, status: 'Supportive', grievanceTypes: 'Pests, Plumbing, Appliances, Grounds, Exterior lighting', grievances: 'Patio door, sprinklers, roaches, fridge leaking.', organizer: 'Ana L', lastContact: '2026-08-01', lastResponse: 'Talked', contacts: '1', contactStatus: 'Overdue' }),
  ];

  const interRow = (o) => {
    const r = new Array(headerRow('interactions').length).fill('');
    checks('interactions').forEach((f) => { r[II[f]] = 'FALSE'; });
    for (const [k, v] of Object.entries(o)) if (II[k] !== undefined) r[II[k]] = typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : v;
    r[II.key] = o.building ? `${o.building}-${o.unit}` : o.unit;
    return r;
  };
  const Interactions = [headerRow('interactions'),
    interRow({ date: '2026-11-07', unit: 'TBD-Rae', building: '8659', who: 'Rae', canvasser: 'Ben K', type: 'Door knock', response: 'Talked', discussed: 'Trash piling up, rent went up, nobody answers at the office.', followUp: 'Yes', followUpDate: '2026-11-12' }),
    interRow({ date: '2026-11-07', unit: '4', building: '8659', who: 'Dale Finch', canvasser: 'Ben K', type: 'Door knock', response: 'Talked', discussed: 'Disposal broken, late fee after the payment system changed.', followUp: 'Yes', followUpDate: '2026-11-13' }),
    interRow({ date: '2026-08-01', unit: '13', building: '8663', who: 'Opal Brandt', canvasser: 'Ana L', type: 'Phone call', response: 'Talked', discussed: 'Roaches everywhere. Water heater out for weeks. Does not want to move.' }),
    interRow({ date: '2026-08-04', unit: '13', building: '8669', who: 'Marla Quist', canvasser: 'Ana L', type: 'Phone call', response: 'Talked', discussed: 'Will refer neighbors. Fears retaliation if she complains.' }),
    interRow({ date: '2026-08-12', unit: '9', building: '8653', who: 'Nita Oyelaran', canvasser: 'Ana L', type: 'Phone call', response: 'Talked', discussed: 'Inspected last week.' }),
    interRow({ date: '2026-08-01', unit: '13', building: '8633', who: 'Ken & Bea Tolliver', canvasser: 'Ana L', type: 'Phone call', response: 'No answer' }),
    interRow({ date: '2026-08-01', unit: 'TBD-Marsh', building: '', who: 'Clyde Marsh', canvasser: 'Ana L', type: 'Phone call', response: 'No answer' }),
    interRow({ date: '2026-08-01', unit: '12', building: '8671', who: 'Paulette Kerr', canvasser: 'Ana L', type: 'Phone call', response: 'Talked', discussed: 'City inspector called her back. Wants community.' }),
  ];

  // Mimic a real sheet: checkbox columns hold FALSE on every row down to 1000.
  for (let r = Tenants.length; r < 1000; r++) Tenants.push(tenantRow({ unit: '' }).map((v, i) => (i === TI.key ? '' : v)));
  for (let r = Interactions.length; r < 1000; r++) Interactions.push(interRow({ unit: '' }).map((v, i) => (i === II.key ? '' : v)));

  const PI = Object.fromEntries(Object.keys(cfg.columns.people).map((k, i) => [k, i]));
  const personRow = (o) => { const r = new Array(Object.keys(PI).length).fill(''); for (const [k, i] of Object.entries(PI)) r[i] = o[k] !== undefined ? o[k] : (cfg.checkboxFields.people.includes(k) ? 'FALSE' : ''); return r; };
  const Residents = [Object.keys(PI).map((k) => cfg.columns.people[k]), personRow({ building: '8663', unit: '13', name: 'Theo Brandt', phone: '(918) 555-0142', okPhone: 'TRUE', added: '2026-11-07 18:02:00' })];
  return { [cfg.tabs.lists]: Lists, [cfg.tabs.tenants]: Tenants, [cfg.tabs.interactions]: Interactions, [cfg.tabs.people]: Residents };
};
