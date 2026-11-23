// Ajay Haircut — booking server (zero dependencies, Node built-ins only)
// Run: node server.js   (PORT env optional, default 3000)
// Admin password: set ADMIN_PASSWORD env, or change DEFAULT_ADMIN_PASSWORD below.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'ajay-admin-2026';

// Booking emails (like the old site): confirmation to the customer + a copy to the owner.
// Sent through Brevo's HTTPS API: Render's free plan blocks SMTP connections,
// so Gmail SMTP cannot be used from the site. Set BREVO_API_KEY in the environment
// to enable; the sender address must be a verified sender in Brevo.
// Without the key the site still takes bookings; emails are simply skipped.
const BREVO_API_KEY = process.env.BREVO_API_KEY || '';
const OWNER_EMAIL = process.env.OWNER_EMAIL || 'Popularsalon1@gmail.com';
async function sendEmail(to, subject, text, html) {
  if (!BREVO_API_KEY || !to) return;
  try {
    const payload = {
      sender: { name: 'Ajay Haircut', email: OWNER_EMAIL },
      to: [{ email: to }],
      subject, textContent: text,
    };
    if (html) payload.htmlContent = html;
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) console.error('Email failed:', res.status, (await res.text()).slice(0, 200));
  } catch (e) { console.error('Email failed:', e.message); }
}
function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
// Branded booking email in the old site's design: dark header card with a
// gold eyebrow line, then label/value rows.
function bookingEmailHtml(eyebrow, title, rows, footerLines) {
  const rowHtml = rows.map(r =>
    '<tr><td style="padding:13px 28px;border-bottom:1px solid #eceae4;color:#8a8f9c;font-size:15px;">' + esc(r[0]) + '</td>' +
    '<td style="padding:13px 28px;border-bottom:1px solid #eceae4;color:#141a29;font-size:15px;font-weight:700;text-align:right;">' + r[1] + '</td></tr>').join('');
  const foot = (footerLines || []).map(l =>
    '<div style="color:#8a8f9c;font-size:13.5px;line-height:1.5;text-align:center;">' + l + '</div>').join('');
  return '<div style="margin:0;padding:24px 12px;background:#f4f2ed;font-family:Arial,Helvetica,sans-serif;">' +
    '<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="width:100%;max-width:560px;background:#ffffff;border:1px solid #e6e2d9;">' +
    '<tr><td style="background:#0d1526;padding:34px 28px 30px;">' +
    '<div style="color:#c9a24b;font-size:13px;font-weight:700;letter-spacing:4px;">' + esc(eyebrow) + '</div>' +
    '<div style="color:#ffffff;font-size:30px;font-weight:800;line-height:1.25;margin-top:10px;">' + esc(title) + '</div>' +
    '</td></tr>' +
    '<tr><td style="padding:10px 0 16px;"><table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;">' + rowHtml + '</table></td></tr>' +
    (foot ? '<tr><td style="padding:0 28px 26px;">' + foot + '</td></tr>' : '') +
    '</table></div>';
}
// Notification rules: website (public) bookings notify the owner by email
// and text, and confirm to the customer. Dashboard bookings notify NOBODY
// except the customer — and only by text, only when a phone was filled in.
function sendBookingEmails(b, fromDashboard) {
  if (!BREVO_API_KEY) return;
  const when = b.date + ' at ' + b.time;
  if (b.email) {
    sendEmail(b.email,
      'Booking Confirmed: ' + b.service + ' \u2014 ' + b.date + ' ' + b.time,
      'Hi ' + b.name + ',\n\nYour booking at Ajay Haircut is confirmed.\n\nService: ' + b.service + '\nDate: ' + b.date + '\nTime: ' + b.time + '\n\nAjay Haircut \u00b7 Unit 102, 9385 120 St, Delta, BC \u00b7 (778) 344-2550\nOpen daily 9AM\u20139PM, closed Tuesdays.\n\nNeed to change or cancel? Just call us at (778) 344-2550.\n',
      bookingEmailHtml('BOOKING CONFIRMED', 'Your appointment is confirmed', [
        ['Service', esc(b.service)],
        ['Date', esc(b.date)],
        ['Time', esc(b.time)],
      ], ['Ajay Haircut \u00b7 Unit 102, 9385 120 St, Delta, BC', 'Need to change or cancel? Call (778) 344-2550']));
  }
  if (fromDashboard) return;
  sendEmail(OWNER_EMAIL,
    'New Booking: ' + b.service + ' \u2014 ' + b.date + ' ' + b.time,
    'New online booking:\n\nName: ' + b.name + '\nPhone: ' + (b.phone || '\u2014') + '\nEmail: ' + (b.email || '\u2014') + '\nService: ' + b.service + '\nDate: ' + b.date + '\nTime: ' + b.time + '\n',
    bookingEmailHtml('NEW APPOINTMENT', 'You have a new booking', [
      ['Service', esc(b.service)],
      ['Date', esc(b.date)],
      ['Time', esc(b.time)],
      ['Customer', esc(b.name)],
      ['Phone', '<span style="color:#c9a24b;">' + esc(b.phone || '\u2014') + '</span>'],
      ['Email', b.email ? '<a href="mailto:' + esc(b.email) + '" style="color:#2f6fd0;text-decoration:underline;">' + esc(b.email) + '</a>' : '\u2014'],
    ]));
}
// Booking texts via Twilio — the same account and number as the old site.
// Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER (the Twilio number, E.164) to enable.
// OWNER_PHONE is kept for reference only — the owner is not texted about
// bookings (email only for website bookings, nothing for dashboard ones).
// Without the Twilio variables the site still takes bookings; texts are simply skipped.
const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID || '';
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN || '';
const TWILIO_FROM = process.env.TWILIO_FROM_NUMBER || '';
const OWNER_PHONE = process.env.OWNER_PHONE || '+17783442550';
function normalizePhone(p) {
  const raw = String(p || '').trim();
  const d = raw.replace(/\D/g, '');
  if (!d) return '';
  if (d.length === 10) return '+1' + d;
  if (d.length === 11 && d.startsWith('1')) return '+' + d;
  if (raw.startsWith('+') && d.length >= 7) return '+' + d;
  return '';
}
async function sendSms(to, body) {
  if (!to) return false;
  try {
    const res = await fetch('https://api.twilio.com/2010-04-01/Accounts/' + TWILIO_SID + '/Messages.json', {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(TWILIO_SID + ':' + TWILIO_TOKEN).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ From: TWILIO_FROM, To: to, Body: body }),
    });
    if (!res.ok) { console.error('SMS failed:', res.status, (await res.text()).slice(0, 200)); return false; }
    return true;
  } catch (e) { console.error('SMS failed:', e.message); return false; }
}
function sendBookingTexts(b) {
  if (!TWILIO_SID || !TWILIO_TOKEN || !TWILIO_FROM || b.blockedSlot) return;
  const when = b.date + ' at ' + b.time;
  if (b.phone) {
    sendSms(normalizePhone(b.phone),
      'Hi ' + b.name + ', your booking at Ajay Haircut is confirmed: ' + b.service + ' on ' + when + '. Unit 102, 9385 120 St, Delta, BC. Need to change it? Call (778) 344-2550.');
  }
  // The owner is never texted about bookings — website bookings reach him
  // by email only, and dashboard bookings do not notify him at all.
}

