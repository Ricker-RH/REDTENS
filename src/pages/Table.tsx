import { useMemo, useEffect, useState, useRef } from 'react'
import { useRoom, Card } from '../store/room'
import { playAction, startGame, initRealtime, endGame, restartGame, resetScores, sendChat, sendWindChoice, subscribeVoiceChunk, subscribeVoiceStatus, sendVoiceChunk, sendVoiceStatus } from '../realtime'

function suitSymbol(s: Card['suit']){
  switch(s){
    case 'H': return '♥'
    case 'D': return '♦'
    case 'S': return '♠'
    case 'C': return '♣'
    default: return ''
  }
}

function rankOrderKey(c: Card){
  const r = c.rank.toUpperCase()
  if (r === '10' && (c.suit === 'H' || c.suit === 'D')) return 'RED10'
  return r
}
const RANK_ORDER = ['RED10','2','A','K','Q','J','10','9','8','7','6','5','4','3']
function sortHand(hand: Card[]){
  return hand.slice().sort((a,b)=>{
    const ak = rankOrderKey(a), bk = rankOrderKey(b)
    const ai = RANK_ORDER.indexOf(ak), bi = RANK_ORDER.indexOf(bk)
    if (ai !== bi) return ai - bi
    const suitOrder = ['H','D','S','C']
    return suitOrder.indexOf(a.suit) - suitOrder.indexOf(b.suit)
  })
}

