import { useEffect, useState } from 'react'
import { api, getToken, setToken } from './api.js'
import { validEmail } from './util.js'

// Shows the login / sign-up form until the user is logged in, then renders the app.
export default function AuthGate({ children }) {
  const [step, setStep] = useState('loading') // loading | login | ready
  const [profile, setProfile] = useState(null)

  useEffect(() => {
    if (!getToken()) return setStep('login')
    api.get('/auth/me').then((p) => { setProfile(p); setStep('ready') }).catch(() => { setToken(null); setStep('login') })
  }, [])

  const signIn = (token, p) => { setToken(token); setProfile(p); setStep('ready') }
  const signOut = () => { setToken(null); setProfile(null); setStep('login') }

  if (step === 'loading') return <p className="muted pad center">Loading…</p>
  if (step === 'login') return <Login onAuth={signIn} />
  return children({ profile, signOut })
}

function Login({ onAuth }) {
  const [mode, setMode] = useState('login')
  const [f, setF] = useState({ name: '', email: '', password: '' })
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })

  const submit = async (e) => {
    e.preventDefault(); setMsg('')
    if (mode === 'signup' && f.name.trim().length < 2) return setMsg('Enter your full name.')
    if (!validEmail(f.email)) return setMsg('Enter a valid email address.')
    if (f.password.length < 8) return setMsg('Password must be at least 8 characters.')
    setBusy(true)
    try {
      const email = f.email.trim().toLowerCase()
      const data = mode === 'login'
        ? await api.post('/auth/login', { email, password: f.password })
        : await api.post('/auth/register', { name: f.name.trim(), email, password: f.password })
      onAuth(data.token, data.profile)
    } catch (err) {
      setMsg(err.message); setBusy(false)
    }
  }

  return (
    <main className="auth">
      <h1 className="brand-lg">Velvet Seat</h1>
      <form className="panel" onSubmit={submit}>
        <h2>{mode === 'login' ? 'Log in' : 'Create account'}</h2>
        {mode === 'signup' && <label>Full name<input value={f.name} onChange={set('name')} autoComplete="name" /></label>}
        <label>Email<input type="email" value={f.email} onChange={set('email')} autoComplete="email" /></label>
        <label>Password<input type="password" value={f.password} onChange={set('password')} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} /></label>
        {msg && <p className="banner err">{msg}</p>}
        <button className="primary" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Sign up'}</button>
        <button type="button" className="link" onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setMsg('') }}>
          {mode === 'login' ? 'New here? Create an account' : 'Have an account? Log in'}
        </button>
      </form>
    </main>
  )
}