// ---------- Appointment reminders ----------
// A reminder text goes out 2 hours before each appointment (shop timezone),
// in the exact format the owner asked for. Runs every 5 minutes while the
// service is awake; each booking is reminded at most once.
const SHOP_TZ = 'America/Vancouver';
// Vancouver offset from UTC, computed from the DST rules directly (second
// Sunday of March 2:00 AM -> first Sunday of November 2:00 AM = PDT, UTC-7;
// otherwise PST, UTC-8) so it never depends on the host's timezone database.
function vancouverOffsetMs(y, mo, da, mins) {
  const nthSunday = (yy, mm, n) => { const first = new Date(Date.UTC(yy, mm - 1, 1)).getUTCDay(); return 1 + ((7 - first) % 7) + (n - 1) * 7; };
  const startDay = nthSunday(y, 3, 2), endDay = nthSunday(y, 11, 1);
  let dst;
  if (mo < 3 || mo > 11) dst = false;
  else if (mo > 3 && mo < 11) dst = true;
  else if (mo === 3) dst = da > startDay || (da === startDay && mins >= 120);
  else dst = da < endDay || (da === endDay && mins < 120);
  return (dst ? 7 : 8) * 60 * 60 * 1000;
}
function shopInstant(dateStr, timeStr) {
  const [y, mo, da] = String(dateStr).split('-').map(Number);
  const mins = slotMinutes(timeStr);
  return Date.UTC(y, mo - 1, da, Math.floor(mins / 60), mins % 60) + vancouverOffsetMs(y, mo, da, mins);
}
let reminderCheckRunning = false;
async function checkReminders() {
  if (!TWILIO_SID || !TWILIO_TOKEN || !TWILIO_FROM || reminderCheckRunning) return;
  reminderCheckRunning = true;
  try {
    const now = Date.now();
    const bookings = loadBookings();
    let changed = false;
    for (const b of bookings) {
      if (b.status !== 'booked' || b.blockedSlot || !b.phone || b.reminderSentAt) continue;
      const diff = shopInstant(b.date, b.time) - now;
      if (diff > 0 && diff <= 2 * 60 * 60 * 1000) {
        const first = String(b.name || '').trim().split(/\s+/)[0] || 'there';
        console.log('Sending reminder for booking', b.id, b.date, b.time);
        const ok = await sendSms(normalizePhone(b.phone),
          'Ajay Haircut reminder: Hi ' + first + ', your appointment is today at ' + b.time + '. Unit 102, 9385 120 St, Delta, BC. Change/cancel: (778) 344-2550');
        if (ok) { b.reminderSentAt = new Date().toISOString(); changed = true; }
      }
    }
    if (changed) saveBookings(bookings);
  } catch (e) { console.error('Reminder check failed:', e.message); }
  reminderCheckRunning = false;
}

