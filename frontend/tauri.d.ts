interface Window {
  __TAURI__: {
    core: {
      invoke(command: string, args?: Record<string, unknown>): Promise<unknown>
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
