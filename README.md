# Habits — Daily Tracker & Weekly Planner (PWA)

Mobile-first habit tracker with daily reflection, monthly heatmap analytics, goals & lists,
a drag-and-drop weekly planner, and 2-way Google Calendar sync. Built with Vite + React 19 +
TypeScript + Tailwind v4, backed by Supabase, deployed on Netlify.

```
src/
  App.tsx                 auth gate, tab router, toast
  components/             BottomNav, AuthScreen, HabitEditor, ui/ (Sheet, ProgressRing, Bits)
  tabs/                   Today, Calendar, Lists, Planner, Settings
  store/useStore.ts       zustand store (localStorage persisted, synced to Supabase)
  lib/                    supabase client, db sync, google calendar client, analytics, dates
netlify/functions/
  google-token.ts         refreshes Google access tokens server-side (needs client secret)
supabase/migrations/
  0001_init.sql           schema + RLS policies
```

The app also works **without any backend** ("local only" mode): everything is kept in the
browser's localStorage. When you later sign in, local data is migrated to your account.

## 1. Local development

```bash
npm install
cp .env.example .env      # fill in values (optional for local-only mode)
npm run dev
```

`npm run build` type-checks and produces `dist/` with the service worker and manifest.
`npm run icons` regenerates the PWA icons (no native deps).

## 2. Supabase setup

1. Create a project at https://supabase.com.
2. SQL editor → run `supabase/migrations/0001_init.sql` (or `supabase db push` with the CLI).
3. Authentication → Providers → enable **Email** and **Google**.
4. Authentication → URL configuration: set Site URL to your Netlify URL and add
   `http://localhost:5173` and your Netlify URL to Redirect URLs.
5. Copy Project URL + anon key into `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`.

## 3. Google Calendar (2-way)

1. Google Cloud Console → create a project → enable **Google Calendar API**.
2. OAuth consent screen: add scope `https://www.googleapis.com/auth/calendar`. Add yourself as a test
   user while the app is in "Testing" status.
3. Credentials → OAuth 2.0 Client ID (Web application):
   - Authorised JavaScript origins: your Netlify URL, `http://localhost:5173`
   - Authorised redirect URI: `https://<YOUR-PROJECT>.supabase.co/auth/v1/callback`
4. Paste the Client ID + secret into Supabase → Authentication → Providers → Google.
5. Set the same `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` plus `SUPABASE_URL` /
   `SUPABASE_SERVICE_ROLE_KEY` as **Netlify environment variables** (server-only, never `VITE_`).

How it works: the user signs in with Google through Supabase requesting the calendar scope with
`access_type=offline&prompt=consent`. Supabase returns `provider_refresh_token` once; the app stores it in
`google_tokens` (RLS: users can write but never read it back). `netlify/functions/google-token.ts`
verifies the Supabase JWT, exchanges the refresh token for an access token and caches it. The browser then
calls the Calendar API directly:

- **Pull**: events for the visible week (+5 weeks) are fetched and shown in Today's schedule stream and the
  Planner timeline; busy intervals drive auto-fill.
- **Push**: every scheduled habit block is created/updated/deleted as an event on the primary calendar,
  tagged with `extendedProperties.private.app = habit-tracker` so re-imports don't duplicate it.

If a user signed up with email first, "Connect Google Calendar" in Settings runs the same OAuth flow;
Supabase links the Google identity to the existing account when the e-mail matches.

## 3b. Krónan (meal prep)

Lists → **Meals** holds a recipe library and a weekly meal plan with an estimated cost in ISK.
Recipes can be written by hand (with a price per ingredient) or pulled from Krónan's recipe
catalogue, where every ingredient is a real product with a live price. Each recipe shows two lists:
**Need to buy** (packages, prices, total) and **Recipe** (amount actually used per ingredient with
macros, plus totals per dish and per serving). Macros come from Krónan's product nutrition table
(per 100 g) via `POST /products/batch/`; package sizes from `qtyPerBaseCompUnit` or the product name.
"Make this" adds the recipe to the plan, pushes the need-to-buy list into Groceries and, when
connected, creates a product list in the Krónan app. Actions on the weekly plan:

- **Ingredients → Groceries**: merges all ingredients (scaled to servings) into the "Groceries" list.
- **Schedule Sunday prep**: creates a weekly "Meal prep" habit and a Sunday 14:00 block in the Planner
  (and on Google Calendar when connected).
- **Send to Krónan list**: creates a product list in your Krónan account with the linked products.

Krónan's public API (`https://api.kronan.is/api/v1/`) needs a personal access token, created under
your kronan.is account settings, and sends no CORS headers. The app therefore calls it through
`/api/kronan/*`: the Vite dev proxy locally and `netlify/functions/kronan.ts` in production. The token is
stored only in the browser (localStorage) and forwarded as `Authorization: AccessToken <token>`.
Nothing is stored server-side. Run `supabase/migrations/0002_meals.sql` for the `recipes` and
`meal_plans` tables.

## 4. Netlify deploy

1. New site from Git → build command `npm run build`, publish directory `dist` (already in `netlify.toml`).
2. Add environment variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.
3. Deploy. `/api/*` is redirected to Netlify Functions; everything else falls back to `index.html`.

## 5. iPhone Home Screen

Open the site in Safari → Share → **Add to Home Screen**. The app runs standalone (no browser chrome),
respects the safe areas, works offline for cached assets, and keeps data in localStorage between launches.

## Data model

| table | purpose |
|---|---|
| `habits` | name, icon, color, frequency (`daily`/`weekly`/`monthly`), target_count, sub_habits[], default_time, duration |
| `habit_logs` | one row per habit per day; `sub_habit` records which option was chosen |
| `reflections` | 1–5 mood score + note per day |
| `goals`, `goal_tasks` | long-term goals (optional target date), linked habit ids, action steps |
| `lists`, `list_items` | general lists with ordering |
| `scheduled_blocks` | planner time blocks; `google_event_id` links the mirrored calendar event |
| `google_tokens` | refresh token per user (server-only read) |

All tables have RLS `auth.uid() = user_id`.