const PUBLIC_DIR = path.join(__dirname, 'public');

const SERVICES = [
  'Haircut & Beard', 'Skin Fade', 'Beard Trim and Threading', "Men's Haircut", 'Beard Trim',
  'Styling / Wash', 'Hair Perm', 'Beard Perm', "Men's Facial", 'Phone / Walk-in',
];

// Display durations in minutes (shown in the owner dashboard, like the old site).
const DURATIONS = {
  "Men's Haircut": 30, 'Skin Fade': 30, 'Beard Trim': 15, 'Beard Trim and Threading': 30, 'Haircut & Beard': 45,
  'Styling / Wash': 20, 'Hair Perm': 30, 'Beard Perm': 30, "Men's Facial": 45, 'Phone / Walk-in': 30,
};

// Bookable slots: 9:00 AM to 8:00 PM, every 15 minutes. Last slot = 8:00 PM.
function allSlots() {
  const slots = [];
  for (let mins = 9 * 60; mins <= 20 * 60; mins += 15) {
    const h24 = Math.floor(mins / 60), m = mins % 60;
    const ampm = h24 >= 12 ? 'PM' : 'AM';
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    slots.push(`${h12}:${String(m).padStart(2, '0')} ${ampm}`);
  }
  return slots;
}

// ---------- Storage ----------
// Permanent storage in Postgres when DATABASE_URL is set (Neon), with an
// in-memory cache so the request handlers stay synchronous. Falls back to
// local JSON files when DATABASE_URL is not set (local development), or if
// the database cannot be reached at startup.
const DATA_FILE = path.join(__dirname, 'data', 'bookings.json');
const BLOCKED_FILE = path.join(__dirname, 'data', 'blocked.json');
let pool = null;
if (process.env.DATABASE_URL) {
  try { pool = new (require('pg').Pool)({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }); }
  catch (e) { console.error('Postgres disabled:', e.message); pool = null; }
}
const cache = { bookings: null, blocked: null };
function readJsonFile(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return []; } }
function writeJsonFile(file, list) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(list, null, 2));
}
let persistChain = Promise.resolve();
function persist(key, list) {
  if (!pool) return;
  persistChain = persistChain.then(async () => {
    try {
      await pool.query('INSERT INTO store (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', [key, JSON.stringify(list)]);
    } catch (e) { console.error('Store persist failed:', e.message); }
  });
}
function loadBookings() { return cache.bookings || []; }
function saveBookings(list) {
  cache.bookings = list;
  if (pool) persist('bookings', list); else writeJsonFile(DATA_FILE, list);
}
function loadBlocked() { return cache.blocked || []; }
function saveBlocked(list) {
  cache.blocked = list;
  if (pool) persist('blocked', list); else writeJsonFile(BLOCKED_FILE, list);
}
async function initStore() {
  if (pool) {
    try {
      await pool.query('CREATE TABLE IF NOT EXISTS store (key TEXT PRIMARY KEY, value JSONB NOT NULL)');
      const rows = await pool.query("SELECT key, value FROM store WHERE key IN ('bookings', 'blocked')");
      const found = {};
      for (const r of rows.rows) found[r.key] = r.value;
      cache.bookings = Array.isArray(found.bookings) ? found.bookings : readJsonFile(DATA_FILE);
      cache.blocked = Array.isArray(found.blocked) ? found.blocked : readJsonFile(BLOCKED_FILE);
      if (found.bookings === undefined && cache.bookings.length) persist('bookings', cache.bookings);
      if (found.blocked === undefined && cache.blocked.length) persist('blocked', cache.blocked);
      console.log('Storage: Postgres connected,', cache.bookings.length, 'bookings loaded.');
      return;
    } catch (e) {
      console.error('Postgres init failed, falling back to files:', e.message);
      pool = null;
    }
  }
  cache.bookings = readJsonFile(DATA_FILE);
  cache.blocked = readJsonFile(BLOCKED_FILE);
}
function slotMinutes(t) {
  const m = String(t).match(/^(\d+):(\d+) (AM|PM)$/);
  if (!m) return 0;
  let h = parseInt(m[1], 10) % 12;
  if (m[3] === 'PM') h += 12;
  return h * 60 + parseInt(m[2], 10);
}

