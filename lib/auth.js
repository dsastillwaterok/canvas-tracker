// Access model: every way in expires.
//
//   Personal link   /c/<nameHash>.<expires>.<sig>   issued per canvassing event, days long
//   Sign-up link    /join/<issued>.<expires>.<sig>  lets someone add themselves, days long
//   Email login     /login/<nameHash>.<expires>.<sig> one-time, minutes long, sent by email
//
// A link sets a signed cookie whose expiry matches the link's. Nothing is stored on
// the server except a short in-memory list of used login links; every request also
// re-checks the name against the Lists tab, so removing a name revokes at once.
//
// `epoch` is the current canvass (the event's start time, from the saved settings).
// It is folded into every signature, so starting a new canvass invalidates all the
// personal links and sessions of the old one at once.

const crypto = require('crypto');

const COOKIE = 'canvasser';

function hmac(secret, text) {
  return crypto.createHmac('sha256', secret).update(text).digest('base64url');
}
function safeEq(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
const nameHash = (secret, name) => hmac(secret, 'name:' + name.trim()).slice(0, 12);

// ---- personal links -------------------------------------------------------------
function personalToken(secret, name, expires, epoch = 0) {
  const nh = nameHash(secret, name);
  return `${nh}.${expires}.${hmac(secret, `link:${nh}:${expires}:${epoch}`).slice(0, 24)}`;
}
function personalLink(baseUrl, secret, name, expires, epoch = 0) {
  return `${baseUrl.replace(/\/$/, '')}/c/${personalToken(secret, name, expires, epoch)}`;
}
// Returns { name, expires } or { reason }.
function resolvePersonalToken(secret, token, canvassers, now = Date.now(), epoch = 0) {
  const m = String(token || '').match(/^([A-Za-z0-9_-]{12})\.(\d+)\.([A-Za-z0-9_-]+)$/);
  if (!m) return { reason: 'That link is not valid.' };
  const [, nh, expStr, sig] = m;
  const expires = parseInt(expStr, 10);
  if (!safeEq(hmac(secret, `link:${nh}:${expires}:${epoch}`).slice(0, 24), sig)) return { reason: 'That link is from an earlier canvass and no longer works.' };
  if (now > expires) return { reason: 'That link has expired. Ask an organizer for a new one, or sign in with your email.' };
  const name = canvassers.find((n) => nameHash(secret, n) === nh);
  if (!name) return { reason: 'That link is no longer active.' };
  return { name, expires };
}

// ---- session cookie ---------------------------------------------------------------
function cookieValue(secret, name, expires, epoch = 0) {
  const payload = Buffer.from(name, 'utf8').toString('base64url');
  return `${payload}.${expires}.${hmac(secret, `cookie:${name}:${expires}:${epoch}`)}`;
}
function nameFromCookie(secret, value, now = Date.now(), epoch = 0) {
  const m = String(value || '').match(/^([A-Za-z0-9_-]+)\.(\d+)\.([A-Za-z0-9_-]+)$/);
  if (!m) return null;
  let name;
  try { name = Buffer.from(m[1], 'base64url').toString('utf8'); } catch { return null; }
  const expires = parseInt(m[2], 10);
  if (now > expires) return null;
  return safeEq(hmac(secret, `cookie:${name}:${expires}:${epoch}`), m[3]) ? name : null;
}

// ---- sign-up links -----------------------------------------------------------------
function joinToken(secret, issued, expires) {
  return `${issued}.${expires}.${hmac(secret, `join:${issued}:${expires}`).slice(0, 24)}`;
}
function parseJoinToken(secret, token, { now = Date.now(), notBefore = 0 } = {}) {
  const m = String(token || '').match(/^(\d+)\.(\d+)\.([A-Za-z0-9_-]+)$/);
  if (!m) return { ok: false, reason: 'That sign-up link is not valid.' };
  const issued = parseInt(m[1], 10), expires = parseInt(m[2], 10);
  if (!safeEq(hmac(secret, `join:${issued}:${expires}`).slice(0, 24), m[3])) return { ok: false, reason: 'That sign-up link is not valid.' };
  if (now > expires) return { ok: false, reason: 'That sign-up link has expired. Ask an organizer for a new one.' };
  if (issued < notBefore) return { ok: false, reason: 'That sign-up link was cancelled. Ask an organizer for a new one.' };
  return { ok: true, issued, expires };
}

// ---- one-time email login links ------------------------------------------------------
const usedLogins = new Map(); // token -> expiry, pruned as we go
function loginToken(secret, name, expires) {
  const nh = nameHash(secret, name);
  return `${nh}.${expires}.${hmac(secret, `login:${nh}:${expires}`).slice(0, 24)}`;
}
function resolveLoginToken(secret, token, canvassers, now = Date.now()) {
  for (const [t, e] of usedLogins) if (e < now) usedLogins.delete(t);
  const m = String(token || '').match(/^([A-Za-z0-9_-]{12})\.(\d+)\.([A-Za-z0-9_-]+)$/);
  if (!m) return { reason: 'That sign-in link is not valid.' };
  const [, nh, expStr, sig] = m;
  const expires = parseInt(expStr, 10);
  if (!safeEq(hmac(secret, `login:${nh}:${expires}`).slice(0, 24), sig)) return { reason: 'That sign-in link is not valid.' };
  if (now > expires) return { reason: 'That sign-in link has expired. Request a new one.' };
  if (usedLogins.has(token)) return { reason: 'That sign-in link was already used. Request a new one.' };
  const name = canvassers.find((n) => nameHash(secret, n) === nh);
  if (!name) return { reason: 'That sign-in link is no longer active.' };
  usedLogins.set(token, expires);
  return { name };
}

function adminOk(adminKey, provided) {
  if (!adminKey || !provided) return false;
  return safeEq(adminKey, provided);
}

module.exports = {
  COOKIE, personalToken, personalLink, resolvePersonalToken, cookieValue, nameFromCookie,
  joinToken, parseJoinToken, loginToken, resolveLoginToken, adminOk,
};
