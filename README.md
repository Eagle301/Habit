# Habits — Daily Tracker & Weekly Planner (PWA)

Mobile-first habit tracker with a monthly calendar you plan your days in, goals, weekly meal prep,
and 2-way Google Calendar sync. Built with Vite + React 19 +
TypeScript + Tailwind v4, backed by Supabase, deployed on Netlify.

```
src/
  App.tsx                 auth gate, tab router, toast
  components/             BottomNav, AuthScreen, HabitEditor, ui/ (Sheet, ProgressRing, Bits)
  tabs/                   Today, Calendar (incl. planning), Meals, Goals, Settings
  lib/planning.ts         what is still unplanned, free-slot search, auto-fill a week
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

**Upgrading an existing project to the November 2026 version** (goals + projects merged, to-dos on
the calendar, recipe photos, preferred habit days): run `supabase/apply_all_new_changes.sql` once in
the SQL editor before deploying. It bundles migrations 0006, 0007 and 0009–0011, is safe to re-run,
and deletes nothing.

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
  Calendar tab's day view; busy intervals drive planning and auto-fill.
- **Push**: every scheduled habit block is created/updated/deleted as an event on the primary calendar,
  tagged with `extendedProperties.private.app = habit-tracker` so re-imports don't duplicate it.

If a user signed up with email first, "Connect Google Calendar" in Settings runs the same OAuth flow;
Supabase links the Google identity to the existing account when the e-mail matches.

## 3b. Krónan (meal prep)

The **Meals** tab holds a recipe library and a weekly meal plan with an estimated cost in ISK.
Recipes can be written by hand (with a price per ingredient) or pulled from Krónan's recipe
catalogue, where every ingredient is a real product with a live price. Each recipe shows two lists:
**Need to buy** (packages, prices, total) and **Recipe** (amount actually used per ingredient with
macros, plus totals per dish and per serving). Macros come from Krónan's product nutrition table
(per 100 g) via `POST /products/batch/`; package sizes from `qtyPerBaseCompUnit` or the product name.
The tab always shows the week being prepped (this week; from Sunday, the week ahead). "Plan & shop"
adds a recipe to that week and, when connected, creates a product list in the Krónan app. The week card
shows a **shopping list** merged from all planned recipes (scaled to servings, whole packages). Actions on the weekly plan:

- **Schedule prep**: creates a weekly "Meal prep" habit and a Sunday block on the calendar
  (and on Google Calendar when connected), plus a "Shop for meal prep" to-do.
- **Send to Krónan list**: creates a product list in your Krónan account with the linked products.

Krónan's public API (`https://api.kronan.is/api/v1/`) needs a personal access token, created under
your kronan.is account settings, and sends no CORS headers. The app therefore calls it through
`/api/kronan/*`: the Vite dev proxy locally and `netlify/functions/kronan.ts` in production. The token is
forwarded as `Authorization: AccessToken <token>`, cached in the browser (localStorage) and, when signed
in, saved per user in the `kronan_tokens` table (RLS: owner only) so it is restored on the next sign-in
or device. Run `supabase/migrations/0002_meals.sql` (recipes, meal plans) and
`supabase/migrations/0005_kronan_tokens.sql`, or the combined `supabase/schema.sql`.

**Recipe photos**: the photo area on a recipe opens the phone camera or photo library. Photos are
shrunk on the device (max 1280 px JPEG) and, when signed in, uploaded to the `recipe-photos` Storage
bucket under the user's own folder (run `supabase/migrations/0010_recipe_photos.sql`). In local-only mode,
or before that migration runs, a smaller copy is stored inline in the recipe instead.

## 3c. Daily reminder (push notifications)

Settings → Notifications → **Daily reminder** sends a push at the chosen local time listing the daily
habits not done yet (nothing is sent when all are done). It needs a signed-in account.

1. Run `supabase/migrations/0008_push_reminders.sql` (`push_subscriptions`, `reminder_settings`).
2. Generate VAPID keys once: `npx web-push generate-vapid-keys`.
3. Netlify env: `VITE_VAPID_PUBLIC_KEY` (public key), `VAPID_PRIVATE_KEY` (private key, server only),
   `VAPID_SUBJECT` (`mailto:you@example.com`). Redeploy so the public key is built into the app.

`netlify/functions/daily-reminder.ts` is a scheduled function (every 5 min, published deploy only).
`/api/push-test` backs the **Send test** button. The service-worker handlers are in `public/push-sw.js`.
On iPhone (iOS 16.4+) push only works from the Home Screen app, not a Safari tab.

## 4. Netlify deploy

1. New site from Git → build command `npm run build`, publish directory `dist` (already in `netlify.toml`).
2. Add environment variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and for reminders
   `VITE_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`.
3. Deploy. `/api/*` is redirected to Netlify Functions; everything else falls back to `index.html`.

## 5. iPhone Home Screen

Open the site in Safari → Share → **Add to Home Screen**. The app runs standalone (no browser chrome),
respects the safe areas, works offline for cached assets, and keeps data in localStorage between launches.

## Data model

| table | purpose |
|---|---|
| `habits` | name, icon, color, frequency (`daily`/`weekly`/`monthly`), target_count, sub_habits[], default_time, duration |
| `habit_logs` | one row per habit per day; `sub_habit` records which option was chosen |
| `projects` | goals: optional due date, `steps` (jsonb checklist) and `hours_est` booked as one-hour sessions (0 = none) |
| `tasks` | one-time to-dos, optionally due and planned on the calendar |
| `scheduled_blocks` | planned time blocks (habit, goal session or to-do); `google_event_id` links the mirrored calendar event |
| `recipes`, `meal_plans` | recipe library and the meals planned per week |

`goals`, `goal_tasks`, `lists`, `list_items` and `reflections` are no longer used:
`0009_simplify.sql` copies old goals into `projects` and archives "extra" trackers.
| `google_tokens` | refresh token per user (server-only read) |

All tables have RLS `auth.uid() = user_id`.
