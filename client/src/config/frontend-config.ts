export const FRONTEND_STORAGE_CONFIG = {
  accountStoreKey: 'poker_accounts',
  sessionStoreKey: 'poker_session',
  handHistoryStorePrefix: 'poker_hand_history',
  quickBetSizesStorePrefix: 'poker_quick_bet_sizes',
  testConfigStorePrefix: 'poker_test_config',
} as const;

export const FRONTEND_AUTH_CONFIG = {
  defaultAdminUsername: 'admin',
  defaultAdminPassword: 'admin',
  minimumUsernameLength: 2,
  minimumPasswordLength: 4,
} as const;

export const FRONTEND_HAND_HISTORY_CONFIG = {
  maxSavedHandsPerUser: 1000,
} as const;

export const FRONTEND_TABLE_CONFIG = {
  supportedTableCounts: [1, 2, 3, 4] as const,
  minimumBetSizeBb: 1,
  minimumRaiseIncrementBb: 1,
  defaultQuickBetPercentages: [33, 50, 75, 100, 125, 150, 175, 200] as const,
  aiActsFirstAutoActionDelayMs: 800,
  delayedOpponentActionMs: 5000,
} as const;

export const FRONTEND_LAYOUT_CONFIG = {
  desktopSidebarAutoOpenBreakpointPx: 1280,
  singleViewTableAreaClasses: 'h-[600px] p-8',
  multiViewTableAreaClasses: 'h-[360px] p-6',
} as const;

export const FRONTEND_SIDEBAR_CONFIG = {
  collapsedRailWidthClass: 'w-14',
  actionHistoryExpandedWidthClass: 'w-[280px]',
  actionHistoryExpandedWideWidthClass: 'xl:w-[320px]',
  riverExploitExpandedWidthClass: 'w-[360px]',
  riverExploitExpandedWideWidthClass: 'xl:w-[400px]',
} as const;

export const FRONTEND_RIVER_EXPLOIT_CONFIG = {
  reasoningTimeoutMs: 60000,
  staleRequestMarker: '__river_exploit_stale_request__',
} as const;

export const FRONTEND_CUSTOM_HAND_CONFIG = {
  boardOnlySlotCount: 3,
  boardAndHoleCardSlotCount: 7,
} as const;

export function buildScopedStorageKey(prefix: string, username: string): string {
  return `${prefix}_${username}`;
}
