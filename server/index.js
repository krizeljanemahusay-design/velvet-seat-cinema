// Express backend for Velvet Seat Cinema. Exposes a REST API (/api/...) and, after `npm run build`, serves the React app too.
import express from 'express'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import db from './db.js'

const PORT = process.env.PORT || 3001
const SECRET = process.env.JWT_SECRET || 'velvet-seat-dev-secret-change-me'
const here = path.dirname(fileURLToPath(import.meta.url))

const app = express()
app.use(express.json())

// ---------- helpers ----------
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const SEAT_RE = /^[A-H](10|[1-9])$/
const publicUser = (u) => ({ id: u.id, email: u.email, full_name: u.full_name, role: u.role })
const sign = (u) => jwt.sign({ id: u.id }, SECRET, { expiresIn: '8h' })
const fail = (res, status, error, code) => res.status(status).json({ error, code })
const toMovie = (m) => ({ ...m, genres: JSON.parse(m.genres) })
const isConstraint = (e) => String(e?.code || '').startsWith('SQLITE_CONSTRAINT')

function auth(req, res, next) {
  const h = req.headers.authorization || ''
  const token = h.startsWith('Bearer ') ? h.slice(7) : null
  if (!token) return fail(res, 401, 'Please log in.')
  try {
    const { id } = jwt.verify(token, SECRET)
    const user = db.prepare('select * from users where id = ?').get(id)
    if (!user) throw new Error('no user')
    req.user = user
    next()
  } catch {
    fail(res, 401, 'Session expired. Please log in again.')
  }
}
const adminOnly = (req, res, next) => (req.user.role === 'admin' ? next() : fail(res, 403, 'Admins only.'))

// ---------- validation (server side, so bad data never reaches the database) ----------
function checkMovie(b = {}) {
  const title = String(b.title ?? '').trim()
  const genres = Array.isArray(b.genres) ? b.genres.map((g) => String(g).trim()).filter(Boolean) : []
  const year = Number(b.year), rating = Number(b.rating), dur = Number(b.duration_min)
  const poster = String(b.poster_url ?? '').trim()
  if (!title || title.length > 100) return { error: 'Title is required (max 100 characters).' }
  if (!(year >= 1888 && year <= 2100)) return { error: 'Year must be between 1888 and 2100.' }
  if (b.rating === '' || b.rating == null || !(rating >= 0 && rating <= 10)) return { error: 'Rating must be 0 to 10.' }
  if (!genres.length) return { error: 'Add at least one genre.' }
  if (!(dur > 0 && dur <= 600)) return { error: 'Duration must be 1 to 600 minutes.' }
  if (!poster) return { error: 'Poster path is required.' }
  return { value: [title, year, rating, JSON.stringify(genres), dur, poster] }
}
function checkShowtime(b = {}) {
  const movieId = Number(b.movie_id), price = Number(b.price)
  const when = new Date(b.starts_at)
  const hall = String(b.hall ?? '').trim()
  if (!db.prepare('select 1 from movies where id = ?').get(movieId)) return { error: 'Movie not found.' }
  if (!b.starts_at || isNaN(when)) return { error: 'Pick a valid date and time.' }
  if (!hall) return { error: 'Hall is required.' }
  if (!(price > 0)) return { error: 'Price must be greater than 0.' }
  return { value: [movieId, when.toISOString(), hall, price] }
}

// ---------- auth ----------
app.post('/api/auth/register', (req, res) => {
  const name = String(req.body.name ?? '').trim()
  const email = String(req.body.email ?? '').trim().toLowerCase()
  const password = String(req.body.password ?? '')
  if (name.length < 2) return fail(res, 400, 'Enter your full name.')
  if (!EMAIL_RE.test(email)) return fail(res, 400, 'Enter a valid email address.')
  if (password.length < 8) return fail(res, 400, 'Password must be at least 8 characters.')
  if (db.prepare('select 1 from users where email = ?').get(email)) return fail(res, 409, 'That email is already registered.')
  const info = db.prepare('insert into users (email, full_name, password_hash) values (?,?,?)').run(email, name, bcrypt.hashSync(password, 10))
  const user = db.prepare('select * from users where id = ?').get(info.lastInsertRowid)
  res.status(201).json({ token: sign(user), profile: publicUser(user) })
})

app.post('/api/auth/login', (req, res) => {
  const email = String(req.body.email ?? '').trim().toLowerCase()
  const user = db.prepare('select * from users where email = ?').get(email)
  if (!user || !bcrypt.compareSync(String(req.body.password ?? ''), user.password_hash)) return fail(res, 401, 'Wrong email or password.')
  res.json({ token: sign(user), profile: publicUser(user) })
})

app.get('/api/auth/me', auth, (req, res) => res.json(publicUser(req.user)))

