interface Window {
  __TAURI__: {
    core: {
      invoke(command: string): Promise<unknown>
    }
    window: {
      getCurrentWindow(): {
        close(): Promise<void>
      }
    }
    dialog: {
      open(options: { directory: true; multiple: false; title: string }): Promise<string | null>
    }
  }
}
