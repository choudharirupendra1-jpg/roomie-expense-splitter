# Roomie — Room Expense Splitter

A mobile-first expense splitter for roommates and hostelmates. Roomie uses Firebase Authentication, Realtime Database, and Firebase Hosting. The project is designed to run on Firebase's no-cost Spark plan and does not use phone OTP.

## Features

- Sign in with Google or continue as a guest.
- Create a room or join with an 8-character invite code.
- Add dated expenses, choose who paid, and split the cost equally among selected roommates.
- See paid totals, shares, net balances, and suggested transfers.
- Sync room changes in real time.
- Attach an optional receipt image; the browser resizes and compresses it before saving.
- Start a new expense cycle manually. Previous cycles and their transactions stay in history.
- Leave a room and keep read-only access to the history available to former members.

## Run locally

1. Install Node.js 20 or newer.
2. Copy `.env.example` to `.env.local` and fill in the Firebase Web App configuration and Realtime Database URL.
3. In Firebase Authentication, enable Google and Anonymous sign-in. Add `localhost` to Authorized domains for local development.
4. Create a Realtime Database and publish the rules in `database.rules.json`.
5. Run `npm install`, then `npm run dev` and open the local URL Vite prints.

## Deploy

After signing into the Firebase CLI, run:

```sh
npm run build
npx firebase-tools deploy --only database,hosting
```

`firebase.json` points the Database deploy to `database.rules.json` and Hosting to the `dist` build directory.

## Security notes

- Database reads and writes are denied by default; room data access depends on authenticated room membership.
- Database Rules validate expense fields and amounts, restrict expenses and cycle closures to create-only writes, and reject unknown fields.
- Former members can only query history up to the time they left.
- `.env.local`, build output, Firebase CLI state, and dependency folders are excluded by `.gitignore`.
- Firebase Web App config is public client configuration, not a password. Never commit service-account keys or private credentials.
