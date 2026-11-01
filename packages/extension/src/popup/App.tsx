import { version } from '@beepocket/core';

export function App() {
  return (
    <main class="app">
      <img src="icons/icon-48.png" width="48" height="48" alt="" />
      <h1>BeePocket</h1>
      <small>v{version}</small>
    </main>
  );
}
