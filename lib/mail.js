// Optional outbound email. Configured entirely by environment variables; when they
// are absent, mailer() returns null and the admin pages fall back to mailto links.
//
//   SMTP_HOST   e.g. smtp.gmail.com
//   SMTP_PORT   465 (TLS) or 587 (STARTTLS); default 465
//   SMTP_USER   the sending account, e.g. an organizer's Gmail address
//   SMTP_PASS   its password or app password
//   MAIL_FROM   optional "Name <address>"; defaults to SMTP_USER

const nodemailer = require('nodemailer');

function mailer(env = process.env) {
  if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASS) return null;
  const port = parseInt(env.SMTP_PORT || '465', 10);
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST, port, secure: port === 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
  });
  const from = env.MAIL_FROM || env.SMTP_USER;
  return {
    from,
    async send({ to, subject, text }) {
      const info = await transport.sendMail({ from, to, subject, text });
      return info.messageId;
    },
    async verify() { await transport.verify(); },
  };
}

module.exports = { mailer };
