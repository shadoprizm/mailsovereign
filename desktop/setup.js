const form = document.querySelector("form");
const input = document.querySelector("#server-url");
const message = document.querySelector("#message");
const submit = document.querySelector("button[type='submit']");

function showMessage(text) {
  message.textContent = text;
  message.hidden = !text;
}

async function initialize() {
  const state = await window.sovereignMailDesktop.getState();
  input.value = state.serverUrl ?? "";
  if (state.loadError) showMessage(state.loadError);
  input.focus();
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  showMessage("");
  submit.disabled = true;

  try {
    const result = await window.sovereignMailDesktop.configureServer(input.value);
    if (!result.ok) showMessage(result.error);
  } catch {
    showMessage("The desktop client could not save that server address.");
  } finally {
    submit.disabled = false;
  }
});

initialize().catch(() => {
  showMessage("The desktop client could not read its local configuration.");
});