export default function Table(){
  useEffect(() => { initRealtime() }, [])
  const { myHand, meId, players, roomCode, turnSeat, turnEndsAt, started, isHost, hostId, lastPlayed, scores, chatMessages, windState, teamScores } = useRoom()
  // 手牌默认顺序排序（红十、2、A、K、Q、J、10、9、8、7、6、5、4、3）
  const sortedHand = useMemo(() => sortHand(myHand), [myHand])
  const [selectedIdxs, setSelectedIdxs] = useState<number[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatCollapsed, setChatCollapsed] = useState(false)
  const chatEndRef = useRef<HTMLDivElement | null>(null)
  const [voiceActive, setVoiceActive] = useState(false)
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const speechTimeoutsRef = useRef<Map<string, number>>(new Map())
  const [speakingMap, setSpeakingMap] = useState<Record<string, boolean>>({})

  const markSpeaking = (id: string, speaking?: boolean) => {
    if (!id) return
    setSpeakingMap((prev) => ({ ...prev, [id]: speaking ?? true }))
    const timers = speechTimeoutsRef.current
    if (speaking === false){
      const timer = timers.get(id)
      if (timer) clearTimeout(timer)
      timers.delete(id)
      return
    }
    const prevTimer = timers.get(id)
    if (prevTimer) clearTimeout(prevTimer)
    const timeout = window.setTimeout(() => {
      setSpeakingMap((prev) => ({ ...prev, [id]: false }))
      timers.delete(id)
    }, 1300)
    timers.set(id, timeout)
  }

  async function startVoice(){
    if (voiceActive) return
    if (!roomCode){
      setVoiceError('请先加入房间再开启语音')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' })
      recorder.addEventListener('dataavailable', async (evt) => {
        if (evt.data && evt.data.size > 0 && roomCode){
          const buffer = await evt.data.arrayBuffer()
          sendVoiceChunk(roomCode, buffer, evt.data.type)
        }
      })
      recorder.start(400)
      mediaRecorderRef.current = recorder
      mediaStreamRef.current = stream
      setVoiceActive(true)
      setVoiceError(null)
      sendVoiceStatus(roomCode, true)
      markSpeaking(meId, true)
    } catch (err){
      setVoiceError('无法访问麦克风或权限被拒绝')
    }
  }

  function stopVoice(){
    if (mediaRecorderRef.current){
      try { mediaRecorderRef.current.stop() } catch {}
      mediaRecorderRef.current = null
    }
    if (mediaStreamRef.current){
      mediaStreamRef.current.getTracks().forEach((track) => track.stop())
      mediaStreamRef.current = null
    }
    if (voiceActive && roomCode) sendVoiceStatus(roomCode, false)
    setVoiceActive(false)
    markSpeaking(meId, false)
  }
  useEffect(() => { setSelectedIdxs([]) }, [myHand])
  useEffect(() => {
    if (!chatCollapsed) chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages, chatCollapsed])

  useEffect(() => {
    const stopTimers = () => {
      speechTimeoutsRef.current.forEach((id) => clearTimeout(id))
      speechTimeoutsRef.current.clear()
    }
    const unsubChunk = subscribeVoiceChunk(async ({ from, chunk, mimeType }) => {
      if (!chunk || from === meId) return
      try {
        const blob = new Blob([chunk], { type: mimeType || 'audio/webm;codecs=opus' })
        const url = URL.createObjectURL(blob)
        const audio = new Audio(url)
        audio.play().catch(() => {})
        setTimeout(() => URL.revokeObjectURL(url), 4000)
      } catch {}
      markSpeaking(from, true)
    })
    const unsubStatus = subscribeVoiceStatus(({ id, speaking }) => {
      markSpeaking(id, speaking)
    })
    return () => {
      unsubChunk()
      unsubStatus()
      stopVoice()
      stopTimers()
    }
  }, [meId, roomCode])
  const toggleSelect = (i: number) => {
    setSelectedIdxs(prev => prev.includes(i) ? prev.filter(j => j !== i) : [...prev, i])
  }
  const onPlay = () => {
    if (!roomCode || !isMyTurn() || selectedIdxs.length === 0) return
    const cards = selectedIdxs.map(i => sortedHand[i])
    playAction(roomCode, 'play', cards)
    setSelectedIdxs([])
  }

  // 回合倒计时（endsAt - now）
  const [turnLeft, setTurnLeft] = useState<number>(() => calcLeft(turnEndsAt))
  function calcLeft(ends?: number|null){
    if (!ends) return 0
    return Math.max(0, Math.ceil((ends - Date.now()) / 1000))
  }
  useEffect(() => { setTurnLeft(calcLeft(turnEndsAt)) }, [turnEndsAt])
  useEffect(() => {
    const id = setInterval(() => setTurnLeft((n) => calcLeft(turnEndsAt)), 1000)
    return () => clearInterval(id)
  }, [turnEndsAt])

  const isMyTurn = () => {
    if (turnSeat == null) return false
    const p = players.find(p => p.seat === turnSeat)
    return !!p && p.id === meId
  }

  const onPass = () => {
    if (!roomCode || !isMyTurn()) return
    playAction(roomCode, 'pass')
  }

  const onSendChat = () => {
    if (!roomCode) return
    const text = chatInput.trim()
    if (!text) return
    sendChat(roomCode, text)
    setChatInput('')
  }

  const onGiveWind = () => {
    if (!roomCode || !windState) return
    sendWindChoice(roomCode, 'give')
  }
  const onRejectWind = () => {
    if (!roomCode || !windState || selectedIdxs.length === 0) return
    const cards = selectedIdxs.map(i => sortedHand[i])
    sendWindChoice(roomCode, 'stop', cards)
    setSelectedIdxs([])
  }

  const canSendChat = !!chatInput.trim()

  const onStart = () => {
    if (!roomCode || !isHost || started) return
    startGame(roomCode)
  }
  const onRestart = () => {
    if (!roomCode || !isHost || started) return
    restartGame(roomCode)
  }
  const onEndGame = () => {
    if (!roomCode || !isHost || !started) return
    endGame(roomCode)
  }
  const onResetScores = () => {
    if (!roomCode || !isHost || started) return
    resetScores(roomCode)
  }
  const seatsFilled = players.filter(p => p.seat!==null).length
  const readyCount = players.filter(p => p.seat!==null && p.id!==hostId && !!p.ready).length
  const canStart = isHost && seatsFilled===7 && readyCount===6 && !started
  const canRestart = isHost && !started && seatsFilled===7
  const hasScores = Object.values(scores ?? {}).some((v) => (v ?? 0) !== 0)
  const canResetScores = isHost && !started && hasScores

  const faceColor = (s: Card['suit']) => (s === 'H' || s === 'D') ? '#c53131' : '#20232f'

  // 对手布局：以我为中心，左右各三位（总计六位）
  const seatCount = 7
  const me = players.find(p => p.id === meId)
  const mySeat = me?.seat ?? 0
  const mySeatNumber = typeof me?.seat === 'number' ? me.seat : null
  const windActive = !!windState
  const windCurrentSeat = windState?.currentSeat ?? null
  const windTargetPlayer = typeof windCurrentSeat === 'number' ? players.find(p => p.seat === windCurrentSeat) : null
  const windFinisher = windState ? players.find(p => p.id === windState.finisherId) : null
  const windSkipPlayer = typeof windState?.skipSeat === 'number' ? players.find(p => p.seat === windState.skipSeat) : null
  const iAmWindTarget = windActive && windCurrentSeat !== null && mySeatNumber === windCurrentSeat
  const canRejectWind = iAmWindTarget && selectedIdxs.length > 0
  const windBaseCards = windState?.baseCards ?? []
  const rel = [-3, -2, -1, 1, 2, 3]
  const opponentSeats = rel.map(off => (mySeat + off + seatCount) % seatCount)
  const opponents = opponentSeats.map(seat => ({
    seat,
    player: players.find(p => p.seat === seat)
  }))
  const activePlayer = players.find(p => p.seat === turnSeat)
  const hostPlayer = players.find(p => p.id === hostId)
  const seatedPlayers = players.filter(p => typeof p.seat === 'number').length

  // 弧形分布的角度与椭圆参数（桌面上方）
  const arcAngles = [-60, -36, -12, 12, 36, 60]
  const rx = 420
  const ry = 160
  const baseTop = 54 // 相对容器的百分比
  const posStyle = (angle:number) => {
    const rad = angle * Math.PI / 180
    const x = Math.sin(rad) * rx
    const y = -Math.cos(rad) * ry
    return { left: `calc(50% + ${x}px)`, top: `calc(${baseTop}% + ${y}px)` } as const
  }
  const otherCount = started ? 15 : 0 // 原型阶段，默认15

  return (
    <div className="container table-container">
      <div className="table-hud">
        <div className="hud-left">
          <span className="tag">房间 {roomCode ?? '未设置'}</span>
          {hostPlayer && <span className="tag">房主 · {hostPlayer.name}</span>}
          <span className="tag">玩家 {seatedPlayers}/7</span>
        </div>
        <div className="hud-right">
          <span className="score-pill red">红十 {teamScores?.RED ?? 0}</span>
          <span className="score-pill">非红十 {teamScores?.BLACK ?? 0}</span>
          {started && (
            <>
              <span className="tag">{isMyTurn() ? '该你出牌' : activePlayer ? `轮到 ${activePlayer.name}` : '等待出牌'}</span>
              <span className="timer-badge">倒计时 {String(turnLeft).padStart(2,'0')}s</span>
            </>
          )}
        </div>
      </div>
      <div className="card fp-wrap">
        <div className="fp-table" />

        {started && (
          <div className="turn-banner">
            {isMyTurn() ? (
              <span>轮到你 · {String(turnLeft).padStart(2,'0')}s</span>
            ) : (
              <span>当前出牌：{activePlayer ? activePlayer.name : '其他玩家'}</span>
            )}
          </div>
        )}

        {windState && (
          <div className="wind-banner">
            <div className="wind-message">
              <span>{windFinisher ? windFinisher.name : '有玩家'} 出完牌，</span>
              <span>当前询问：{windTargetPlayer ? windTargetPlayer.name : '等待中'}</span>
            </div>
            {windBaseCards.length > 0 && (
              <div className="wind-base">
                <span>最后出牌：</span>
                <div className="wind-base-cards">
                  {windBaseCards.map((c, idx) => (
                    <div key={idx} className="card-mini face" style={{ color: faceColor(c.suit) }}>
                      <span className="corner tl">{c.rank}</span>
                      <span className="corner tr">{suitSymbol(c.suit)}</span>
                      <span className="corner bl">{suitSymbol(c.suit)}</span>
                      <span className="corner br">{c.rank}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {iAmWindTarget ? (
              <div className="wind-actions">
                <button className="btn" onClick={onGiveWind}>给风</button>
                <button className="btn secondary" disabled={!canRejectWind} onClick={onRejectWind}>不给风</button>
              </div>
            ) : (
              <div className="wind-actions waiting">等待 {windTargetPlayer ? windTargetPlayer.name : '其他玩家'} 选择...</div>
            )}
          </div>
        )}

        {/* 中央出牌区域 */}
        <div className="play-area">
          <div className="play-title">出牌区</div>
          <div className="play-cards">
            {(lastPlayed?.length ?? 0) === 0 ? (
              <div className="play-card placeholder">等待出牌</div>
            ) : (
              lastPlayed.map((c, i) => (
                <div key={i} className="play-card face" style={{ color: faceColor(c.suit) }}>
                  <span className="corner tl">{c.rank}</span>
                  <span className="corner tr">{suitSymbol(c.suit)}</span>
                  <span className="corner bl">{suitSymbol(c.suit)}</span>
                  <span className="corner br">{c.rank}</span>
                  <div className="center">
                    <span className="main-rank">{c.rank}</span>
                    <span className="main-suit">{suitSymbol(c.suit)}</span>
                  </div>
                </div>
              ))
            )}
          </div>


        </div>

        {/* 倒计时圆圈 */}
        {started && isMyTurn() && (
          <div className={"turn-circle mine"}>
            <span>{String(turnLeft).padStart(2,'0')}</span>
          </div>
        )}

        {/* 桌面上方的六位对手（弧形分布） */}
        <div className="opponents-arc">
          {opponents.map(({seat, player}, idx) => {
            const isActive = turnSeat === seat
            const displayName = player?.name ?? '空位'
            const seatOrder = seat + 1
            const cardLabel = player ? (player.id === meId ? `${sortedHand.length}张` : '??张') : null
            const isSpeaking = player ? !!speakingMap[player.id] : false
            const avatarLabel = player?.name ? player.name.slice(0, 1) : '＋'
            const isHostSeat = player ? player.id === hostId : false
            const classes = ['op-seat']
            if (isActive) classes.push('active')
            if (isSpeaking) classes.push('speaking')
            if (!player) classes.push('empty')
            return (
              <div key={seat} className={classes.join(' ')} style={posStyle(arcAngles[idx])}>
                <div className="avatar" aria-hidden="true">{avatarLabel}</div>
                <div className="name">{displayName}</div>
                <span className="seat-order">座位 {seatOrder}{isHostSeat ? ' · 房主' : ''}</span>
                {started && player && <span className="count-badge">手牌 {cardLabel}</span>}
                {isSpeaking && <span className="speaking-indicator">语音中</span>}
                {!player && <span className="empty-tag">等候入座</span>}
                {isActive && isMyTurn() && <span className="timer-badge">{String(turnLeft).padStart(2,'0')}s</span>}
              </div>
            )
          })}
        </div>

        {/* 操作按钮 */}
        <div className="actions-floating">
          {!started && isHost && (
            <>
              <button className="btn" disabled={!canStart} onClick={onStart}>开始游戏</button>
              <button className="btn secondary" disabled={!canRestart} onClick={onRestart}>重新开始</button>
              <button className="btn danger" disabled={!canResetScores} onClick={onResetScores}>清空积分</button>
            </>
          )}
          {started && isHost && (<button className="btn secondary" onClick={onEndGame}>终止游戏</button>)}
          {windActive && (
            <div className="wind-controls">
              {iAmWindTarget ? (
                <>
                  <button className="btn" onClick={onGiveWind}>给风</button>
                  <button className="btn secondary" disabled={!canRejectWind} onClick={onRejectWind}>不给风</button>
                </>
              ) : (
                <span className="wind-waiting">等待 {windTargetPlayer ? windTargetPlayer.name : '其他玩家'} 选择...</span>
              )}
            </div>
          )}
          {!windActive && isMyTurn() && (
            <>
              <button className="btn" disabled={selectedIdxs.length===0} onClick={onPlay}>出牌</button>
              <button className="btn secondary" onClick={onPass}>不出</button>
            </>
          )}
        </div>

        <div className={"chat-panel" + (chatCollapsed ? ' collapsed' : '')}>
          <div className="chat-header">
            <span>聊天</span>
            <div className="chat-header-actions">
              <button className={'voice-toggle' + (voiceActive ? ' active' : '')} onClick={voiceActive ? stopVoice : startVoice} disabled={!roomCode}>
                {voiceActive ? '关闭语音' : '开启语音'}
              </button>
              <button className="chat-collapse" onClick={() => setChatCollapsed(!chatCollapsed)}>
                {chatCollapsed ? '展开' : '收起'}
              </button>
            </div>
          </div>
          {!chatCollapsed && (
            <>
              <div className="chat-messages">
                {chatMessages.map((msg, idx) => (
                  <div key={msg.ts + '-' + idx} className={'chat-row' + (msg.id === meId ? ' mine' : '')}>
                    <span className="chat-name">{msg.name}</span>
                    <span className="chat-text">{msg.text}</span>
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>
              <div className="chat-input-row">
                <input
                  className="chat-input"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSendChat() } }}
                  placeholder={roomCode ? '输入消息...' : '未加入房间'}
                  disabled={!roomCode}
                />
                <button className="btn secondary" onClick={onSendChat} disabled={!roomCode || !canSendChat}>发送</button>
              </div>
              {voiceError && <div className="voice-error">{voiceError}</div>}
            </>
          )}
        </div>

        {/* 底部手牌横向半叠放 */}
        <div className="hand-row">
          {sortedHand.map((c, i) => {
            const cardW = 76
            const step = cardW * 0.5
            const mid = (sortedHand.length - 1) / 2
            const x = step * (i - mid) - cardW / 2
            const selected = selectedIdxs.includes(i)
            return (
              <div
                key={i}
                className={"card-fp face" + (selected ? ' selected' : '')}
                onClick={() => toggleSelect(i)}
                style={{
                  left: `calc(50% + ${x}px)`,
                  transform: selected ? 'translateY(-16px)' : 'translateY(0)',
                  color: (c.suit === 'H' || c.suit === 'D') ? '#c53131' : '#20232f',
                  zIndex: 100 + i
                }}
              >
                <div className="corner tl">{c.rank}</div>
                <div className="corner tr">{suitSymbol(c.suit)}</div>
                <div className="corner bl">{suitSymbol(c.suit)}</div>
                <div className="corner br">{c.rank}</div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
