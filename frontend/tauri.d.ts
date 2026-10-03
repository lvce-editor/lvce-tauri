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
  }
}
