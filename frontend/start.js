window.__TAURI__.core.invoke('open_editor').catch((error) => {
  document.querySelector('#status').textContent = `Could not start LVCE Editor: ${error}`
})
