// src/services/email.js
//
// Email sender using Resend's REST API.
// No npm package needed — Node 18+ has fetch built in.
// Docs: https://resend.com/docs/api-reference/emails/send-email

const RESEND_URL = 'https://api.resend.com/emails';

export function isEmailEnabled() {
  return !!process.env.RESEND_API_KEY;
}

export function getFromAddress() {
  return process.env.RESEND_FROM || 'onboarding@resend.dev';
}

async function send({ to, subject, html, text }) {
  if (!isEmailEnabled()) {
    console.log(`[email] (disabled) to=${to} subject="${subject}"`);
    return { ok: false, reason: 'RESEND_API_KEY not set' };
  }
  const from = getFromAddress();
  const res = await fetch(RESEND_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to, subject, html, text }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Resend ${res.status}: ${errText.slice(0, 200)}`);
  }
  return await res.json();
}

// ---- Email templates ----
// Inline CSS only (clients strip <style> blocks). Dark-mode safe colors.

export async function sendOtpEmail(to, code) {
  const subject = `KEMPY verification code: ${code}`;
  const html = `
<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;background:#0a0d10;color:#e6f1f5;padding:32px;border-radius:12px;border:1px solid #1a2329;">
  <div style="font-family:'Arial Black',Arial,sans-serif;letter-spacing:-1px;color:#00e5ff;font-size:24px;margin-bottom:8px;">KEMPY</div>
  <h2 style="font-size:18px;margin:16px 0 8px;color:#e6f1f5;">Verify your email</h2>
  <p style="color:#8a9ba3;font-size:14px;line-height:1.5;margin:0 0 20px;">Enter this code on the verification page to finish creating your account.</p>
  <div style="background:#131a1e;border:1px solid #1e3a44;border-radius:10px;padding:24px;text-align:center;margin:20px 0;">
    <div style="font-family:'Courier New',monospace;font-size:36px;font-weight:bold;color:#00e5ff;letter-spacing:10px;">${code}</div>
  </div>
  <p style="color:#8a9ba3;font-size:13px;line-height:1.5;margin:0 0 8px;">This code expires in 10 minutes.</p>
  <p style="color:#5a6970;font-size:12px;line-height:1.5;margin:0;">If you didn't request this, you can safely ignore this email — nobody else can use this code without access to your inbox.</p>
</div>`.trim();
  const text = `Your KEMPY verification code is: ${code}\n\nThis code expires in 10 minutes.\n\nIf you didn't request this, you can ignore this email.`;
  return send({ to, subject, html, text });
}

export async function sendWelcomeEmail(to, name) {
  const subject = `Welcome to KEMPY${name ? `, ${name}` : ''}`;
  const html = `
<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;background:#0a0d10;color:#e6f1f5;padding:32px;border-radius:12px;border:1px solid #1a2329;">
  <div style="font-family:'Arial Black',Arial,sans-serif;letter-spacing:-1px;color:#00e5ff;font-size:24px;margin-bottom:8px;">KEMPY</div>
  <h2 style="font-size:18px;margin:16px 0 8px;color:#e6f1f5;">You're in${name ? `, ${name}` : ''}.</h2>
  <p style="color:#8a9ba3;font-size:14px;line-height:1.6;">Your account is ready. Here's what to do first:</p>
  <ol style="color:#e6f1f5;font-size:14px;line-height:1.8;padding-left:18px;">
    <li>Run your first product search</li>
    <li>Save items to your watchlist</li>
    <li>Connect an eBay store to start selling</li>
  </ol>
  <p style="margin:24px 0 0;">
    <a href="http://localhost:3000/app/dashboard.html" style="display:inline-block;background:#00e5ff;color:#050708;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:8px;">Open dashboard →</a>
  </p>
</div>`.trim();
  return send({ to, subject, html, text: `Welcome to KEMPY. Open your dashboard: http://localhost:3000/app/dashboard.html` });
}
