// SQLite database: creates the tables and the sample data the first time the server runs.
import Database from 'better-sqlite3'
import bcrypt from 'bcryptjs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const db = new Database(path.join(here, 'cinema.db'))
db.pragma('foreign_keys = ON')

db.exec(`
create table if not exists users (
  id            integer primary key autoincrement,
  email         text not null unique,
  full_name     text not null default '',
  password_hash text not null,
  role          text not null default 'user' check (role in ('user','admin'))
);
create table if not exists movies (
  id           integer primary key autoincrement,
  title        text not null,
  year         integer,
  rating       real not null check (rating between 0 and 10),
  genres       text not null,                       -- stored as JSON text, e.g. ["Horror","Romance"]
  duration_min integer not null check (duration_min > 0),
  poster_url   text not null
);
create table if not exists showtimes (
  id         integer primary key autoincrement,
  movie_id   integer not null references movies(id) on delete cascade,
  starts_at  text not null,                         -- ISO date-time
  hall       text not null default 'Hall 1',
  price      real not null default 350 check (price > 0)
);
create table if not exists bookings (
  id             integer primary key autoincrement,
  showtime_id    integer not null references showtimes(id) on delete cascade,
  user_id        integer not null references users(id) on delete cascade,
  seat           text not null,
  customer_name  text not null,
  customer_email text not null,
  booking_ref    text not null,
  created_at     text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  unique (showtime_id, seat)                        -- this is what stops double booking
);
create table if not exists waitlist (               -- FIFO queue for sold-out shows
  id          integer primary key autoincrement,
  showtime_id integer not null references showtimes(id) on delete cascade,
  user_id     integer not null references users(id) on delete cascade,
  email       text not null,
  created_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  unique (showtime_id, user_id)
);
`)

// ---------- sample data ----------
const SEED_MOVIES = [
  ['Obsession', 2025, 7.8, ['Horror', 'Romance'], 109, '/posters/obsession.jpg'],
  ['Spider-Man: Brand New Day', 2026, 8.4, ['Action', 'Adventure'], 145, '/posters/spider-man.jpg'],
  ['Coyote vs Acme', 2026, 7.5, ['Animation', 'Adventure'], 103, '/posters/coyote-vs-acme.jpg'],
  ['The Maze Runner', 2014, 6.8, ['Sci-Fi', 'Thriller'], 113, '/posters/maze-runner.jpg'],
  ['Titanic', 1997, 8.0, ['Drama', 'Romance'], 194, '/posters/titanic.jpg'],
]

if (db.prepare('select count(*) n from movies').get().n === 0) {
  const ins = db.prepare('insert into movies (title, year, rating, genres, duration_min, poster_url) values (?,?,?,?,?,?)')
  for (const m of SEED_MOVIES) ins.run(m[0], m[1], m[2], JSON.stringify(m[3]), m[4], m[5])
}

// If there are no upcoming showtimes (first run, or the old ones have passed), create 5 days of shows.
const upcoming = db.prepare('select count(*) n from showtimes where starts_at >= ?').get(new Date().toISOString()).n
if (upcoming === 0) {
  const ins = db.prepare('insert into showtimes (movie_id, starts_at, hall, price) values (?,?,?,350)')
  const movies = db.prepare('select id from movies order by id').all()
  const slots = [[13, 0], [17, 0], [20, 30]]
  const now = new Date()
  movies.forEach((m, mi) => {
    for (let d = 0; d < 5; d++) {
      for (const [h, min] of slots) {
        const t = new Date(now.getFullYear(), now.getMonth(), now.getDate() + d, h, min)
        if (t > now) ins.run(m.id, t.toISOString(), 'Hall ' + (1 + ((mi + d) % 3)))
      }
    }
  })
}

// Default admin account so you never need to touch the database by hand.
if (!db.prepare("select 1 from users where role = 'admin'").get()) {
  db.prepare('insert into users (email, full_name, password_hash, role) values (?,?,?,?)')
    .run('admin@cinema.com', 'Cinema Admin', bcrypt.hashSync('admin12345', 10), 'admin')
}

export default db
