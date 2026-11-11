// Seed data for the mock sheet (npm run dev / npm test). Shapes match the real
// tabs column for column. Every name, number and note here is invented.

module.exports = function seed() {
  const listsHeader = ['Status', 'Language', 'Interaction type', 'Response', 'Canvassers', 'Planning to stay', 'Grievance type', 'Personal form link', 'Building'];
  const statuses = ['Not contacted', 'No answer', 'Contacted', 'Supportive', 'Member', 'Declined', 'Moved out'];
  const languages = ['English', 'Spanish', 'Other'];
  const types = ['Door knock', 'Phone call', 'Text', 'WhatsApp', 'Meeting', 'Other'];
  const responses = ['No answer', 'Talked', 'Supportive', 'Wants to join', 'Not interested', 'Come back later'];
  const canvassers = ['Ana L', 'Ben K', 'Cal M', 'Dee P', 'Eli R', 'Fay S', 'Gus T'];
  const stay = ['Yes', 'No', 'Unsure'];
  const gtypes = ['Trash', 'Pests', 'Mold', 'Air quality', 'Air conditioning', 'Heating', 'Hot water', 'Plumbing', 'Appliances', 'Unit repairs', 'Grounds', 'Exterior lighting', 'Safety hazards', 'Locks / security', 'Accessibility', 'Fees', 'Rent', 'Eviction notices', 'Abatement / inspections', 'Maintenance responsiveness', 'Communication', 'Retaliation'];
  const buildings = ['8633', '8645', '8651', '8653', '8659', '8663', '8667', '8669', '8671', '8673'];
  const n = Math.max(statuses.length, types.length, canvassers.length, gtypes.length, buildings.length);
  const Lists = [listsHeader];
  for (let i = 0; i < n; i++) {
    Lists.push([statuses[i] || '', languages[i] || '', types[i] || '', responses[i] || '', canvassers[i] || '', stay[i] || '', gtypes[i] || '', '', buildings[i] || '']);
  }

  const tHeader = ['Building', 'Unit', 'Name', 'Phone', 'Email', 'Preferred language', 'Accessibility / visit notes', 'Residents in unit', 'Housing assistance', 'In group chat?', 'Group message OK?', 'Status', 'Social lead?', 'Connected to (units or names)', 'OC member?', 'Translator?', 'Planning to stay?', 'Lawyer contact given?', 'Grievance types', 'Grievances', 'Organizer', 'Notes', 'Last contact', 'Last response', 'Contacts logged', 'Contact status', 'Unit key'];
  const t = (b, u, name, phone, status, gt, griev, notes, last, resp, count, cs, extra = {}) => {
    const r = new Array(27).fill('');
    r[0] = b; r[1] = u; r[2] = name; r[3] = phone; r[5] = 'English'; r[6] = extra.acc || '';
    r[8] = extra.housing || ''; r[9] = extra.group ? 'TRUE' : 'FALSE'; r[10] = 'FALSE'; r[11] = status;
    r[12] = extra.lead ? 'TRUE' : 'FALSE'; r[14] = 'FALSE'; r[15] = 'FALSE'; r[17] = 'FALSE';
    r[18] = gt; r[19] = griev; r[20] = 'Ana L'; r[21] = notes; r[22] = last; r[23] = resp; r[24] = String(count);
    r[25] = cs; r[26] = b ? `${b}-${u}` : u;
    return r;
  };
  const Tenants = [tHeader,
    t('8659', '4', 'Dale Finch', '', 'Contacted', 'Plumbing, Appliances, Unit repairs, Fees, Rent, Maintenance responsiveness', 'Garbage disposal broken, late fee after the payment system changed.', '', '2026-11-07', 'Talked', 1, 'Contacted 4 days ago'),
    t('8659', 'TBD-Rae', 'Rae', '', 'Contacted', 'Trash, Grounds, Accessibility, Rent, Communication', 'Trash piling up, rent went up, yard not kept.', '', '2026-11-07', 'Talked', 1, 'Contacted 4 days ago'),
    t('8663', '13', 'Opal Brandt', '(918) 555-0105', 'Supportive', 'Pests, Hot water, Unit repairs, Maintenance responsiveness', 'Roaches in the building; water heater out for weeks.', 'Tenure: many years\nMeetings: Yes', '2026-08-01', 'Talked', 1, 'Overdue: 102 days', { acc: "doesn't drive", housing: 'Yes', group: true }),
    t('8669', '13', 'Marla Quist', '(918) 555-0118', 'Supportive', 'Trash, Pests, Grounds, Safety hazards, Maintenance responsiveness', 'No dumpsters, smoke alarm missing, pest control no-shows, loose stairs.', 'Text/voicemail: Voicemail only', '2026-08-04', 'Talked', 1, 'Overdue: 99 days', { acc: 'ground floor', housing: 'No', group: true, lead: true }),
    t('8653', '9', 'Nita Oyelaran', '(918) 555-0125', 'Supportive', 'Mold, Hot water, Plumbing, Unit repairs', 'Water heater leak patched, mold under the carpet.', '', '2026-08-12', 'Talked', 1, 'Overdue: 91 days', { housing: 'Yes' }),
    t('8633', '13', 'Ken & Bea Tolliver', '(918) 555-0112', 'Moved out', 'Heating', 'Weatherization', '', '2026-08-01', 'No answer', 1, 'Dead end'),
    t('', 'TBD-Marsh', 'Clyde Marsh', '(918) 555-0101', 'No answer', 'Unit repairs', 'Carpet not cleaned', '', '2026-08-01', 'No answer', 1, 'Overdue: 102 days'),
    t('8671', '12', 'Paulette Kerr', '(918) 555-0111', 'Supportive', 'Pests, Plumbing, Appliances, Unit repairs, Grounds, Exterior lighting', 'Patio door, sprinklers, roaches, fridge leaking.', '', '2026-08-01', 'Talked', 1, 'Overdue: 102 days', { group: true }),
  ];

  const iHeader = ['Date', 'Unit', 'Building', 'Who you talked to', 'Canvasser', 'Type', 'Response', 'What was discussed', 'Follow-up needed', 'Follow-up date', 'Follow-up done?', 'Unit key'];
  const i = (d, u, b, who, c, ty, resp, disc, fu, fud, done) => [d, u, b, who, c, ty, resp, disc, fu, fud, done ? 'TRUE' : 'FALSE', b ? `${b}-${u}` : u];
  const Interactions = [iHeader,
    i('2026-11-07', 'TBD-Rae', '8659', 'Rae', 'Ben K', 'Door knock', 'Talked', 'Trash piling up, rent went up, nobody answers at the office.', 'Yes', '2026-11-12', false),
    i('2026-11-07', '4', '8659', 'Dale Finch', 'Ben K', 'Door knock', 'Talked', 'Disposal broken, late fee after the payment system changed.', 'Yes', '2026-11-13', false),
    i('2026-08-01', '13', '8663', 'Opal Brandt', 'Ana L', 'Phone call', 'Talked', 'Roaches everywhere. Water heater out for weeks. Does not want to move.', '', '', false),
    i('2026-08-04', '13', '8669', 'Marla Quist', 'Ana L', 'Phone call', 'Talked', 'Will refer neighbors. Fears retaliation if she complains.', '', '', false),
    i('2026-08-12', '9', '8653', 'Nita Oyelaran', 'Ana L', 'Phone call', 'Talked', 'Inspected last week.', '', '', false),
    i('2026-08-01', '13', '8633', 'Ken & Bea Tolliver', 'Ana L', 'Phone call', 'No answer', '', '', '', false),
    i('2026-08-01', 'TBD-Marsh', '', 'Clyde Marsh', 'Ana L', 'Phone call', 'No answer', '', '', '', false),
    i('2026-08-01', '12', '8671', 'Paulette Kerr', 'Ana L', 'Phone call', 'Talked', 'City inspector called her back. Wants community.', '', '', false),
  ];
  // Mimic the real sheet: checkbox columns hold FALSE on every row down to 1000.
  for (let r = Tenants.length; r < 1000; r++) { const row = new Array(27).fill(''); [9, 10, 12, 14, 15, 17].forEach((c) => { row[c] = 'FALSE'; }); Tenants.push(row); }
  for (let r = Interactions.length; r < 1000; r++) { const row = new Array(12).fill(''); row[10] = 'FALSE'; Interactions.push(row); }

  return { Lists, Tenants, Interactions };
};
