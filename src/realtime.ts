import { io, Socket } from 'socket.io-client'
import { useRoom } from './store/room'

let socket: Socket | null = null
let initialized = false

export function getSocket(){
  if (!socket) socket = io('http://localhost:3002', { autoConnect: true })
  return socket!
}

export function initRealtime(){
  if (initialized) return
  const s = getSocket()
  const applyState = useRoom.getState().applyServerState
  const setMeId = useRoom.getState().setMeId
  const setMyHand = useRoom.getState().setMyHand
  const setTurn = useRoom.getState().setTurn
  const setLastPlayed = useRoom.getState().setLastPlayed
  const addChatMessage = useRoom.getState().addChatMessage
  const setWindState = useRoom.getState().setWindState

  s.on('connect', () => {
    if (typeof s.id === 'string') setMeId(s.id)
  })

  s.on('room_state', (payload) => {
    applyState(payload)
  })

  s.on('turn_update', ({ turnSeat, turnEndsAt, serverNow }) => {
    if (typeof turnSeat === 'number' && typeof turnEndsAt === 'number') {
      const offset = typeof serverNow === 'number' ? (Date.now() - serverNow) : 0
      const correctedEndsAt = turnEndsAt + offset
      setTurn(turnSeat, correctedEndsAt)
    }
  })

  s.on('error_message', (msg) => {
    alert(msg)
  })

  s.on('game_start', ({ code }) => {
    useRoom.getState().setStarted(true)
    setLastPlayed([])
  })

  s.on('your_hand', ({ hand }) => {
    setMyHand(hand)
  })

  s.on('play_made', ({ playerId, cards }) => {
    if (Array.isArray(cards)) setLastPlayed(cards)
  })
  s.on('chat_message', (msg) => {
    if (msg && typeof msg.text === 'string') addChatMessage(msg)
  })
  s.on('wind_state', (payload) => {
    setWindState(payload)
  })
  s.on('voice_chunk', ({ from, chunk, mimeType }) => {
    voiceChunkListeners.forEach((fn) => fn({ from, chunk, mimeType }))
  })
  s.on('voice_status', (payload) => {
    voiceStatusListeners.forEach((fn) => fn(payload))
  })
  // 游戏被终止：清空本地房间状态并回到首页
  s.on('game_ended', ({ code }) => {
    useRoom.getState().clearRoom()
    try {
      window.location.href = '/'
    } catch {}
  })
  initialized = true
}

export function createRoom(code: string, name: string){
  getSocket().emit('create_room', { code, name })
}

export function joinRoom(code: string, name: string){
  getSocket().emit('join_room', { code, name })
}

export function takeSeat(code: string, seat: number){
  getSocket().emit('take_seat', { code, seat })
}

export function setReady(code: string, ready: boolean){
  getSocket().emit('set_ready', { code, ready })
}

export function startGame(code: string){
  getSocket().emit('start_game', { code })
}
export function restartGame(code: string){
  getSocket().emit('restart_game', { code })
}
export function endGame(code: string){
  getSocket().emit('end_game', { code })
}
export function resetScores(code: string){
  getSocket().emit('reset_scores', { code })
}
export function playAction(code: string, action: 'pass'|'hint'|'play', cards?: { suit: string; rank: string }[]){
  getSocket().emit('play_action', { code, action, cards })
}
export function sendChat(code: string, text: string){
  getSocket().emit('chat_message', { code, text })
}
export function sendVoiceChunk(code: string, chunk: ArrayBuffer, mimeType?: string){
  getSocket().emit('voice_chunk', { code, chunk, mimeType })
}
export function sendVoiceStatus(code: string, speaking: boolean){
  getSocket().emit('voice_status', { code, speaking })
}
export function sendWindChoice(code: string, choice: 'give'|'stop', cards?: { suit: string; rank: string }[]){
  getSocket().emit('wind_choice', { code, choice, cards })
}

const voiceChunkListeners = new Set<(payload: { from: string; chunk: ArrayBuffer; mimeType?: string }) => void>()
const voiceStatusListeners = new Set<(payload: { id: string; speaking: boolean }) => void>()

export function subscribeVoiceChunk(listener: (payload: { from: string; chunk: ArrayBuffer; mimeType?: string }) => void){
  voiceChunkListeners.add(listener)
  return () => voiceChunkListeners.delete(listener)
}

export function subscribeVoiceStatus(listener: (payload: { id: string; speaking: boolean }) => void){
  voiceStatusListeners.add(listener)
  return () => voiceStatusListeners.delete(listener)
}
