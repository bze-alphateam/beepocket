import { call, openPopup, PASSWORD, reload, seedWallet, shot, test } from './support';

// The kit's first screens: Welcome, Unlock and the Home shell.

test('welcome', async ({ context, extensionId }) => {
  const page = await openPopup(context, extensionId);
  await reload(page, 'Create a new wallet');
  await shot(page, 'welcome');
});

test('unlock', async ({ context, extensionId }) => {
  const page = await openPopup(context, extensionId);
  await seedWallet(page);
  await call(page, 'wallet.lock');
  await reload(page, 'Welcome back');
  await shot(page, 'unlock');
});

test('home', async ({ context, extensionId }) => {
  const page = await openPopup(context, extensionId);
  await seedWallet(page);
  await call(page, 'wallet.unlock', { password: PASSWORD });
  await reload(page, 'Main');
  await shot(page, 'home');
});
