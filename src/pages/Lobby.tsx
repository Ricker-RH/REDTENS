import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useRoom } from '../store/room'
import { initRealtime, startGame } from '../realtime'

export default function Lobby(){
  const nav = useNavigate()
  const { roomCode, players, isHost, hostId, meId, setSeat, setReady, started, scores, teamScores } = useRoom()

  useEffect(() => { initRealtime() }, [])

  const seats = Array.from({ length: 7 }, (_, i) => i)
  const occupants = (seat: number) => players.find(p => p.seat === seat)
  const myPlayer = players.find(p => p.id === meId)

  const onTakeSeat = (seat: number) => {
    if (occupants(seat)) return
    setSeat(meId, seat)
  }

  const onStart = () => {
    if (!isHost) return alert('仅房主可开始游戏')
    if (!roomCode) return
    startGame(roomCode)
    nav('/table')
  }

  const onCopy = async () => {
    if (!roomCode) return
    try {
      await navigator.clipboard.writeText(roomCode)
      alert('房间密码已复制到剪贴板')
    } catch (e) {
      alert('复制失败，请手动选择复制')
    }
  }

  const seatsFilled = players.filter(p => p.seat!==null).length
  const readyCount = players.filter(p => p.seat!==null && p.id!==hostId && !!p.ready).length
  const canStart = isHost && seatsFilled===7 && readyCount===6 && !started

  const statusText = started
    ? '游戏已开始，欢迎随时回到牌桌继续欢乐对局！'
    : seatsFilled!==7
      ? '等待 7 位玩家全部入座…'
      : (readyCount===6 ? '所有玩家已准备，房主可以随时发车！' : `已准备 ${readyCount}/6，耐心等候其他队友~`)

  return (
    <div className="container">
      <div className="lobby-layout">
        <section className="lobby-info">
          <span className="badge">房间大厅</span>
          <h2>{roomCode ? `房间 ${roomCode}` : '房间未设置'}</h2>
          <p className="page-caption">分享房间码给 6 位好友，七人齐聚即可开局。</p>

          <div className="lobby-scoreboard">
            <span className="score-pill red">红十阵营 · {teamScores.RED}</span>
            <span className="score-pill">非红十阵营 · {teamScores.BLACK}</span>
          </div>

          <div className="lobby-meta">
            <span>已入座 {seatsFilled}/7 · 已准备 {readyCount}/6</span>
            <span>{isHost ? '你是房主，可随时开局或调度座位。' : '等待房主发车，保持准备状态更容易上桌。'}</span>
          </div>

          <div className="lobby-actions">
            <button className="btn secondary" onClick={onCopy} disabled={!roomCode}>复制房间密码</button>
            <button className="btn" disabled={!canStart} onClick={onStart}>开始游戏</button>
            <button className="btn secondary" onClick={()=>nav('/')}>返回首页</button>
          </div>

          <div className="page-caption">{statusText}</div>
        </section>

        <section className="lobby-seats">
          <h3>豪华七人牌桌</h3>
          <div className="lobby-seats-grid">
            {seats.map((seatIndex) => {
              const occupant = occupants(seatIndex)
              const isMe = occupant && occupant.id === meId
              const isSeatHost = seatIndex === 0 && occupant && occupant.id === hostId
              const seatClass = 'lobby-seat' + (seatIndex === 0 ? ' host' : '')
              const avatarLabel = occupant?.name ? occupant.name.slice(0, 1) : '空'
              return (
                <div key={seatIndex} className={seatClass}>
                  <span className="tag">座位 {seatIndex + 1}{seatIndex === 0 ? ' · 房主位' : ''}</span>
                  {occupant ? (
                    <>
                      <div className="lobby-seat-face">
                        <div className="avatar-bubble" aria-hidden="true">{avatarLabel}</div>
                        <div className="seat-info">
                          <div className="name">{occupant.name}</div>
                          <div className="status-row">
                            <span className="status-pill">积分 {scores[occupant.id] ?? 0}</span>
                            {isSeatHost ? (
                              <span className="badge-check">房主</span>
                            ) : occupant.ready ? (
                              <span className="badge-check">已准备</span>
                            ) : (
                              <span className="tag">等待准备</span>
                            )}
                            {isMe && <span className="badge-check">这是你</span>}
                          </div>
                        </div>
                      </div>
                      {isMe && !isSeatHost && !started && (
                        <div className="actions">
                          <button className="btn secondary" onClick={() => setReady(!myPlayer?.ready)}>
                            {myPlayer?.ready ? '取消准备' : '已入座 · 准备'}
                          </button>
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <div className="lobby-seat-face">
                        <div className="avatar-bubble empty" aria-hidden="true">＋</div>
                        <div className="seat-info">
                          <div className="empty-state">空位 · 等你来嗨</div>
                          <div className="status-row">
                            <span className="status-pill">等待入座</span>
                          </div>
                        </div>
                      </div>
                      {!myPlayer?.seat && (
                        <div className="actions">
                          <button className="btn secondary" onClick={() => onTakeSeat(seatIndex)}>入座</button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      </div>
    </div>
  )
}
