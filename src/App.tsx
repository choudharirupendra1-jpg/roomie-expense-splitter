import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  GoogleAuthProvider,
  linkWithPopup,
  onAuthStateChanged,
  signInAnonymously,
  signInWithPopup,
  signOut,
  updateProfile,
} from "firebase/auth";
import type { User } from "firebase/auth";
import { auth, authReady } from "./firebase";
import RoomsHome from "./RoomsHome";

function authMessage(error: unknown) {
  const code = (error as { code?: string })?.code;
  if (code === "auth/invalid-api-key") {
    return "Sign-in isn't available right now. Please try again later.";
  }
  if (code === "auth/unauthorized-domain") {
    return "Sign-in isn't available on this website right now. Please try again later.";
  }
  if (code === "auth/operation-not-allowed" || code === "auth/admin-restricted-operation") {
    return "This sign-in option isn't available right now. Try another option.";
  }
  if (code === "auth/popup-closed-by-user") return "Sign-in was cancelled.";
  if (code === "auth/credential-already-in-use") {
    return "That Google account already has a Roomie sign-in. Use the Google sign-in option instead.";
  }
  if (code === "auth/network-request-failed") {
    return "A network error interrupted sign-in. Check your connection and try again.";
  }
  return "Sign-in didn’t work just now. Please try again.";
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!auth) {
      setError("Sign-in isn’t available right now. Please try again later.");
      return;
    }
    return onAuthStateChanged(auth, setUser);
  }, []);

  async function continueWithGoogle() {
    if (!auth) return;
    setLoading(true);
    setError("");
    try {
      const result = await signInWithPopup(auth, new GoogleAuthProvider());
      setUser(result.user);
    } catch (reason) {
      setError(authMessage(reason));
      setLoading(false);
    }
  }

  async function continueAsGuest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanName = name.trim();
    if (!cleanName) {
      setError("Add your name so your roommates know who you are.");
      return;
    }
    if (!auth) {
      setError("Sign-in isn’t available right now. Please try again later.");
      return;
    }

    setLoading(true);
    setError("");
    try {
      await authReady;
      const credential = await signInAnonymously(auth);
      await updateProfile(credential.user, { displayName: cleanName });
      setUser(credential.user);
    } catch (reason) {
      setError(authMessage(reason));
    } finally {
      setLoading(false);
    }
  }

  async function leaveGuestSession() {
    if (!auth) return;
    await signOut(auth);
    setUser(null);
    setName("");
  }

  async function connectGoogleAccount() {
    if (!auth?.currentUser) return;
    setLoading(true);
    setError("");
    try {
      const result = await linkWithPopup(auth.currentUser, new GoogleAuthProvider());
      setUser(result.user);
    } catch (reason) {
      setError(authMessage(reason));
      setLoading(false);
    }
  }

  if (user) {
    return (
      <main className="page-shell">
        <header className="topbar">
          <a className="brand" href="/" aria-label="Roomie home"><span className="brand-mark">r</span><span>roomie</span></a>
          <span className="topbar-note">Shared living, made simpler</span>
        </header>
        <RoomsHome
          user={user}
          busy={loading}
          accountError={error}
          onSignOut={leaveGuestSession}
          onConnectGoogle={connectGoogleAccount}
        />
        <footer className="footer"><span>MADE FOR THE PEOPLE YOU LIVE WITH</span><span>NO MORE “I’LL PAY YOU LATER” MATH</span></footer>
      </main>
    );
  }

  return (
    <main className="page-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Roomie home">
          <span className="brand-mark">r</span>
          <span>roomie</span>
        </a>
        <span className="signin-promise"><span>✓</span> Free to use · No phone OTP</span>
      </header>

      <section className="signin-page-layout" aria-labelledby="welcome-title">
        <div className="signin-story">
          <p className="panel-kicker">SHARED LIVING, SIMPLER</p>
          <h1 id="welcome-title">Room expenses,<br /><span>all sorted.</span></h1>
          <p className="signin-story-copy">Track the little things, see everyone’s share, and settle up without the awkward reminders.</p>
          <div className="room-preview-wrap">
            <div className="sample-room-card" aria-label="Example room expense preview">
              <div className="sample-room-heading"><span>ROOM PREVIEW</span><span>EXAMPLE</span></div>
              <div className="sample-room-title"><span className="sample-room-icon">⌂</span><span><strong>Maple House</strong><small>3 roommates</small></span></div>
              <div className="sample-expense-row"><span className="sample-expense-icon milk-icon">M</span><span className="sample-expense-name">Milk<small>Paid by Nia</small></span><strong>₹64</strong></div>
              <div className="sample-expense-row"><span className="sample-expense-icon wifi-icon">⌁</span><span className="sample-expense-name">Wi-Fi<small>Paid by Aanya</small></span><strong>₹599</strong></div>
              <div className="sample-room-footer"><span>Your share</span><strong>₹221</strong></div>
            </div>
            <div className="settled-note"><span>✓</span> Settled up</div>
          </div>
        </div>

        <div className="signin-panel simple-signin-panel">
          <p className="panel-kicker">GET STARTED</p>
          <h2>Welcome to Roomie</h2>
          <p className="panel-description">Sign in to create a room or join your roommates.</p>

          <button className="google-button" onClick={continueWithGoogle} disabled={loading}>
            <GoogleGlyph />
            <span>{loading ? "Connecting…" : "Continue with Google"}</span>
          </button>

          <div className="divider"><span /> <small>OR CONTINUE AS GUEST</small> <span /></div>

          <form className="guest-form" onSubmit={continueAsGuest}>
            <label htmlFor="guest-name">Your name</label>
            <div className="input-row">
              <input
                id="guest-name"
                type="text"
                autoComplete="name"
                placeholder="Enter your name"
                maxLength={40}
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={loading}
              />
              <button type="submit" disabled={loading || !name.trim()} aria-label="Continue as guest">
                {loading ? "…" : "Continue"}
              </button>
            </div>
            <p className="guest-caption">No password or phone OTP.</p>
          </form>
          {error && <p className="error-message" role="alert">{error}</p>}
        </div>
        <div className="mobile-how-card" aria-label="How Roomie works">
          <p className="panel-kicker">HOW ROOMIE WORKS</p>
          <div className="mobile-how-steps">
            <div><span className="how-icon how-money">₹</span><span><strong>Add an expense</strong><small>Item, amount and payer</small></span></div>
            <div><span className="how-icon how-people">◉</span><span><strong>Choose roommates</strong><small>Select who shares it</small></span></div>
            <div><span className="how-icon how-split">÷</span><span><strong>See the split</strong><small>Equal by default</small></span></div>
          </div>
        </div>
      </section>
    </main>
  );
}

function GoogleGlyph() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" width="20" height="20">
      <path fill="#4285F4" d="M19.6 10.23c0-.68-.06-1.36-.18-2.02H10v3.82h5.38a4.6 4.6 0 0 1-2 3.02v2.48h3.23c1.9-1.75 2.99-4.33 2.99-7.3Z" />
      <path fill="#34A853" d="M10 20c2.7 0 4.97-.9 6.62-2.47l-3.23-2.48c-.9.6-2.04.96-3.39.96-2.61 0-4.82-1.76-5.61-4.13H1.05v2.55A10 10 0 0 0 10 20Z" />
      <path fill="#FBBC05" d="M4.39 11.88a6.02 6.02 0 0 1 0-3.76V5.57H1.05a10 10 0 0 0 0 8.86l3.34-2.55Z" />
      <path fill="#EA4335" d="M10 3.99c1.47 0 2.79.5 3.83 1.51l2.87-2.87C14.96.99 12.7 0 10 0a10 10 0 0 0-8.95 5.57l3.34 2.55C5.18 5.75 7.39 3.99 10 3.99Z" />
    </svg>
  );
}
