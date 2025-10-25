import { create } from 'zustand'
import { createRoom as emitCreateRoom, joinRoom as emitJoinRoom, takeSeat as emitTakeSeat, setReady as emitSetReady } from '../realtime'

export type Player = { id: string; name: string; seat: number | null; ready?: boolean }
export type Card = { suit: 'H'|'D'|'S'|'C'; rank: string }
export type ChatMessage = { id: string; name: string; text: string; ts: number }
export type WindState = { finisherId: string; skipSeat: number | null; currentSeat: number | null; queueSeats: number[]; baseCards: Card[] } | null

type RoomState = {
  roomCode: string | null
  isHost: boolean
  hostId: string
  started: boolean
  players: Player[]
  meId: string
  timers: Record<string, number>
  myHand: Card[]
  lastPlayed: Card[]
  turnSeat: number | null
  turnEndsAt: number | null
  scores: Record<string, number>
  teamScores: { RED: number; BLACK: number }
  chatMessages: ChatMessage[]
  windState: WindState
  setMeId: (id: string) => void
  applyServerState: (payload: { code: string; hostId: string; players: Player[]; started?: boolean; timers?: Record<string, number>; turnSeat?: number | null; turnEndsAt?: number | null; scores?: Record<string, number>; teamScores?: { RED: number; BLACK: number }; chatLog?: ChatMessage[]; windState?: WindState }) => void
  setWindState: (state: WindState) => void
  addChatMessage: (msg: ChatMessage) => void
  setHostRoom: (code: string, meName: string) => void
  joinRoom: (code: string, meName: string) => void
  setSeat: (playerId: string, seat: number) => void
  setReady: (ready: boolean) => void
  setStarted: (started: boolean) => void
  setMyHand: (hand: Card[]) => void
  setLastPlayed: (cards: Card[]) => void
  setTurn: (seat: number, endsAt: number) => void
  clearRoom: () => void
}

export const useRoom = create<RoomState>((set, get) => ({
  roomCode: null,
  isHost: false,
  hostId: '',
  started: false,
  players: [],
  meId: crypto.randomUUID(),
  timers: {},
  myHand: [],
  lastPlayed: [],
  turnSeat: null,
  turnEndsAt: null,
  scores: {},
  teamScores: { RED: 0, BLACK: 0 },
  chatMessages: [],
  windState: null,
  setMeId: (id) => set({ meId: id }),
  applyServerState: ({ code, hostId, players, started, timers, turnSeat, turnEndsAt, scores, teamScores, chatLog, windState }) => set((s) => ({
    roomCode: code,
    players,
    hostId,
    isHost: s.meId === hostId,
    started: !!started,
    timers: timers ?? s.timers,
    turnSeat: typeof turnSeat === 'number' ? turnSeat : s.turnSeat,
    turnEndsAt: typeof turnEndsAt === 'number' ? turnEndsAt : s.turnEndsAt,
    scores: scores ?? s.scores,
    teamScores: teamScores ?? s.teamScores,
    chatMessages: Array.isArray(chatLog) ? chatLog : s.chatMessages,
    windState: typeof windState === 'undefined' ? s.windState : windState,
  })),
  setWindState: (state) => set({ windState: state }),
  addChatMessage: (msg) => set((s) => ({ chatMessages: [...s.chatMessages, msg].slice(-80) })),
  setHostRoom: (code, meName) => {
    emitCreateRoom(code, meName)
  },
  joinRoom: (code, meName) => {
    emitJoinRoom(code, meName)
  },
  setSeat: (playerId, seat) => {
    const code = get().roomCode
    if (!code || get().started) return
    if (playerId !== get().meId) return
    emitTakeSeat(code, seat)
  },
  setReady: (ready) => {
    const code = get().roomCode
    if (!code || get().started) return
    emitSetReady(code, !!ready)
  },
  setStarted: (started) => set({ started }),
  setMyHand: (hand) => set({ myHand: hand }),
  setLastPlayed: (cards) => set({ lastPlayed: cards }),
  setTurn: (seat, endsAt) => set({ turnSeat: seat, turnEndsAt: endsAt }),
  clearRoom: () => set({ roomCode: null, isHost: false, hostId: '', players: [], started: false, timers: {}, myHand: [], lastPlayed: [], turnSeat: null, turnEndsAt: null, scores: {}, teamScores: { RED: 0, BLACK: 0 }, chatMessages: [], windState: null })
}))
