window.__TAURI__.core.invoke('open_editor').catch((error: unknown) => {
  const status = document.querySelector<HTMLElement>('#status')
  if (status) status.textContent = `Could not start LVCE Editor: ${error}`
})
