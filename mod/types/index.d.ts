export type HandoffbarExpiredFor = number | null

declare module 'claude-code' {
  interface PluginState {
    handoffbar: { expiredFor: HandoffbarExpiredFor; isHidden: boolean }
  }
}