function slotLabel(mins) {
  const h24 = Math.floor(mins / 60), m = mins % 60;
  const ampm = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}
// The time a booking occupies: its service duration, so a 45-minute
// Haircut & Beard at 9:00 AM blocks 9:00, 9:15 and 9:30 and the next
// appointment can only start at 9:45. Blocked slots occupy only their
// own 15 minutes.
function bookingSpan(b) {
  const start = slotMinutes(b.time);
  const dur = b.blockedSlot ? (b.blockMinutes || 15) : totalDuration(b);
  return { start, end: start + dur };
}
// A booking can hold several services at once (e.g. Haircut & Beard plus a
// Facial): the appointment lasts the sum of their durations. Older bookings
// only have the single `service` string; newer ones also carry `services`.
function serviceListOf(b) {
  if (b && Array.isArray(b.services) && b.services.length) return b.services;
  return b && b.service ? [b.service] : [];
}
function totalDuration(b) {
  const list = serviceListOf(b);
  if (!list.length) return 30;
  return list.reduce((sum, s) => sum + (DURATIONS[s] || 30), 0);
}
// Validate a requested service selection (array, or a single string for
// older callers). Returns the cleaned list, or null if any entry is unknown.
function parseServiceList(raw) {
  const arr = Array.isArray(raw) ? raw : (raw ? [raw] : []);
  const list = [...new Set(arr.map(s => String(s)))];
  if (list.some(s => !SERVICES.includes(s))) return null;
  return list;
}
function spansOverlap(aStart, aEnd, b) {
  const s = bookingSpan(b);
  return aStart < s.end && s.start < aEnd;
}
function takenSlots(date) {
  const taken = new Set();
  for (const b of loadBookings()) {
    if (b.date !== date || b.status !== 'booked') continue;
    const { start, end } = bookingSpan(b);
    for (let m = start; m < end; m += 15) taken.add(slotLabel(m));
  }
  return [...taken];
}
function adminToken() {
  return crypto.createHmac('sha256', ADMIN_PASSWORD).update('ajayhaircut-admin-v1').digest('hex');
}
function isAuthed(req) {
  const t = (req.headers.authorization || '').replace('Bearer ', '');
  if (!t) return false;
  const a = Buffer.from(t), b = Buffer.from(adminToken());
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
  });
}

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  // ---------- API ----------
  if (url.pathname === '/api/availability' && req.method === 'GET') {
    const date = url.searchParams.get('date') || '';
    const taken = takenSlots(date);
    // Booked spans (start/end in minutes) let the booking form grey out any
    // start time whose service duration would run into the next appointment.
    const spans = loadBookings()
      .filter(b => b.date === date && b.status === 'booked')
      .map(b => { const s = bookingSpan(b); return { start: s.start, end: s.end }; });
    return sendJson(res, 200, { date, slots: allSlots(), taken, spans, blocked: loadBlocked().includes(date) });
  }

  if (url.pathname === '/api/bookings' && req.method === 'POST') {
    const b = await readBody(req);
    const { name, phone, date, time } = b;
    const email = String(b.email || '').trim().slice(0, 120);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return sendJson(res, 400, { error: 'That email address does not look right.' });
    let svcList = parseServiceList(b.services !== undefined ? b.services : b.service);
    if (svcList === null) return sendJson(res, 400, { error: 'Unknown service.' });
    if (b.blockTime && svcList.length === 0) svcList = ['Phone / Walk-in'];
    if ((!name && !b.blockTime) || svcList.length === 0 || !date || !time) return sendJson(res, 400, { error: 'Name, service, date and time are required.' });
    const service = svcList.join(' + ');
    const authed = isAuthed(req);
    if (!authed && !b.blockTime) {
      const digits = String(phone || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
      if (digits.length !== 10) return sendJson(res, 400, { error: 'A valid 10-digit phone number is required.' });
    }
    if (!allSlots().includes(time)) return sendJson(res, 400, { error: 'That time is not bookable.' });
    const d = new Date(date + 'T12:00:00');
    if (d.getDay() === 2) return sendJson(res, 400, { error: 'We are closed on Tuesdays.' });
    if (loadBlocked().includes(date)) return sendJson(res, 400, { error: 'We are closed on this day. Please pick another day.' });
    const bookings = loadBookings();
    let blockMinutes = null;
    if (b.blockTime) {
      const bm = parseInt(b.blockMinutes, 10);
      blockMinutes = (bm >= 15 && bm <= 720 && bm % 15 === 0) ? bm : 15;
    }
    const nStart = slotMinutes(time);
    const nEnd = nStart + (b.blockTime ? blockMinutes : totalDuration({ services: svcList }));
    if (bookings.some(x => x.date === date && x.status === 'booked' && spansOverlap(nStart, nEnd, x)))
      return sendJson(res, 409, { error: 'That time overlaps an existing booking. Please pick another time.' });
    const booking = {
      id: crypto.randomUUID(), name: b.blockTime ? 'Blocked' : String(name).slice(0, 80),
      phone: String(phone || '').slice(0, 30), email, service, services: svcList, date, time,
      notes: String(b.notes || '').slice(0, 300), blockedSlot: !!b.blockTime, blockMinutes,
      smsConsent: authed ? !!b.smsConsent : true, status: 'booked', createdAt: new Date().toISOString(),
    };
    bookings.push(booking);
    saveBookings(bookings);
    sendBookingEmails(booking, authed);
    sendBookingTexts(booking);
    return sendJson(res, 201, { ok: true, booking });
  }

  if (url.pathname === '/api/login' && req.method === 'POST') {
    const { password } = await readBody(req);
    if (password !== ADMIN_PASSWORD) return sendJson(res, 401, { error: 'Wrong password.' });
    return sendJson(res, 200, { token: adminToken() });
  }

  if (url.pathname === '/api/bookings' && req.method === 'GET') {
    if (!isAuthed(req)) return sendJson(res, 401, { error: 'Login required.' });
    const sorted = loadBookings().sort((a, b) => (a.date + String(slotMinutes(a.time)).padStart(4, '0')).localeCompare(b.date + String(slotMinutes(b.time)).padStart(4, '0')));
    return sendJson(res, 200, { bookings: sorted, durations: DURATIONS, services: SERVICES, slots: allSlots() });
  }

  if (url.pathname === '/api/blocked' && req.method === 'GET') {
    if (!isAuthed(req)) return sendJson(res, 401, { error: 'Login required.' });
    return sendJson(res, 200, { blocked: loadBlocked() });
  }
  if (url.pathname === '/api/blocked' && req.method === 'POST') {
    if (!isAuthed(req)) return sendJson(res, 401, { error: 'Login required.' });
    const { date } = await readBody(req);
    if (!date) return sendJson(res, 400, { error: 'Date is required.' });
    const blocked = loadBlocked();
    if (!blocked.includes(date)) { blocked.push(date); saveBlocked(blocked); }
    return sendJson(res, 200, { ok: true, blocked });
  }
  const unblockMatch = url.pathname.match(/^\/api\/blocked\/(.+)$/);
  if (unblockMatch && req.method === 'DELETE') {
    if (!isAuthed(req)) return sendJson(res, 401, { error: 'Login required.' });
    const blocked = loadBlocked().filter(d => d !== unblockMatch[1]);
    saveBlocked(blocked);
    return sendJson(res, 200, { ok: true, blocked });
  }

  const putMatch = url.pathname.match(/^\/api\/bookings\/(.+)$/);
  if (putMatch && req.method === 'PUT') {
    if (!isAuthed(req)) return sendJson(res, 401, { error: 'Login required.' });
    const b = await readBody(req);
    const bookings = loadBookings();
    const idx = bookings.findIndex(x => x.id === putMatch[1]);
    if (idx === -1) return sendJson(res, 404, { error: 'Booking not found.' });
    const cur = bookings[idx];
    const next = {
      blockedSlot: b.blockTime !== undefined ? !!b.blockTime : !!cur.blockedSlot,
      blockMinutes: cur.blockMinutes || null,
      name: b.name !== undefined ? String(b.name).slice(0, 80) : cur.name,
      phone: b.phone !== undefined ? String(b.phone).slice(0, 30) : cur.phone,
      email: b.email !== undefined ? String(b.email).trim().slice(0, 120) : (cur.email || ''),
      notes: b.notes !== undefined ? String(b.notes).slice(0, 300) : (cur.notes || ''),
      service: b.service !== undefined ? b.service : cur.service,
      services: Array.isArray(cur.services) ? cur.services : undefined,
      date: b.date !== undefined ? b.date : cur.date,
      time: b.time !== undefined ? b.time : cur.time,
    };
    if (b.services !== undefined || b.service !== undefined) {
      const list = parseServiceList(b.services !== undefined ? b.services : b.service);
      if (list === null) return sendJson(res, 400, { error: 'Unknown service.' });
      if (list.length) { next.services = list; next.service = list.join(' + '); }
    }
    if (!Array.isArray(next.services)) next.services = next.service ? [next.service] : [];
    if (next.blockedSlot) {
      next.name = 'Blocked';
      if (b.blockMinutes !== undefined) {
        const bm = parseInt(b.blockMinutes, 10);
        next.blockMinutes = (bm >= 15 && bm <= 720 && bm % 15 === 0) ? bm : (cur.blockMinutes || 15);
      } else if (!next.blockMinutes) next.blockMinutes = 15;
    } else next.blockMinutes = null;
    if ((!next.name && !next.blockedSlot) || !next.service || !next.date || !next.time) return sendJson(res, 400, { error: 'Name, service, date and time are required.' });
    if (!allSlots().includes(next.time)) return sendJson(res, 400, { error: 'That time is not bookable.' });
    const d = new Date(next.date + 'T12:00:00');
    if (d.getDay() === 2) return sendJson(res, 400, { error: 'We are closed on Tuesdays.' });
    if (loadBlocked().includes(next.date)) return sendJson(res, 400, { error: 'That day is blocked.' });
    // Overlap is only enforced when the booking actually moves or changes
    // service — older bookings may already overlap and must stay editable.
    if (next.date !== cur.date || next.time !== cur.time || next.service !== cur.service || next.blockedSlot !== !!cur.blockedSlot || (next.blockMinutes || null) !== (cur.blockMinutes || null)) {
      const nStart = slotMinutes(next.time);
      const nEnd = nStart + (next.blockedSlot ? (next.blockMinutes || 15) : totalDuration(next));
      if (bookings.some(x => x.id !== cur.id && x.date === next.date && x.status === 'booked' && spansOverlap(nStart, nEnd, x)))
        return sendJson(res, 409, { error: 'That slot is already taken.' });
    }
    Object.assign(cur, next);
    saveBookings(bookings);
    return sendJson(res, 200, { ok: true, booking: cur });
  }

  const statusMatch = url.pathname.match(/^\/api\/bookings\/(.+)\/status$/);
  if (statusMatch && req.method === 'POST') {
    if (!isAuthed(req)) return sendJson(res, 401, { error: 'Login required.' });
    const b = await readBody(req);
    if (!['booked', 'cancelled', 'completed'].includes(b.status)) return sendJson(res, 400, { error: 'Bad status.' });
    const bookings = loadBookings();
    const bk = bookings.find(x => x.id === statusMatch[1]);
    if (!bk) return sendJson(res, 404, { error: 'Booking not found.' });
    bk.status = b.status;
    saveBookings(bookings);
    return sendJson(res, 200, { ok: true, booking: bk });
  }

  const delMatch = url.pathname.match(/^\/api\/bookings\/(.+)$/);
  if (delMatch && req.method === 'DELETE') {
    if (!isAuthed(req)) return sendJson(res, 401, { error: 'Login required.' });
    const bookings = loadBookings();
    const idx = bookings.findIndex(b => b.id === delMatch[1]);
    if (idx === -1) return sendJson(res, 404, { error: 'Booking not found.' });
    bookings[idx].status = 'cancelled';
    saveBookings(bookings);
    return sendJson(res, 200, { ok: true });
  }

  // ---------- Static ----------
  let file = url.pathname === '/' ? '/index.html' : url.pathname;
  if (file === '/admin') file = '/admin.html';
  const filePath = path.join(PUBLIC_DIR, path.normalize(file).replace(/^(\.\.[\/\\])+/, ''));
  fs.readFile(filePath, (err, content) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    const ext = path.extname(filePath);
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
    // HTML pages must never be served from a stale phone/browser cache —
    // the booking form changes often and an old copy breaks bookings.
    if (ext === '.html') headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
    res.writeHead(200, headers);
    res.end(content);
  });
});

initStore().then(() => {
  server.listen(PORT, () => console.log(`Ajay Haircut site running on http://localhost:${PORT}`));
  checkReminders();
  setInterval(checkReminders, 5 * 60 * 1000);
});
