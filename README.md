# Ajay Haircut — new website (clone of ajayhaircut.com)

Same content as the current site (services, prices, hours, reviews), with the
fixes built in from day one:

- **Admin is behind a password login** (`/admin`) — no longer public.
- **Last bookable slot is 8:00 PM** (slots run 9:00 AM – 8:00 PM, every 15 min).
- **SMS consent checkbox** on the booking form ("I agree to receive appointment
  reminder texts…").
- **Cancel button works** (cancelling frees the slot again).
- Closed Tuesdays — the booking form and server both block Tuesdays.
- Booked slots can't be double-booked.

## Run locally

```
node server.js            # http://localhost:3000
```

Admin dashboard: http://localhost:3000/admin
Admin password: set the `ADMIN_PASSWORD` environment variable, or change
`DEFAULT_ADMIN_PASSWORD` in `server.js`. Current default: `ajay-admin-2026`
(change it before going live).

Bookings are stored in `data/bookings.json`.

## Going live (on Sukhpreet's own accounts)

1. Push this folder to a GitHub repo in **Sukhpreet's** GitHub account.
2. Import the repo on **Vercel** (frontend) / deploy the Node server on
   **Render** (set `ADMIN_PASSWORD` there). Every push to GitHub then
   auto-deploys — changes go live in 1–2 minutes with no middleman.
3. When the domain transfer from the developer is done, point
   **ajayhaircut.com** at the new deployment (DNS). Before switching, copy any
   future bookings out of the old admin so none are lost.
4. Optional next step: connect Twilio (Canadian number) so booking
   confirmations/reminders can be sent by text.
