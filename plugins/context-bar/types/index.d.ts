/** One drawn segment of the bar: a /context row that occupies the window. */
export type Segment = {
  name: string
  tokens: number
  /** Theme colour key as /context draws the row (`promptBorder`, `inactive`, ...). */
  color: string
  kind: 'used' | 'free' | 'buffer'
}

/** The last breakdown read from `$.session.usage`, trimmed to what the band draws. */
export type Snapshot = {
  segments: Segment[]
  totalTokens: number
  maxTokens: number
  percentage: number
  model: string
}

declare module 'claude-code' {
  interface PluginState {
    'context-bar': { isHidden: boolean; snapshot: Snapshot | null }
  }
}
