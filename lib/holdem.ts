/** 德州扑克前端共享类型：与 server/holdem-rooms.js 的 roomView / handView 一一对应。 */

export type HoldemAccount = {
  chips: number;
  handsPlayed: number;
  handsWon: number;
  startingChips: number;
  minBuyIn: number;
  canReset: boolean;
  updatedAt: string;
};

export type HoldemLedgerEntry = {
  id: string;
  delta: number;
  balance: number;
  kind: string;
  roomId: string | null;
  note: string | null;
  createdAt: string;
};

export type HoldemLobbyRoom = {
  roomId: string;
  hostUsername: string;
  phase: 'waiting' | 'playing';
  smallBlind: number;
  bigBlind: number;
  buyIn: number;
  thinkSeconds: number;
  maxSeats: number;
  seatedCount: number;
  humanCount: number;
  handNumber: number;
  lastActivity: number;
};

export type HoldemSeatView = {
  seat: number;
  username: string | null;
  isBot: boolean;
  botLevel: string | null;
  botName: string | null;
  displayName: string | null;
  stack: number;
  connected: boolean;
  autoPiloted: boolean;
  empty: boolean;
};

export type HoldemLegalActions = {
  seat: number;
  toCall: number;
  canCheck: boolean;
  canCall: boolean;
  canFold: boolean;
  canRaise: boolean;
  minRaiseTo: number;
  maxRaiseTo: number;
  isAllInOnly: boolean;
  pot: number;
  stack: number;
  committed: number;
};

export type HoldemHandPlayer = {
  seat: number;
  username: string | null;
  isBot: boolean;
  botLevel: string | null;
  stack: number;
  committed: number;
  totalCommitted: number;
  inHand: boolean;
  allIn: boolean;
  lastAction: string | null;
  holeCards: string[] | null;
  handDescription: string | null;
};

export type HoldemHandView = {
  handNumber: number;
  street: string;
  board: string[];
  pot: number;
  currentBet: number;
  minRaise: number;
  buttonSeat: number;
  actingSeat: number | null;
  smallBlind: number;
  bigBlind: number;
  complete: boolean;
  results: {
    payouts: { seat: number; amount: number }[];
    shownHands: { seat: number; holeCards: string[]; description: string; name: string }[];
    pot: number;
    winners: number[];
  } | null;
  log: { at: number; seat: number | null; text: string }[];
  players: HoldemHandPlayer[];
  legal: HoldemLegalActions | null;
};

export type HoldemRoomView = {
  roomId: string;
  hostUsername: string;
  isHost: boolean;
  phase: 'waiting' | 'playing';
  smallBlind: number;
  bigBlind: number;
  buyIn: number;
  thinkSeconds: number;
  maxSeats: number;
  seat: number | null;
  buttonSeat: number;
  handNumber: number;
  actionDeadline: number | null;
  nextHandAt: number | null;
  canStart: boolean;
  seats: HoldemSeatView[];
  hand: HoldemHandView | null;
  log: { at: number; seat: number | null; text: string }[];
};

export const THINK_SECOND_OPTIONS = [10, 15, 30] as const;
export const BOT_LEVEL_OPTIONS = [
  { value: 'easy', label: '新手', hint: '跟得松、几乎不加注' },
  { value: 'normal', label: '普通', hint: '按底池赔率决策' },
  { value: 'hard', label: '高手', hint: '算得深、会诈唬' },
] as const;
