# Screens walker

Screenshots of the popup for design review, in dark and light: `screens-out/<shot>-dark.png`
and `screens-out/<shot>-light.png` (git-ignored). It is not part of CI.

```bash
pnpm --filter @beepocket/extension screens            # every group
pnpm --filter @beepocket/extension screens -- shell   # one group: screens/shell.spec.ts
```

It builds `dist/`, loads it in Chromium the way the e2e suite does (`e2e/fixtures.ts`), routes the
BZE node and Scan to canned answers and seeds the wallet through the worker's runtime messages.

## The data set (`support.ts`)

- the test phrase with four labelled addresses: Main, Savings and Trading hold BZE (and some
  PAGE), Cold is empty;
- BZE and PAGE, a factory token with a brand kit, picked as preferred tokens;
- three address-book contacts.

## Adding a shot

One spec file per screen group (`shell`, `onboarding`, `home`, `activity`, `send`, `settings`,
`dapp`). Add your shots to your group's file, or create the file:

```ts
import { openPopup, seedWallet, shot, test } from './support';

test('send form', async ({ context, extensionId }) => {
  const page = await openPopup(context, extensionId);
  await seedWallet(page);
  // ...drive the popup to the screen with page.getByRole(...)
  await shot(page, 'send-form');
});
```

`openPopup` sets the appearance to `system`, and `shot` switches the OS colour scheme to take
both pictures, so a screen must follow the appearance live (`useScheme()` or
`HomeEnv.scheme.subscribe`) for its light shot to show light colours. Each test gets a fresh
browser profile.
