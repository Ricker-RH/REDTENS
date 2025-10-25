import { Server } from 'socket.io'

const PORT = process.env.PORT ? Number(process.env.PORT) : 3002
const io = new Server(PORT, { cors: { origin: '*', methods: ['GET','POST'] } })

/** @typedef {{ suit: string; rank: string }} Card */
// 房间结构：不在广播中泄露红十身份与玩家手牌
/** @typedef {{ id: string; name: string; text: string; ts: number }} ChatMessage */
/**
 * @typedef {Object} WindState
 * @property {string} finisherId
 * @property {number} finisherSeat
 * @property {*} basePattern
 * @property {Card[]} baseCards
 * @property {number|null} skipSeat
 * @property {number[]} queueSeats
 * @property {number} currentIndex
 */
const rooms = new Map() // code -> { code, hostId, players: [{id,name,seat}], started, hands: Map<id, Card[]>, timers: Record<string, number>, turnSeat: number, turnEndsAt: number, rotationTimer: NodeJS.Timeout | null, lastPlayed: Card[], lastPattern: any, lastPlayerId: string|null, passesSinceLast: number, finishedIds: Set<string>, redTeam: Set<string>, firstOutTeam: 'RED'|'BLACK'|null, mustLeadId: string|null, nextStartSeat: number|null, firstFinisherId: string|null, chatLog: ChatMessage[], windState: WindState | null }

const RANKS = ['A','K','Q','J','10','9','8','7','6','5','4','3','2']
const SUITS = ['H','D','S','C'] // H红桃 D方块 S黑桃 C梅花

function oneDeck(){
  const deck = []
  for (const s of SUITS) for (const r of RANKS) deck.push({ suit: s, rank: r })
  // 无大小王：标准52张
  return deck
}

// 红十/黑十与比较顺序
function isRedTen(c){ return c.rank === '10' && (c.suit === 'H' || c.suit === 'D') }
function isBlackTen(c){ return c.rank === '10' && (c.suit === 'S' || c.suit === 'C') }
const ORDER_SINGLE = ['3','4','5','6','7','8','9','10','J','Q','K','A','2','RED10']
const ORDER_PAIR = ['3','4','5','6','7','8','9','10','J','Q','K','A','2']
const ORDER_STRAIGHT = ['3','4','5','6','7','8','9','10','J','Q','K','A']
const ORDER_BOMB = ['3','4','5','6','7','8','9','10','J','Q','K','A','2']
function idxOf(order, key){ return order.indexOf(key) }
function singleKey(c){ return isRedTen(c) ? 'RED10' : c.rank }
function compareSingle(aKey, bKey){ return idxOf(ORDER_SINGLE, aKey) - idxOf(ORDER_SINGLE, bKey) }
function normalizeRankForCombo(c){ return (isRedTen(c) || isBlackTen(c)) ? '10' : c.rank }
function findSmallestSingle(hand){
  if (!Array.isArray(hand) || hand.length === 0) return null
  const suitOrder = ['C','S','D','H']
  const sorted = hand.slice().sort((a, b) => {
    const diff = compareSingle(singleKey(a), singleKey(b))
    if (diff !== 0) return diff
    return suitOrder.indexOf(a.suit) - suitOrder.indexOf(b.suit)
  })
  return sorted[0] ?? null
}

function classifyPlay(cards){
  const n = Array.isArray(cards) ? cards.length : 0
  if (n <= 0) return null
  if (n === 1){
    return { type: 'SINGLE', length: 1, rankKey: singleKey(cards[0]) }
  }
  if (n === 2){
    const r1 = normalizeRankForCombo(cards[0])
    const r2 = normalizeRankForCombo(cards[1])
    if (r1 !== r2) return null
    // 两红十为最大炸弹
    if (isRedTen(cards[0]) && isRedTen(cards[1])) return { type: 'RT_BOMB2', length: 2, rankKey: 'RED10x2' }
    return { type: 'PAIR', length: 2, rankKey: r1 }
  }
  // 3+ ：优先判断炸弹（同点数）
  const ranks = cards.map(normalizeRankForCombo)
  const allSame = ranks.every(r => r === ranks[0])
  if (allSame){
    return { type: 'BOMB', length: n, rankKey: ranks[0] }
  }
  // 顺子：3~A，不能包含 2，且点数必须连续且不重复
  const hasTwo = ranks.includes('2')
  if (hasTwo) return null
  const uniq = Array.from(new Set(ranks))
  if (uniq.length !== n) return null
  const idxs = uniq.map(r => idxOf(ORDER_STRAIGHT, r)).sort((a,b)=>a-b)
  if (idxs.includes(-1)) return null
  for (let i = 1; i < idxs.length; i++) if (idxs[i] !== idxs[i-1] + 1) return null
  const topKey = ORDER_STRAIGHT[idxs[idxs.length - 1]]
  return { type: 'STRAIGHT', length: n, rankKey: topKey }
}

