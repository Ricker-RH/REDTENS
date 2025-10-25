import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useRoom } from '../store/room'
import { initRealtime } from '../realtime'

export default function CreateRoom(){
  const [name, setName] = useState('房主')
  const nav = useNavigate()
  const setHostRoom = useRoom(s => s.setHostRoom)

  useEffect(() => { initRealtime() }, [])

  const onCreate = () => {
    const code = Math.random().toString().slice(2,8)
    setHostRoom(code, name || '房主')
    nav('/lobby')
  }

  return (
    <div className="container">
      <div className="page-stack">
        <div className="page-card">
          <div className="home-pill">房主入口</div>
          <h2>创建欢乐房间</h2>
          <p className="page-caption">设置昵称后自动生成 6 位房间码，分享给好友即可一起开局。</p>
          <div className="form-grid">
            <input
              className="input"
              value={name}
              onChange={e=>setName(e.target.value)}
              placeholder="输入房主昵称"
            />
          </div>
          <div className="home-actions">
            <button className="btn" onClick={onCreate}>创建并进入大厅</button>
            <button className="btn secondary" onClick={()=>nav('/')}>返回首页</button>
          </div>
        </div>
        <div className="page-card">
          <h3>房主贴士</h3>
          <ul>
            <li>分享房间码时，可截图或复制粘贴给好友，支持语音房实时聊天。</li>
            <li>等 6 位玩家全部入座并准备后，“开始游戏”按钮会自动亮起。</li>
            <li>未满员前可随时修改昵称或重新创建，房间码会重新生成。</li>
          </ul>
        </div>
      </div>
    </div>
  )
}
