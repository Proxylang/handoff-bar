export type HandoffbarExpiredFor = number | null

declare module 'claude-code' {
  interface PluginState {
    handoffbar: {
      expiredFor: HandoffbarExpiredFor
      cacheLeft: number | null
      isHidden: boolean
      notice: string | null
      hasReply: boolean
    }
  }
}