function canBeat(prev, curr){
  if (!prev) return true
  // 两红十炸弹不可被任何牌管住
  if (prev.type === 'RT_BOMB2') return false
  if (curr.type === 'RT_BOMB2') return true
  if (prev.type === 'BOMB'){
    if (curr.type !== 'BOMB') return false
    if (curr.length !== prev.length) return curr.length > prev.length
    return idxOf(ORDER_BOMB, curr.rankKey) > idxOf(ORDER_BOMB, prev.rankKey)
  }
  // 非炸弹：要求同类型且长度一致
  if (curr.type === 'BOMB') return true
  if (prev.type !== curr.type) return false
  if (prev.length !== curr.length) return false
  if (prev.type === 'SINGLE'){
    return idxOf(ORDER_SINGLE, curr.rankKey) > idxOf(ORDER_SINGLE, prev.rankKey)
  }
  if (prev.type === 'PAIR'){
    return idxOf(ORDER_PAIR, curr.rankKey) > idxOf(ORDER_PAIR, prev.rankKey)
  }
  if (prev.type === 'STRAIGHT'){
    return idxOf(ORDER_STRAIGHT, curr.rankKey) > idxOf(ORDER_STRAIGHT, prev.rankKey)
  }
  return false
}

function buildDeck(){
  const deck = [...oneDeck(), ...oneDeck()]
  // 无大小王，移除一张红色的十（红桃10或方块10随机一张）
  const redTenIdxs = deck
    .map((c, i) => ((c.rank === '10' && (c.suit === 'H' || c.suit === 'D')) ? i : -1))
    .filter(i => i !== -1)
  const removeIdx = redTenIdxs[Math.floor(Math.random() * redTenIdxs.length)]
  deck.splice(removeIdx, 1)
  return deck // 两副去一红十，合计 103 张
}

