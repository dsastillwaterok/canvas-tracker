// Phone and email checks shared by the phone (served as /static/contact.js) and the server.
// Phones: US numbers become (405) 555-0100; anything starting with + is kept as typed if it has
// 8 to 15 digits. Emails: one @, a dot in the domain, no spaces; a few common typos get a suggestion.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(); else root.Contact = factory();
}(this, function () {
  const DOMAIN_FIXES = { 'gmial.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gamil.com': 'gmail.com', 'gmail.co': 'gmail.com', 'gmail.con': 'gmail.com', 'yaho.com': 'yahoo.com', 'yahoo.con': 'yahoo.com', 'hotmal.com': 'hotmail.com', 'hotmail.con': 'hotmail.com', 'outlok.com': 'outlook.com', 'icloud.con': 'icloud.com' };

  // Returns { ok, value, error?, hint? }. value is the cleaned form to store.
  function phone(raw) {
    const s = String(raw || '').trim();
    if (!s) return { ok: true, value: '' };
    if (/[^\d\s()+.\-x]/i.test(s)) return { ok: false, value: s, error: 'A phone number can only have digits, spaces, dashes, parentheses, and an optional +.' };
    const ext = (s.match(/x\s*(\d{1,6})\s*$/i) || [])[1];
    const core = s.replace(/x\s*\d{1,6}\s*$/i, '');
    const digits = core.replace(/\D/g, '');
    if (core.trim().startsWith('+') && !core.trim().startsWith('+1')) {
      if (digits.length < 8 || digits.length > 15) return { ok: false, value: s, error: 'An international number needs 8 to 15 digits after the +.' };
      return { ok: true, value: '+' + digits + (ext ? ' x' + ext : '') };
    }
    const ten = digits.length === 11 && digits[0] === '1' ? digits.slice(1) : digits;
    if (ten.length !== 10) return { ok: false, value: s, error: ten.length < 10 ? `That's ${ten.length} digits; a US number has 10.` : `That's ${ten.length} digits; a US number has 10 (start with + for international).` };
    if (ten[0] === '0' || ten[0] === '1') return { ok: false, value: s, error: "A US area code can't start with 0 or 1." };
    if (/^(\d)\1{9}$/.test(ten) || ten === '1234567890') return { ok: false, value: s, error: "That doesn't look like a real number." };
    return { ok: true, value: `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}` + (ext ? ' x' + ext : '') };
  }

  function email(raw) {
    let s = String(raw || '').trim();
    if (!s) return { ok: true, value: '' };
    s = s.replace(/^mailto:/i, '').replace(/[,;]+$/, '');
    if (/\s/.test(s)) return { ok: false, value: s, error: "An email address can't contain spaces." };
    const at = s.lastIndexOf('@');
    if (at < 1 || s.indexOf('@') !== at) return { ok: false, value: s, error: 'An email address needs exactly one @.' };
    const local = s.slice(0, at), domain = s.slice(at + 1).toLowerCase();
    if (!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local) || local.startsWith('.') || local.endsWith('.') || local.includes('..')) return { ok: false, value: s, error: 'The part before the @ has a character that can\'t be in an email address.' };
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain) || /(^|\.)-|-(\.|$)/.test(domain)) return { ok: false, value: s, error: 'The part after the @ needs a domain like gmail.com.' };
    const tld = domain.slice(domain.lastIndexOf('.') + 1);
    if (tld.length < 2) return { ok: false, value: s, error: 'The part after the last dot is too short.' };
    const fixed = DOMAIN_FIXES[domain];
    return { ok: true, value: local + '@' + domain, hint: fixed ? `Did you mean ${local}@${fixed}?` : undefined, suggestion: fixed ? local + '@' + fixed : undefined };
  }

  return { phone, email };
}));
