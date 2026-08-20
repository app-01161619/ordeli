export async function render(container) {
  container.innerHTML = `
    <div class="screen">
      <h1 class="subtitle">Events</h1>
      <p class="text-secondary">
        Event creation, the "Bring to Event" list, and reschedule flows plug in here next,
        reading from the events table.
      </p>
    </div>
  `;
}