function shuffle(arr){
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

function dealToSeats(room){
  const deck = shuffle(buildDeck())
  const seated = room.players.filter(p => typeof p.seat === 'number')
  const hands = new Map()
  if (seated.length === 0) return hands
  const base = Math.floor(deck.length / seated.length)
  const extras = deck.length % seated.length
  const randomized = seated.slice().sort(() => Math.random() - 0.5)
  randomized.forEach((p, idx) => {
    const take = base + (idx < extras ? 1 : 0)
    const hand = deck.splice(0, take)
    hands.set(p.id, hand)
  })
  return hands
}

function getTeamIds(room){
  const redIds = room.redTeam ? Array.from(room.redTeam) : []
  const blackIds = room.players
    .filter(p => !room.redTeam || !room.redTeam.has(p.id))
    .map(p => p.id)
  return { redIds, blackIds }
}

function registerPlayerFinish(room, playerId){
  if (!room.finishedIds) room.finishedIds = new Set()
  room.finishedIds.add(playerId)
  const player = room.players.find(p => p.id === playerId)
  if (!room.firstOutTeam){
    room.firstOutTeam = room.redTeam && room.redTeam.has(playerId) ? 'RED' : 'BLACK'
    room.firstFinisherId = playerId
    if (player && typeof player.seat === 'number') room.nextStartSeat = player.seat
  }

  const { redIds, blackIds } = getTeamIds(room)
  const redAllDone = redIds.length === 0 || redIds.every(id => room.finishedIds.has(id))
  const blackAllDone = blackIds.length === 0 || blackIds.every(id => room.finishedIds.has(id))

  if (redAllDone && !blackAllDone){
    const remaining = blackIds.filter(id => !room.finishedIds.has(id))
    if (room.firstOutTeam === 'RED'){
      return { result: 'RED', message: '红十队伍全部打完，红十队伍获胜！', remainingOpponents: remaining.length }
    }
    return { result: 'DRAW', message: '红十队伍全部打完但非红十仍未完成，本局平局', remainingOpponents: remaining.length }
  }
  if (blackAllDone && !redAllDone){
    const remaining = redIds.filter(id => !room.finishedIds.has(id))
    if (room.firstOutTeam === 'BLACK'){
      return { result: 'BLACK', message: '非红十队伍全部打完，非红十队伍获胜！', remainingOpponents: remaining.length }
    }
    return { result: 'DRAW', message: '非红十队伍全部打完但红十仍未完成，本局平局', remainingOpponents: remaining.length }
  }
  if (redAllDone && blackAllDone){
    return { result: 'DRAW', message: '双方全部出完，本局平局', remainingOpponents: 0 }
  }
  return null
}

function concludeRound(room, outcome){
  const { result, remainingOpponents } = outcome
  if (result === 'RED' || result === 'BLACK'){
    awardRound(room, result, remainingOpponents)
  }
  room.started = false
  if (room.rotationTimer) clearTimeout(room.rotationTimer)
  room.rotationTimer = null
  room.turnSeat = null
  room.turnEndsAt = null
  room.lastPattern = null
  room.lastPlayerId = null
  room.passesSinceLast = 0
  room.lastPlayed = []
  room.mustLeadId = null
  broadcastTurn(room)
  emitState(room.code)
  room.firstOutTeam = null
  room.finishedIds = new Set()
  room.firstFinisherId = null
  room.windState = null
  broadcastWind(room)
}

function beginRound(room, { skipReadyRequirement = false } = {}){
  const seatedPlayers = room.players.filter(p => p.seat !== null)
  if (seatedPlayers.length !== 7) return '人数未满 7 人，暂不可开始'
  if (!skipReadyRequirement){
    const readyCount = room.players.filter(p => p.seat !== null && p.id !== room.hostId && !!p.ready).length
    if (readyCount !== 6) return '还有玩家未准备，暂不可开始'
  }

  room.started = true
  for (const p of room.players) p.ready = false
  room.hands = dealToSeats(room)
  room.lastPlayed = []
  room.lastPattern = null
  room.lastPlayerId = null
  room.passesSinceLast = 0
  room.finishedIds = new Set()
  room.redTeam = new Set()
  room.firstOutTeam = null
  room.firstFinisherId = null
  room.mustLeadId = null
  room.windState = null
  broadcastWind(room)

  for (const p of room.players){
    const hand = room.hands.get(p.id) || []
    const rtCount = hand.filter(isRedTen).length
    if (rtCount > 0) room.redTeam.add(p.id)
    if (rtCount === 3){
      const seat = typeof p.seat === 'number' ? p.seat : null
      room.firstOutTeam = 'RED'
      room.firstFinisherId = p.id
      if (seat != null) room.nextStartSeat = seat
      io.to(room.code).emit('play_made', { playerId: p.id, cards: hand.filter(isRedTen) })
      const { blackIds } = getTeamIds(room)
      const outcome = { result: 'RED', message: '有人持有三张红十，直接获胜！', remainingOpponents: blackIds.length }
      io.to(room.code).emit('error_message', outcome.message)
      concludeRound(room, outcome)
      return null
    }
  }

  room.timers = {}
  for (const p of room.players) {
    room.timers[p.id] = 12 + Math.floor(Math.random() * 9)
  }

  if (room.rotationTimer) clearTimeout(room.rotationTimer)
  const seated = room.players.filter(p => typeof p.seat === 'number')
  let startSeat = typeof room.nextStartSeat === 'number' ? room.nextStartSeat : null
  if (startSeat == null || !seated.some(p => p.seat === startSeat)){
    if (seated.length > 0){
      const randomIdx = Math.floor(Math.random() * seated.length)
      startSeat = seated[randomIdx].seat ?? 0
    } else {
      startSeat = 0
    }
  }
  room.nextStartSeat = null
  const leadPlayer = room.players.find(p => p.seat === startSeat)
  room.mustLeadId = leadPlayer ? leadPlayer.id : null
  setTurn(room, startSeat ?? 0)

  io.to(room.code).emit('game_start', { code: room.code })
  emitState(room.code)

  for (const p of room.players) {
    const hand = room.hands.get(p.id) || []
    io.to(p.id).emit('your_hand', { code: room.code, hand })
  }

  return null
}

function emitState(code){
  const room = rooms.get(code)
  if (!room) return
const publicPlayers = room.players.map(p => ({ id: p.id, name: p.name, seat: p.seat, ready: !!p.ready }))
  io.to(code).emit('room_state', {
    code: room.code,
    hostId: room.hostId,
    started: room.started || false,
    players: publicPlayers,
    timers: room.timers || {},
    turnSeat: room.turnSeat ?? null,
    turnEndsAt: room.turnEndsAt ?? null,
    scores: Object.fromEntries(room.scores || new Map()),
    teamScores: room.teamScores || { RED: 0, BLACK: 0 },
    chatLog: room.chatLog ? room.chatLog.slice(-80) : [],
    windState: sanitizeWind(room),
  })
}

function sanitizeWind(room){
  const wind = room.windState
  if (!wind) return null
  const currentSeat = wind.queueSeats[wind.currentIndex] ?? null
  return {
    finisherId: wind.finisherId,
    skipSeat: wind.skipSeat,
    currentSeat,
    queueSeats: wind.queueSeats,
    baseCards: wind.baseCards,
  }
}

function broadcastWind(room){
  io.to(room.code).emit('wind_state', sanitizeWind(room))
}

function activePlayersWithCards(room, excludeId){
  return room.players.filter(p => (
    typeof p.seat === 'number' &&
    p.id !== excludeId &&
    !(room.finishedIds && room.finishedIds.has(p.id)) &&
    ((room.hands.get(p.id) || []).length > 0)
  ))
}

function buildWindFlow(room, finisher){
  if (typeof finisher.seat !== 'number') return null
  const active = activePlayersWithCards(room, finisher.id)
  if (active.length === 0) return null
  const seatToPlayer = new Map(active.map(p => [p.seat, p]))
  const orderedSeats = []
  for (let step = 1; step <= 7; step++){
    const seat = (finisher.seat + step) % 7
    if (seatToPlayer.has(seat)) orderedSeats.push(seat)
  }
  if (orderedSeats.length === 0) return null
  const skipSeat = orderedSeats.shift()
  return { skipSeat: typeof skipSeat === 'number' ? skipSeat : null, queueSeats: orderedSeats }
}

function finishWindAllGive(room){
  const wind = room.windState
  if (!wind) return
  const skipSeat = wind.skipSeat
  room.windState = null
  room.lastPattern = null
  room.lastPlayerId = null
  room.passesSinceLast = 0
  room.lastPlayed = []
  if (typeof skipSeat === 'number'){
    const leader = room.players.find(p => p.seat === skipSeat)
    room.mustLeadId = leader ? leader.id : null
    setTurn(room, skipSeat)
  } else {
    room.mustLeadId = null
  }
  broadcastWind(room)
}

function advanceWindGive(room){
  const wind = room.windState
  if (!wind) return
  wind.currentIndex += 1
  if (wind.currentIndex >= wind.queueSeats.length){
    finishWindAllGive(room)
    return
  }
  setTurn(room, wind.queueSeats[wind.currentIndex])
  broadcastWind(room)
}

function startWindSequence(room, finisherId){
  if (room.windState) return true
  if (!room.lastPattern || !Array.isArray(room.lastPlayed) || room.lastPlayed.length === 0) return false
  const finisher = room.players.find(p => p.id === finisherId)
  if (!finisher || typeof finisher.seat !== 'number') return false
  const flow = buildWindFlow(room, finisher)
  if (!flow || flow.skipSeat == null) return false
  room.passesSinceLast = 0
  room.mustLeadId = null
  room.windState = {
    finisherId,
    finisherSeat: finisher.seat,
    basePattern: room.lastPattern,
    baseCards: room.lastPlayed.slice(),
    skipSeat: flow.skipSeat,
    queueSeats: flow.queueSeats,
    currentIndex: 0,
  }
  if (room.windState.queueSeats.length === 0){
    finishWindAllGive(room)
  } else {
    setTurn(room, room.windState.queueSeats[0])
    broadcastWind(room)
  }
  return true
}

function maybeStartWind(room, finisherId){
  if (!room.started) return false
  return startWindSequence(room, finisherId)
}

const TURN_MS = 20000
function broadcastTurn(room){
  io.to(room.code).emit('turn_update', {
    turnSeat: room.turnSeat,
    turnEndsAt: room.turnEndsAt,
    serverNow: Date.now(),
    turnDuration: TURN_MS
  })
}
function nextSeat(room, fromSeat){
  // 找到下一个未出完的玩家座位
  for (let i = 1; i <= 7; i++){
    const seat = (fromSeat + i) % 7
    const p = room.players.find(pp => pp.seat === seat)
    if (!p) continue
    if (room.finishedIds && room.finishedIds.has(p.id)) continue
    return seat
  }
  return fromSeat
}
function handleAutoLead(room, player){
  if (room.windState) return
  const hand = room.hands.get(player.id) || []
  const pick = findSmallestSingle(hand)
  if (!pick){
    advanceTurn(room)
    return
  }
  const toPlay = [pick]
  const pattern = classifyPlay(toPlay)
  if (!pattern){
    advanceTurn(room)
    return
  }
  const idx = hand.findIndex(h => h.suit === pick.suit && h.rank === pick.rank)
  if (idx !== -1) hand.splice(idx, 1)
  room.hands.set(player.id, hand)
  room.lastPlayed = toPlay
  room.lastPattern = pattern
  room.lastPlayerId = player.id
  room.passesSinceLast = 0
  room.mustLeadId = null
  io.to(room.code).emit('play_made', { playerId: player.id, cards: toPlay })
  io.to(player.id).emit('your_hand', { code: room.code, hand })

  if (hand.length === 0){
    const outcome = registerPlayerFinish(room, player.id)
    if (outcome){
      io.to(room.code).emit('error_message', outcome.message)
      concludeRound(room, outcome)
      return
    }
    if (maybeStartWind(room, player.id)) return
  }

  if (room.started) advanceTurn(room)
}
function scheduleTurnTimer(room){
  if (room.rotationTimer) clearTimeout(room.rotationTimer)
  room.rotationTimer = setTimeout(() => {
    if (!room.started) return
    if (room.windState){
      const windSeat = room.windState.queueSeats[room.windState.currentIndex] ?? null
      if (typeof windSeat === 'number' && windSeat === room.turnSeat){
        advanceWindGive(room)
        return
      }
    }
    const currentPlayer = room.players.find(p => p.seat === room.turnSeat)
    if (currentPlayer && room.mustLeadId === currentPlayer.id){
      handleAutoLead(room, currentPlayer)
      return
    }
    advanceTurn(room)
  }, TURN_MS)
}
function setTurn(room, seat){
  room.turnSeat = seat
  room.turnEndsAt = Date.now() + TURN_MS
  broadcastTurn(room)
  scheduleTurnTimer(room)
}
function advanceTurn(room){
  if (room.windState) return
  const current = typeof room.turnSeat === 'number' ? room.turnSeat : 0
  const next = nextSeat(room, current)
  const lastPlayer = room.lastPlayerId ? room.players.find(p => p.id === room.lastPlayerId) : null
  if (lastPlayer && typeof lastPlayer.seat === 'number' && lastPlayer.seat === next && room.lastPattern){
    room.lastPattern = null
    room.lastPlayerId = null
    room.passesSinceLast = 0
    room.lastPlayed = []
    room.mustLeadId = lastPlayer.id
  }
  setTurn(room, next)
}

function awardRound(room, result, remainingOpponents = 0){
  if (!room.scores) room.scores = new Map()
  if (!room.teamScores) room.teamScores = { RED: 0, BLACK: 0 }
  if (result === 'DRAW') return
  const { redIds, blackIds } = getTeamIds(room)
  const winningIds = result === 'RED' ? redIds : blackIds
  const losingIds = result === 'RED' ? blackIds : redIds
  if (winningIds.length === 0 || losingIds.length === 0) return
  const lossPerPlayer = remainingOpponents > 0 ? remainingOpponents : 0
  if (lossPerPlayer === 0) return
  for (const id of losingIds){
    room.scores.set(id, (room.scores.get(id) || 0) - lossPerPlayer)
  }
  const totalPenalty = lossPerPlayer * losingIds.length
  const gainPerWinner = totalPenalty / winningIds.length
  for (const id of winningIds){
    room.scores.set(id, (room.scores.get(id) || 0) + gainPerWinner)
  }
  room.teamScores[result] = (room.teamScores[result] || 0) + totalPenalty
}

io.on('connection', (socket) => {
  socket.on('create_room', ({ code, name }) => {
    if (!code) return
    if (rooms.has(code)) return socket.emit('error_message', '房间已存在')
    const room = { code, hostId: socket.id, players: [], started: false, hands: new Map(), timers: {}, turnSeat: 0, turnEndsAt: 0, rotationTimer: null, lastPlayed: [], lastPattern: null, lastPlayerId: null, passesSinceLast: 0, finishedIds: new Set(), redTeam: new Set(), firstOutTeam: null, scores: new Map(), teamScores: { RED: 0, BLACK: 0 }, mustLeadId: null, nextStartSeat: null, firstFinisherId: null, chatLog: [], windState: null }
    rooms.set(code, room)
    const player = { id: socket.id, name, seat: 0, ready: false }
    room.players.push(player)
    room.scores.set(player.id, 0)
    socket.join(code)
    emitState(code)
  })

  socket.on('join_room', ({ code, name }) => {
    const room = rooms.get(code)
    if (!room) return socket.emit('error_message', '房间不存在')
    const exists = room.players.find(p => p.id === socket.id)
    if (!exists) {
      room.players.push({ id: socket.id, name, seat: null, ready: false })
      room.scores.set(socket.id, room.scores.get(socket.id) ?? 0)
    }
    socket.join(code)
    emitState(code)
  })

  socket.on('take_seat', ({ code, seat }) => {
    const room = rooms.get(code)
    if (!room || room.started) return
    if (room.players.find(p => p.seat === seat)) return // already taken
    const me = room.players.find(p => p.id === socket.id)
    if (!me) return
    me.seat = seat
    me.ready = false
    emitState(code)
  })

  socket.on('set_ready', ({ code, ready }) => {
    const room = rooms.get(code)
    if (!room || room.started) return
    const me = room.players.find(p => p.id === socket.id)
    if (!me) return
    if (me.id === room.hostId) return socket.emit('error_message', '房主无需准备')
    if (me.seat == null) return socket.emit('error_message', '未入座，不能准备')
    me.ready = !!ready
    emitState(code)
  })

  socket.on('start_game', ({ code }) => {
    const room = rooms.get(code)
    if (!room) return
    if (room.hostId !== socket.id) return socket.emit('error_message', '仅房主可开始')
    if (room.started) return socket.emit('error_message', '游戏已经在进行中')
    const err = beginRound(room)
    if (err) return socket.emit('error_message', err)
  })

  socket.on('restart_game', ({ code }) => {
    const room = rooms.get(code)
    if (!room) return
    if (room.hostId !== socket.id) return socket.emit('error_message', '仅房主可重新开始')
    if (room.started) return socket.emit('error_message', '当前局尚未结束，无法重新开始')
    const err = beginRound(room, { skipReadyRequirement: true })
    if (err) return socket.emit('error_message', err)
  })

  socket.on('reset_scores', ({ code }) => {
    const room = rooms.get(code)
    if (!room) return
    if (room.hostId !== socket.id) return socket.emit('error_message', '仅房主可清空积分')
    if (room.started) return socket.emit('error_message', '请在本局结束后再清空积分')
    room.scores = new Map()
    for (const p of room.players) {
      room.scores.set(p.id, 0)
    }
    room.teamScores = { RED: 0, BLACK: 0 }
    emitState(code)
    socket.emit('error_message', '积分已清空')
  })

  socket.on('chat_message', ({ code, text }) => {
    const room = rooms.get(code)
    if (!room) return
    const raw = typeof text === 'string' ? text.trim() : ''
    if (!raw) return
    const player = room.players.find(p => p.id === socket.id)
    const name = player?.name || '玩家'
    const entry = { id: socket.id, name, text: raw.slice(0, 200), ts: Date.now() }
    room.chatLog = room.chatLog || []
    room.chatLog.push(entry)
    if (room.chatLog.length > 80) room.chatLog = room.chatLog.slice(-80)
    io.to(code).emit('chat_message', entry)
  })

  socket.on('voice_chunk', ({ code, chunk, mimeType }) => {
    const room = rooms.get(code)
    if (!room) return
    if (!chunk) return
    io.to(code).emit('voice_chunk', { from: socket.id, chunk, mimeType })
  })

  socket.on('voice_status', ({ code, speaking }) => {
    const room = rooms.get(code)
    if (!room) return
    io.to(code).emit('voice_status', { id: socket.id, speaking: !!speaking })
  })

  socket.on('wind_choice', ({ code, choice, cards }) => {
    const room = rooms.get(code)
    if (!room || !room.windState || !room.started) return
    const wind = room.windState
    const currentSeat = wind.queueSeats[wind.currentIndex] ?? null
    const player = room.players.find(p => p.id === socket.id)
    if (!player || typeof player.seat !== 'number') return
    if (player.seat !== currentSeat) return socket.emit('error_message', '当前未轮到你决定是否给风')
    if (choice === 'give'){
      advanceWindGive(room)
      return
    }
    if (choice === 'stop'){
      const hand = room.hands.get(socket.id) || []
      const toPlay = Array.isArray(cards) ? cards : []
      if (toPlay.length === 0) return socket.emit('error_message', '请选择要出的牌')
      const hasAll = toPlay.every(c => hand.find(h => h.suit === c.suit && h.rank === c.rank))
      if (!hasAll) return socket.emit('error_message', '出牌不在你的手牌中')
      const pattern = classifyPlay(toPlay)
      if (!pattern) return socket.emit('error_message', '牌型不合法')
      if (!canBeat(wind.basePattern, pattern)) return socket.emit('error_message', '牌未能压过上家')
      for (const c of toPlay){
        const idx = hand.findIndex(h => h.suit === c.suit && h.rank === c.rank)
        if (idx !== -1) hand.splice(idx, 1)
      }
      room.hands.set(socket.id, hand)
      room.lastPlayed = toPlay
      room.lastPattern = pattern
      room.lastPlayerId = socket.id
      room.passesSinceLast = 0
      room.mustLeadId = null
      room.windState = null
      broadcastWind(room)
      io.to(code).emit('play_made', { playerId: socket.id, cards: toPlay })
      io.to(socket.id).emit('your_hand', { code, hand })

      if (hand.length === 0){
        const outcome = registerPlayerFinish(room, socket.id)
        if (outcome){
          io.to(code).emit('error_message', outcome.message)
          concludeRound(room, outcome)
          return
        }
        if (maybeStartWind(room, socket.id)) return
      }

      if (room.started) advanceTurn(room)
      return
    }
  })

  socket.on('play_action', ({ code, action, cards }) => {
    const room = rooms.get(code)
    if (!room || !room.started) return
    if (room.windState){
      socket.emit('error_message', '当前处于给风阶段，暂不可出牌')
      return
    }
    const currentSeat = room.turnSeat ?? 0
    const currentPlayer = room.players.find(p => p.seat === currentSeat)
    if (!currentPlayer || currentPlayer.id !== socket.id) return // 非当前玩家
    
    if (action === 'pass') {
      if (room.mustLeadId === socket.id){
        socket.emit('error_message', '新一轮需先出牌，不能跳过')
        return
      }
      if (!room.lastPattern){
        socket.emit('error_message', '当前需首家出牌，不能跳过')
        return
      }
      room.passesSinceLast = (room.passesSinceLast || 0) + 1
      io.to(code).emit('action_played', { playerId: socket.id, action })
      advanceTurn(room)
      const lastSeat = room.players.find(p => p.id === room.lastPlayerId)?.seat
      const activePlayers = room.players.filter(p => {
        if (!p) return false
        if (room.finishedIds && room.finishedIds.has(p.id)) return false
        const hand = room.hands.get(p.id) || []
        return hand.length > 0
      })
      const leadStillActive = room.lastPlayerId ? activePlayers.some(p => p.id === room.lastPlayerId) : false
      let passesNeeded = leadStillActive ? Math.max(activePlayers.length - 1, 0) : activePlayers.length
      if (passesNeeded <= 0) passesNeeded = activePlayers.length
      if (room.passesSinceLast >= passesNeeded) {
        room.lastPattern = null
        room.lastPlayerId = null
        room.passesSinceLast = 0
        room.lastPlayed = []
        let newLeadSeat
        if (leadStillActive && typeof lastSeat === 'number'){
          newLeadSeat = lastSeat
        } else {
          const baseSeat = typeof lastSeat === 'number' ? lastSeat : (room.turnSeat ?? 0)
          newLeadSeat = nextSeat(room, baseSeat)
        }
        const leadAgain = room.players.find(p => p.seat === newLeadSeat && (!room.finishedIds || !room.finishedIds.has(p.id)))
        room.mustLeadId = leadAgain ? leadAgain.id : null
        setTurn(room, newLeadSeat)
      }
      return
    }

    if (action === 'play') {
      const hand = room.hands.get(socket.id) || []
      const toPlay = Array.isArray(cards) ? cards : []
      if (room.mustLeadId === socket.id) room.mustLeadId = null
      // 简单校验：所出卡必须都在手牌中
      const hasAll = toPlay.every(c => hand.find(h => h.suit === c.suit && h.rank === c.rank))
      if (!hasAll) {
        socket.emit('error_message', '非法出牌：不在你的手牌中')
        return
      }
      const pattern = classifyPlay(toPlay)
      if (!pattern){
        socket.emit('error_message', '非法牌型：仅支持 单牌/对子/顺子/炸弹')
        return
      }
      const can = canBeat(room.lastPattern, pattern)
      if (!can){
        socket.emit('error_message', '出牌未能压过上家或不符合跟牌规则')
        return
      }
      // 从手牌移除所出牌
      for (const c of toPlay) {
        const idx = hand.findIndex(h => h.suit === c.suit && h.rank === c.rank)
        if (idx !== -1) hand.splice(idx, 1)
      }
      room.hands.set(socket.id, hand)
      room.lastPlayed = toPlay
      room.lastPattern = pattern
      room.lastPlayerId = socket.id
      room.passesSinceLast = 0
      // 广播出牌
      io.to(code).emit('play_made', { playerId: socket.id, cards: toPlay })
      // 更新手牌发给该玩家
      io.to(socket.id).emit('your_hand', { code, hand })

      // 是否打完牌
      if (hand.length === 0){
        const outcome = registerPlayerFinish(room, socket.id)
        if (outcome){
          io.to(code).emit('error_message', outcome.message)
          concludeRound(room, outcome)
          return
        }
        if (maybeStartWind(room, socket.id)) return
      }

      // 进入下一位
      advanceTurn(room)
      return
    }
  })

  // 房主终止游戏：结束当前局并通知所有人返回主页
  socket.on('end_game', ({ code }) => {
    const room = rooms.get(code)
    if (!room) return
    if (room.hostId !== socket.id) return socket.emit('error_message', '仅房主可终止游戏')
  
    room.started = false
    if (room.rotationTimer) clearTimeout(room.rotationTimer)
    room.rotationTimer = null
    room.turnSeat = null
    room.turnEndsAt = null
    room.lastPlayed = []
    room.lastPattern = null
    room.lastPlayerId = null
    room.passesSinceLast = 0
    room.mustLeadId = null
    room.windState = null
    broadcastWind(room)
  
    emitState(code)
    io.to(code).emit('game_ended', { code })
  })

  socket.on('disconnect', () => {
    for (const [code, room] of rooms.entries()) {
      const idx = room.players.findIndex(p => p.id === socket.id)
      if (idx !== -1) {
        const wasHost = room.hostId === socket.id
        room.players.splice(idx, 1)
        if (room.players.length === 0) {
    if (room.rotationTimer) clearTimeout(room.rotationTimer)
          rooms.delete(code)
        } else {
          if (wasHost) room.hostId = room.players[0].id // 简单交接房主
          emitState(code)
        }
      }
    }
  })
})

console.log(`Socket server listening on http://localhost:${PORT}`)