// ---------- movies (CRUD) ----------
app.get('/api/movies', auth, (req, res) => {
  res.json(db.prepare('select * from movies order by id').all().map(toMovie))
})
app.post('/api/movies', auth, adminOnly, (req, res) => {
  const { error, value } = checkMovie(req.body)
  if (error) return fail(res, 400, error)
  const info = db.prepare('insert into movies (title, year, rating, genres, duration_min, poster_url) values (?,?,?,?,?,?)').run(...value)
  res.status(201).json(toMovie(db.prepare('select * from movies where id = ?').get(info.lastInsertRowid)))
})
app.put('/api/movies/:id', auth, adminOnly, (req, res) => {
  const { error, value } = checkMovie(req.body)
  if (error) return fail(res, 400, error)
  const info = db.prepare('update movies set title=?, year=?, rating=?, genres=?, duration_min=?, poster_url=? where id=?').run(...value, req.params.id)
  if (!info.changes) return fail(res, 404, 'Movie not found.')
  res.json(toMovie(db.prepare('select * from movies where id = ?').get(req.params.id)))
})
app.delete('/api/movies/:id', auth, adminOnly, (req, res) => {
  const info = db.prepare('delete from movies where id = ?').run(req.params.id)   // showtimes and bookings are removed too (ON DELETE CASCADE)
  if (!info.changes) return fail(res, 404, 'Movie not found.')
  res.json({ ok: true })
})

// ---------- showtimes (CRUD) ----------
app.get('/api/showtimes', auth, (req, res) => {
  const where = [], args = []
  if (req.query.upcoming) { where.push('starts_at >= ?'); args.push(new Date().toISOString()) }
  if (req.query.movie_id) { where.push('movie_id = ?'); args.push(Number(req.query.movie_id)) }
  const sql = `select * from showtimes ${where.length ? 'where ' + where.join(' and ') : ''} order by starts_at`
  res.json(db.prepare(sql).all(...args))
})
app.post('/api/showtimes', auth, adminOnly, (req, res) => {
  const { error, value } = checkShowtime(req.body)
  if (error) return fail(res, 400, error)
  const info = db.prepare('insert into showtimes (movie_id, starts_at, hall, price) values (?,?,?,?)').run(...value)
  res.status(201).json(db.prepare('select * from showtimes where id = ?').get(info.lastInsertRowid))
})
app.put('/api/showtimes/:id', auth, adminOnly, (req, res) => {
  const { error, value } = checkShowtime(req.body)
  if (error) return fail(res, 400, error)
  const info = db.prepare('update showtimes set movie_id=?, starts_at=?, hall=?, price=? where id=?').run(...value, req.params.id)
  if (!info.changes) return fail(res, 404, 'Showtime not found.')
  res.json(db.prepare('select * from showtimes where id = ?').get(req.params.id))
})
app.delete('/api/showtimes/:id', auth, adminOnly, (req, res) => {
  const info = db.prepare('delete from showtimes where id = ?').run(req.params.id)
  if (!info.changes) return fail(res, 404, 'Showtime not found.')
  res.json({ ok: true })
})

// which seats are taken for a showtime (names are never exposed) + is this user on the waitlist
app.get('/api/showtimes/:id/seats', auth, (req, res) => {
  const seats = db.prepare('select seat from bookings where showtime_id = ?').all(req.params.id).map((r) => r.seat)
  const waitlisted = !!db.prepare('select 1 from waitlist where showtime_id = ? and user_id = ?').get(req.params.id, req.user.id)
  res.json({ seats, waitlisted })
})

// ---------- bookings ----------
const bookingSelect = `
  select b.*, s.starts_at, s.hall, m.title
  from bookings b join showtimes s on s.id = b.showtime_id join movies m on m.id = s.movie_id`
const shapeBooking = ({ starts_at, hall, title, ...b }) => ({ ...b, showtimes: { starts_at, hall, movies: { title } } })

app.get('/api/bookings', auth, (req, res) => {
  const all = req.query.all && req.user.role === 'admin'
  const rows = all
    ? db.prepare(`${bookingSelect} order by b.created_at, b.id`).all()
    : db.prepare(`${bookingSelect} where b.user_id = ? order by b.created_at, b.id`).all(req.user.id)
  res.json(rows.map(shapeBooking))
})

