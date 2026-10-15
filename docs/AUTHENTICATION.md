# LedgerOps authentication setup

LedgerOps signs users in with OpenID Connect (authorization code + PKCE) and keeps the session server-side in Postgres. The browser only holds an opaque `HttpOnly; SameSite=Lax; Secure` session cookie (`__Host-ledgerops.sid` in production).

## What you must set up

1. **An OIDC identity provider** (for example an Auth0 application of type *Regular Web Application*).
   - Allowed Callback URL: `https://ledgerops.onrender.com/api/auth/callback`
   - Disable public sign-ups so only people you invite can create accounts.
   - Note the issuer URL, client ID and client secret.
2. **A Render Postgres database** in the same region as the web service. Copy its **Internal Database URL**.
3. **Environment variables on the Render web service** (see `.env.example`):

| Variable | Value |
| --- | --- |
| `FRONTEND_URL` | `https://ledgerops.onrender.com` |
| `SESSION_SECRET` | random string, 32+ characters |
| `OIDC_ISSUER_URL` | issuer URL from your provider |
| `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` | from your provider |
| `AUTH_ALLOWED_EMAILS` | comma-separated emails permitted to sign in |
| `DATABASE_URL` | Render Internal Database URL |
| `QUICKBOOKS_*` | unchanged; `QUICKBOOKS_ENVIRONMENT` must stay `sandbox` |

The Intuit redirect URI stays `https://ledgerops.onrender.com/api/quickbooks/callback`.

The session table (`user_sessions`) is created automatically on first start.

## Behaviour

- Fail closed: if any required variable is missing, the server logs which one and returns `401` for every QuickBooks route.
- Only emails in `AUTH_ALLOWED_EMAILS` with a verified email at the provider can sign in.
- Sessions expire after 8 hours idle and 12 hours absolute.
- State-changing requests need the `X-CSRF-Token` header from `GET /api/auth/session` and a same-origin `Origin`.
- QuickBooks OAuth state is stored in the signed-in session, expires after 10 minutes and works once.
- `POST /api/quickbooks/connect` replaced the old `GET /api/quickbooks/connect`.

## Local development

Create a provider application with callback `http://localhost:5173/api/auth/callback`, set the variables above in `.env` with `FRONTEND_URL=http://localhost:5173`, and run `npm run dev:all`. Without `DATABASE_URL`, development uses an in-memory session store.

## Known limits (later phases)

- The QuickBooks connection is still one shared, in-memory connection for the whole server, not per user or client.
- The GitHub Pages build cannot hold a session; its Sign in button redirects to the Render site.
