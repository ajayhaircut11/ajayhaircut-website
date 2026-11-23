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
// Set SMTP_USER (the shop Gmail) and SMTP_PASS (a Gmail App Password) in the environment to enable.
// Without them the site still takes bookings; emails are simply skipped.
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const OWNER_EMAIL = process.env.OWNER_EMAIL || 'Popularsalon1@gmail.com';
let mailer = null;
if (SMTP_USER && SMTP_PASS) {
  try {
    const nodemailer = require('nodemailer');
    mailer = nodemailer.createTransport({ service: 'gmail', auth: { user: SMTP_USER, pass: SMTP_PASS } });
  } catch (e) { console.error('Email disabled:', e.message); }
}
function sendBookingEmails(b) {
  if (!mailer) return;
  const when = b.date + ' at ' + b.time;
  if (b.email) {
    mailer.sendMail({
      from: '"Ajay Haircut" <' + SMTP_USER + '>',
      to: b.email,
      subject: 'Booking confirmed — ' + b.service + ' on ' + b.date,
      text: 'Hi ' + b.name + ',\n\nYour booking at Ajay Haircut is confirmed.\n\nService: ' + b.service + '\nDate: ' + b.date + '\nTime: ' + b.time + '\n\nAjay Haircut · Surrey, BC · (778) 344-2550\nOpen daily 9AM–9PM, closed Tuesdays. Walk-ins welcome.\n\nNeed to change or cancel? Just call us at (778) 344-2550.\n',
    }).catch(e => console.error('Customer email failed:', e.message));
  }
  mailer.sendMail({
    from: '"Ajay Haircut Website" <' + SMTP_USER + '>',
    to: OWNER_EMAIL,
    subject: 'New booking — ' + b.service + ' · ' + when,
    text: 'New online booking:\n\nName: ' + b.name + '\nPhone: ' + (b.phone || '—') + '\nEmail: ' + (b.email || '—') + '\nService: ' + b.service + '\nDate: ' + b.date + '\nTime: ' + b.time + '\nSMS consent: ' + (b.smsConsent ? 'Yes' : 'No') + '\n',
  }).catch(e => console.error('Owner email failed:', e.message));
}
// Booking texts via Twilio — the same account and number as the old site.
// Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER (the Twilio number, E.164) to enable.
// OWNER_PHONE (E.164) gets a text for each new booking; defaults to the shop number.
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
  if (!to) return;
  try {
    const res = await fetch('https://api.twilio.com/2010-04-01/Accounts/' + TWILIO_SID + '/Messages.json', {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(TWILIO_SID + ':' + TWILIO_TOKEN).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ From: TWILIO_FROM, To: to, Body: body }),
    });
    if (!res.ok) console.error('SMS failed:', res.status, (await res.text()).slice(0, 200));
  } catch (e) { console.error('SMS failed:', e.message); }
}
function sendBookingTexts(b) {
  if (!TWILIO_SID || !TWILIO_TOKEN || !TWILIO_FROM || b.blockedSlot) return;
  const when = b.date + ' at ' + b.time;
  if (b.phone && b.smsConsent) {
    sendSms(normalizePhone(b.phone),
      'Hi ' + b.name + ', your booking at Ajay Haircut is confirmed: ' + b.service + ' on ' + when + '. Need to change it? Call (778) 344-2550.');
  }
  if (OWNER_PHONE) {
    sendSms(OWNER_PHONE,
      'New booking: ' + b.name + ' - ' + b.service + ' on ' + when + (b.phone ? ' - ' + b.phone : ''));
  }
}

const DATA_FILE = path.join(__dirname, 'data', 'bookings.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

const SERVICES = [
  "Men's Haircut", 'Skin Fade', 'Beard Trim', 'Haircut & Beard',
  'Styling / Wash', 'Hair Perm', 'Beard Perm', "Men's Facial", 'Phone / Walk-in',
];

// Display durations in minutes (shown in the owner dashboard, like the old site).
const DURATIONS = {
  "Men's Haircut": 30, 'Skin Fade': 30, 'Beard Trim': 15, 'Haircut & Beard': 45,
  'Styling / Wash': 20, 'Hair Perm': 120, 'Beard Perm': 30, "Men's Facial": 45, 'Phone / Walk-in': 30,
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

function loadBookings() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { return []; }
}
function saveBookings(list) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(list, null, 2));
}

