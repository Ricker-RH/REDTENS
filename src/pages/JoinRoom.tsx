import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useRoom } from '../store/room'
import { initRealtime } from '../realtime'

export default function JoinRoom(){
  const [name, setName] = useState('玩家')
  const [code, setCode] = useState('')
  const nav = useNavigate()
  const joinRoom = useRoom(s => s.joinRoom)

  useEffect(() => { initRealtime() }, [])

  const onJoin = () => {
    if (!code || code.length < 6) return alert('请输入 6 位房间密码')
    joinRoom(code, name || '玩家')
    nav('/lobby')
  }

  return (
    <div className="container">
      <div className="page-stack">
        <div className="page-card">
          <div className="home-pill">玩家入口</div>
          <h2>加入好友的欢乐房间</h2>
          <p className="page-caption">输入房主分享的 6 位房间密码与昵称，立即入座等待开局。</p>
          <div className="form-grid">
            <input
              className="input"
              value={code}
              onChange={e=>setCode(e.target.value)}
              placeholder="房间密码（6 位）"
              maxLength={6}
            />
            <input
              className="input"
              value={name}
              onChange={e=>setName(e.target.value)}
              placeholder="你的昵称"
            />
          </div>
          <div className="home-actions">
            <button className="btn" onClick={onJoin}>加入并进入大厅</button>
            <button className="btn secondary" onClick={()=>nav('/')}>返回首页</button>
          </div>
        </div>
        <div className="page-card">
          <h3>玩家贴士</h3>
          <ul>
            <li>入座后记得点击“准备”，当 6 位玩家都准备好即可开局。</li>
            <li>语音功能需要浏览器麦克风权限，进入牌桌前可提前试麦。</li>
            <li>昵称和准备状态可随时修改，房主会看到最新状态提示。</li>
          </ul>
        </div>
      </div>
    </div>
  )
}
