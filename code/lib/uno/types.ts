/**
 * UNO 客户端类型：与服务端 `uno-rooms.js` / `uno-engine.js` 下发的结构一一对应。
 * 服务端是规则权威，客户端只负责展示与发送意图，所以这里的字段全部是「只读快照」。
 */

export interface UnoColor {
  id: string;
  name: string;
  hex: string;
  deep: string;
  ink: string;
}

export interface UnoKindEffect {
  type: string;
  target?: string;
  count?: number;
  steps?: number;
  playable?: boolean;
}

export interface UnoKind {
  id: string;
  name: string;
  category: string;
  colorMode: 'color' | 'wild';
  points?: number | string;
  description?: string;
  tips?: string[];
  art?: { glyph?: string; glyphScale?: number; badge?: string | null };
  effect?: UnoKindEffect[];
  deck?: { count: number; value?: number; valueFrom?: number; valueTo?: number }[];
}

export interface UnoCategory {
  id: string;
  name: string;
  description?: string;
}

export interface UnoHouseRule {
  id: string;
  type: 'boolean' | 'number' | 'select';
  default: boolean | number | string;
  name: string;
  description?: string;
  min?: number;
  max?: number;
  options?: string[];
}

export interface UnoCatalog {
  id: string;
  name: string;
  description?: string;
  colors: UnoColor[];
  wildColor: UnoColor | null;
  categories: UnoCategory[];
  kinds: UnoKind[];
  houseRules: UnoHouseRule[];
  turnDefaults: { seats?: number; bots?: number; thinkSeconds?: number };
  thinkOptions: number[];
  limits: { minSeats: number; maxSeats: number };
}

export interface UnoCardView {
  id: string;
  face: string;
  color: string;
  kind: string;
  value: number | null;
}

export interface UnoPlayerView {
  seat: number;
  name: string;
  isBot: boolean;
  handCount: number;
  saidUno: boolean;
  unoPending: boolean;
}

export interface UnoLegal {
  seat: number;
  playable: string[];
  canDraw: boolean;
  canPass: boolean;
  mustDraw: boolean;
  needsColor: boolean;
  pendingDraw: number;
  drawnThisTurn: boolean;
  reason: string;
}

export interface UnoGameView {
  phase: 'playing' | 'roundOver';
  rules: Record<string, boolean>;
  seat: number | null;
  direction: 1 | -1;
  turnSeat: number;
  currentColor: string | null;
  top: UnoCardView | null;
  discardTail: UnoCardView[];
  drawPileCount: number;
  discardCount: number;
  pendingDraw: number;
  pendingDrawKind: string | null;
  awaitColorSeat: number | null;
  turnCount: number;
  winner: number | null;
  roundPoints: number;
  players: UnoPlayerView[];
  hand: UnoCardView[];
  legal: UnoLegal;
  log: { seq: number; text: string }[];
  seq: number;
}

export interface UnoSeatView {
  seat: number;
  username: string | null;
  displayName: string | null;
  isBot: boolean;
  botLevel: string | null;
  occupied: boolean;
  connected: boolean;
  autoPiloted: boolean;
}

export interface UnoEvent {
  seq: number;
  kind: string;
  seat?: number;
  count?: number;
  card?: UnoCardView;
  color?: string;
  direction?: number;
  points?: number;
  playable?: boolean;
  pendingKind?: string;
}

export interface UnoRoomSettings {
  seats: number;
  thinkSeconds: number;
  rules: Record<string, boolean | number | string>;
  expansions: string[];
}

export interface UnoLobbyRoom {
  roomId: string;
  hostUsername: string;
  phase: 'waiting' | 'playing' | 'roundOver';
  roundNumber: number;
  seatCount: number;
  seatedCount: number;
  humanCount: number;
  connectedHumans: number;
  botCount: number;
  thinkSeconds: number;
  rules: Record<string, boolean | number | string>;
  expansions: string[];
  createdAt: number;
  lastHumanActivity: number;
}

export interface UnoRoomView {
  roomId: string;
  hostUsername: string;
  isHost: boolean;
  phase: 'waiting' | 'playing' | 'roundOver';
  roundNumber: number;
  settings: UnoRoomSettings;
  rulesSchema: UnoHouseRule[];
  limits: { minSeats: number; maxSeats: number; thinkOptions: number[] };
  seat: number | null;
  seats: UnoSeatView[];
  canStart: boolean;
  canRematch: boolean;
  turnDeadline: number | null;
  serverNow: number;
  game: UnoGameView | null;
  events: UnoEvent[];
  seq: number;
  log: { at: number; seat: number | null; text: string }[];
}

export type UnoServerMessageType = 'ROOM_STATE' | 'ROOM_CLOSED' | 'ERROR' | 'PONG';

export interface UnoServerMessage {
  type: UnoServerMessageType;
  payload: any;
}