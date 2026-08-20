import { getSession, signOut } from '../auth.js';

export async function render(container) {
  const session = getSession();

  container.innerHTML = `
    <div class="screen">
      <h1 class="subtitle">More</h1>

      <div class="stack" style="margin-bottom: 32px;">
        <p class="text-small text-secondary" style="margin-bottom: 4px;">Signed in as</p>
        <p>${escapeHtml(session?.user.email ?? session?.user.id ?? '')}</p>
      </div>

      <button type="button" class="button button--danger" data-sign-out>Sign out</button>
    </div>
  `;

  container.querySelector('[data-sign-out]').addEventListener('click', async () => {
    await signOut();
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
