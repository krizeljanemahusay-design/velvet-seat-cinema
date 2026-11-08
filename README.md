# Velvet Seat Cinema: React + Express + SQLite

A cinema seat-reservation **dashboard application** with full CRUD.

- **Front end:** React (Vite)
- **Back end:** Express.js REST API (`server/index.js`)
- **Database:** SQLite (`server/cinema.db`, created automatically on first run)
- **Login:** email + password (passwords hashed with bcrypt, sessions with JWT)

## How to run

Requires [Node.js](https://nodejs.org) (LTS).

```bash
npm install
npm run dev
```

Open **http://localhost:5173**. That's it. The database, sample movies and showtimes are created automatically.

### Accounts
| Role | Email | Password |
|---|---|---|
| Admin | `admin@cinema.com` | `admin12345` |
| Customer | click **Create an account** on the login page | any (8+ characters) |

The admin sees an **Admin** link in the header: Dashboard, Movies, Showtimes, Bookings and Waitlist.

### Run as one server (production style)
```bash
npm start
```
Builds the React app, then Express serves both the site and the API at **http://localhost:3001**.

## CRUD in this project
| Resource | Create | Read | Update | Delete |
|---|---|---|---|---|
| Movies (admin) | Add movie | Movies table | Edit | Delete |
| Showtimes (admin) | Add showtime | Showtimes table | Edit | Delete |
| Bookings | Pick seats and book | My tickets / Admin > Bookings | n/a | Cancel booking |
| Waitlist | Join waitlist | Admin > Waitlist | n/a | Serve next in line |

## REST API
| Method | Endpoint | Who |
|---|---|---|
| POST | `/api/auth/register`, `/api/auth/login` | anyone |
| GET | `/api/auth/me` | logged in |
| GET / POST / PUT / DELETE | `/api/movies`, `/api/movies/:id` | read: logged in, write: admin |
| GET / POST / PUT / DELETE | `/api/showtimes`, `/api/showtimes/:id` | read: logged in, write: admin |
| GET | `/api/showtimes/:id/seats` | logged in |
| GET / POST / DELETE | `/api/bookings`, `/api/bookings/:id`, `/api/bookings/ref/:ref` | logged in (own), admin (all) |
| GET / POST / DELETE | `/api/waitlist` | POST: logged in, GET/DELETE: admin |
| GET | `/api/dashboard` | admin |

## Data structures and algorithms
Queue (waitlist), Stack (undo, ticket history), Binary Search Tree (movie search), 2D array (seat map), Hash Set (taken seats); Merge sort, BST prefix search, Binary search, Sliding window. See `src/dsa.js`.

## Reset the data
Stop the server, delete `server/cinema.db`, start again.
