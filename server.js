// Ajay Haircut — booking server (zero dependencies, Node built-ins only)
// Run: node server.js   (PORT env optional, default 3000)
// Admin password: set ADMIN_PASSWORD env, or change DEFAULT_ADMIN_PASSWORD below.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'ajay-admin-2026';
const DATA_FILE = path.join(__dirname, 'data', 'bookings.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

const SERVICES = [
  "Men's Haircut", 'Skin Fade', 'Beard Trim', 'Haircut & Beard',
  'Styling / Wash', 'Hair Perm', 'Beard Perm', "Men's Facial",
];

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
    return sendJson(res, 200, { date, slots: allSlots(), taken });
  }

  if (url.pathname === '/api/bookings' && req.method === 'POST') {
    const b = await readBody(req);
    const { name, phone, service, date, time } = b;
    if (!name || !service || !date || !time) return sendJson(res, 400, { error: 'Name, service, date and time are required.' });
    if (!SERVICES.includes(service)) return sendJson(res, 400, { error: 'Unknown service.' });
    if (!allSlots().includes(time)) return sendJson(res, 400, { error: 'That time is not bookable.' });
    const d = new Date(date + 'T12:00:00');
    if (d.getDay() === 2) return sendJson(res, 400, { error: 'We are closed on Tuesdays.' });
    const bookings = loadBookings();
    if (bookings.some(x => x.date === date && x.time === time && x.status !== 'cancelled'))
      return sendJson(res, 409, { error: 'That slot was just taken. Please pick another time.' });
    const booking = {
      id: crypto.randomUUID(), name: String(name).slice(0, 80),
      phone: String(phone || '').slice(0, 30), service, date, time,
      smsConsent: !!b.smsConsent, status: 'booked', createdAt: new Date().toISOString(),
    };
    bookings.push(booking);
    saveBookings(bookings);
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
    return sendJson(res, 200, { bookings: loadBookings().sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)) });
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
