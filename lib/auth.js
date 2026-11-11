// Canvasser access is a personal link: /c/<token>. The token is an HMAC of the
// canvasser's name under APP_SECRET, so nothing is stored. Visiting the link sets
// a signed cookie; every request re-checks the name against the Lists tab, so
// removing a name there revokes that person's access.

const crypto = require('crypto');

const COOKIE = 'canvasser';

function hmac(secret, text) {
  return crypto.createHmac('sha256', secret).update(text).digest('base64url');
}

function tokenFor(secret, name) {
  return hmac(secret, 'link:' + name.trim()).slice(0, 24);
}

function personalLink(baseUrl, secret, name) {
  return `${baseUrl.replace(/\/$/, '')}/c/${tokenFor(secret, name)}`;
}

function nameForToken(secret, token, canvassers) {
  return canvassers.find((n) => tokenFor(secret, n) === token) || null;
}

function cookieValue(secret, name) {
  const payload = Buffer.from(name, 'utf8').toString('base64url');
  return `${payload}.${hmac(secret, 'cookie:' + name)}`;
}

function nameFromCookie(secret, value) {
  if (!value || !value.includes('.')) return null;
  const [payload, sig] = value.split('.');
  let name;
  try { name = Buffer.from(payload, 'base64url').toString('utf8'); } catch { return null; }
  const expected = hmac(secret, 'cookie:' + name);
  if (expected.length !== sig.length) return null;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig)) ? name : null;
}

function adminOk(adminKey, provided) {
  if (!adminKey || !provided) return false;
  const a = Buffer.from(adminKey), b = Buffer.from(String(provided));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { COOKIE, tokenFor, personalLink, nameForToken, cookieValue, nameFromCookie, adminOk };