app.post('/api/bookings', auth, (req, res) => {
  const showtime = db.prepare('select * from showtimes where id = ?').get(Number(req.body.showtime_id))
  if (!showtime) return fail(res, 404, 'Showtime not found.')
  const name = String(req.body.name ?? '').trim()
  const seats = [...new Set(Array.isArray(req.body.seats) ? req.body.seats.map(String) : [])]
  if (name.length < 2) return fail(res, 400, 'Enter the name for the booking.')
  if (!seats.length || seats.length > 8) return fail(res, 400, 'Choose 1 to 8 seats.')
  if (!seats.every((s) => SEAT_RE.test(s))) return fail(res, 400, 'Invalid seat.')

  const ref = 'VS-' + Math.random().toString(36).slice(2, 8).toUpperCase()
  const insert = db.prepare('insert into bookings (showtime_id, user_id, seat, customer_name, customer_email, booking_ref) values (?,?,?,?,?,?)')
  // all-or-nothing: if one seat is already taken, none of them are booked
  const bookAll = db.transaction(() => { for (const seat of seats) insert.run(showtime.id, req.user.id, seat, name, req.user.email, ref) })
  try {
    bookAll()
  } catch (e) {
    if (isConstraint(e)) return fail(res, 409, 'One of those seats was just booked.', 'SEAT_TAKEN')
    throw e
  }
  res.status(201).json({ ref, seats, name, total: seats.length * showtime.price })
})

// cancel one seat (admin) or one seat you own
app.delete('/api/bookings/:id', auth, (req, res) => {
  const isAdmin = req.user.role === 'admin'
  const info = db.prepare('delete from bookings where id = ? and (user_id = ? or ?)').run(req.params.id, req.user.id, isAdmin ? 1 : 0)
  if (!info.changes) return fail(res, 404, 'Booking not found.')
  res.json({ ok: true })
})
// cancel a whole booking (every seat sharing a reference)
app.delete('/api/bookings/ref/:ref', auth, (req, res) => {
  const isAdmin = req.user.role === 'admin'
  const info = db.prepare('delete from bookings where booking_ref = ? and (user_id = ? or ?)').run(req.params.ref, req.user.id, isAdmin ? 1 : 0)
  if (!info.changes) return fail(res, 404, 'Booking not found.')
  res.json({ ok: true })
})

// ---------- waitlist ----------
app.get('/api/waitlist', auth, adminOnly, (req, res) => {
  const rows = db.prepare(`
    select w.*, s.starts_at, s.hall, m.title
    from waitlist w join showtimes s on s.id = w.showtime_id join movies m on m.id = s.movie_id
    order by w.created_at, w.id`).all()
  res.json(rows.map(shapeBooking))
})
app.post('/api/waitlist', auth, (req, res) => {
  const showtimeId = Number(req.body.showtime_id)
  if (!db.prepare('select 1 from showtimes where id = ?').get(showtimeId)) return fail(res, 404, 'Showtime not found.')
  try {
    db.prepare('insert into waitlist (showtime_id, user_id, email) values (?,?,?)').run(showtimeId, req.user.id, req.user.email)
  } catch (e) {
    if (isConstraint(e)) return fail(res, 409, 'You are already on the waitlist.')
    throw e
  }
  res.status(201).json({ ok: true })
})
app.delete('/api/waitlist/:id', auth, adminOnly, (req, res) => {
  db.prepare('delete from waitlist where id = ?').run(req.params.id)
  res.json({ ok: true })
})

// ---------- dashboard numbers (admin) ----------
app.get('/api/dashboard', auth, adminOnly, (req, res) => {
  const count = (sql, ...a) => db.prepare(sql).get(...a).n
  const now = new Date().toISOString()
  res.json({
    movies: count('select count(*) n from movies'),
    upcomingShowtimes: count('select count(*) n from showtimes where starts_at >= ?', now),
    seatsSold: count('select count(*) n from bookings'),
    customers: count("select count(*) n from users where role = 'user'"),
    waitlisted: count('select count(*) n from waitlist'),
    revenue: db.prepare('select coalesce(sum(s.price), 0) n from bookings b join showtimes s on s.id = b.showtime_id').get().n,
    topMovies: db.prepare(`
      select m.title, count(b.id) seats, coalesce(sum(case when b.id is not null then s.price end), 0) revenue
      from movies m
      left join showtimes s on s.movie_id = m.id
      left join bookings b on b.showtime_id = s.id
      group by m.id order by seats desc, m.title limit 5`).all(),
    recent: db.prepare(`${bookingSelect} order by b.created_at desc, b.id desc limit 5`).all().map(shapeBooking),
  })
})

// unknown /api routes -> JSON 404
app.use('/api', (req, res) => fail(res, 404, 'Not found.'))

// ---------- serve the built React app (after `npm run build`) ----------
const dist = path.join(here, '..', 'dist')
if (fs.existsSync(dist)) {
  app.use(express.static(dist))
  app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')))
}

// last-resort error handler
app.use((err, req, res, next) => {
  console.error(err)
  fail(res, 500, 'Something went wrong on the server.')
})

app.listen(PORT, () => console.log(`API running on http://localhost:${PORT}`))