const BLOCKED_FILE = path.join(__dirname, 'data', 'blocked.json');
function loadBlocked() {
  try { return JSON.parse(fs.readFileSync(BLOCKED_FILE, 'utf8')); }
  catch { return []; }
}
function saveBlocked(list) {
  fs.mkdirSync(path.dirname(BLOCKED_FILE), { recursive: true });
  fs.writeFileSync(BLOCKED_FILE, JSON.stringify(list, null, 2));
}
function slotMinutes(t) {
  const m = String(t).match(/^(\d+):(\d+) (AM|PM)$/);
  if (!m) return 0;
  let h = parseInt(m[1], 10) % 12;
  if (m[3] === 'PM') h += 12;
  return h * 60 + parseInt(m[2], 10);
}

const tokens = new Set();
function isAuthed(req) {
  const t = (req.headers.authorization || '').replace('Bearer ', '');
  return tokens.has(t);
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
    const taken = loadBookings().filter(b => b.date === date && b.status !== 'cancelled').map(b => b.time);
    return sendJson(res, 200, { date, slots: allSlots(), taken, blocked: loadBlocked().includes(date) });
  }

  if (url.pathname === '/api/bookings' && req.method === 'POST') {
    const b = await readBody(req);
    const { name, phone, service, date, time } = b;
    const email = String(b.email || '').trim().slice(0, 120);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return sendJson(res, 400, { error: 'That email address does not look right.' });
    if ((!name && !b.blockTime) || !service || !date || !time) return sendJson(res, 400, { error: 'Name, service, date and time are required.' });
    if (!SERVICES.includes(service)) return sendJson(res, 400, { error: 'Unknown service.' });
    if (!allSlots().includes(time)) return sendJson(res, 400, { error: 'That time is not bookable.' });
    const d = new Date(date + 'T12:00:00');
    if (d.getDay() === 2) return sendJson(res, 400, { error: 'We are closed on Tuesdays.' });
    if (loadBlocked().includes(date)) return sendJson(res, 400, { error: 'We are closed on this day. Please pick another day.' });
    const bookings = loadBookings();
    if (bookings.some(x => x.date === date && x.time === time && x.status !== 'cancelled'))
      return sendJson(res, 409, { error: 'That slot was just taken. Please pick another time.' });
    const booking = {
      id: crypto.randomUUID(), name: b.blockTime ? 'Blocked' : String(name).slice(0, 80),
      phone: String(phone || '').slice(0, 30), email, service, date, time,
      notes: String(b.notes || '').slice(0, 300), blockedSlot: !!b.blockTime,
      smsConsent: !!b.smsConsent, status: 'booked', createdAt: new Date().toISOString(),
    };
    bookings.push(booking);
    saveBookings(bookings);
    sendBookingEmails(booking);
    sendBookingTexts(booking);
    return sendJson(res, 201, { ok: true, booking });
  }

  if (url.pathname === '/api/login' && req.method === 'POST') {
    const { password } = await readBody(req);
    if (password !== ADMIN_PASSWORD) return sendJson(res, 401, { error: 'Wrong password.' });
    const token = crypto.randomBytes(24).toString('hex');
    tokens.add(token);
    return sendJson(res, 200, { token });
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
      name: b.name !== undefined ? String(b.name).slice(0, 80) : cur.name,
      phone: b.phone !== undefined ? String(b.phone).slice(0, 30) : cur.phone,
      email: b.email !== undefined ? String(b.email).trim().slice(0, 120) : (cur.email || ''),
      notes: b.notes !== undefined ? String(b.notes).slice(0, 300) : (cur.notes || ''),
      service: b.service !== undefined ? b.service : cur.service,
      date: b.date !== undefined ? b.date : cur.date,
      time: b.time !== undefined ? b.time : cur.time,
    };
    if (next.blockedSlot) next.name = 'Blocked';
    if ((!next.name && !next.blockedSlot) || !next.service || !next.date || !next.time) return sendJson(res, 400, { error: 'Name, service, date and time are required.' });
    if (!SERVICES.includes(next.service)) return sendJson(res, 400, { error: 'Unknown service.' });
    if (!allSlots().includes(next.time)) return sendJson(res, 400, { error: 'That time is not bookable.' });
    const d = new Date(next.date + 'T12:00:00');
    if (d.getDay() === 2) return sendJson(res, 400, { error: 'We are closed on Tuesdays.' });
    if (loadBlocked().includes(next.date)) return sendJson(res, 400, { error: 'That day is blocked.' });
    if (bookings.some(x => x.id !== cur.id && x.date === next.date && x.time === next.time && x.status !== 'cancelled'))
      return sendJson(res, 409, { error: 'That slot is already taken.' });
    Object.assign(cur, next);
    saveBookings(bookings);
    return sendJson(res, 200, { ok: true, booking: cur });
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
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(content);
  });
});

server.listen(PORT, () => console.log(`Ajay Haircut site running on http://localhost:${PORT}`));
