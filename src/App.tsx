import { Routes, Route, NavLink, useNavigate } from 'react-router-dom'
import { useEffect, useMemo } from 'react'
import { useRoom } from './store/room'
import Home from './pages/Home'
import CreateRoom from './pages/CreateRoom'
import JoinRoom from './pages/JoinRoom'
import Lobby from './pages/Lobby'
import Table from './pages/Table'

export default function App(){
  const navigate = useNavigate()
  const { started, roomCode, players } = useRoom()

  const seatedCount = useMemo(() => players.filter((p) => p.seat !== null).length, [players])
  const tipText = useMemo(() => {
    if (started){
      return `房间 ${roomCode ?? '未设置'} 正在对局，记得关注队友语音提示与出牌节奏～`
    }
    if (roomCode){
      return `已创建房间 ${roomCode} · 当前已入座 ${seatedCount}/7，召唤好友输入房间码即可加入！`
    }
    return '创建欢乐房间或输入房间码即可秒进桌，支持语音聊天 & 红十阵营对抗～'
  }, [started, roomCode, seatedCount])

  useEffect(() => {
    if (started) navigate('/table')
  }, [started, navigate])

  return (
    <div className="app">
      <div className="app-orb app-orb--one" />
      <div className="app-orb app-orb--two" />
      <div className="app-orb app-orb--three" />
      <div className="topbar">
        <div className="brand">
          <span className="badge">RED TENS</span>
          <span>七人在线扑克竞技</span>
        </div>
        <nav className="topbar-nav">
          <NavLink className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')} to="/">首页</NavLink>
          <NavLink className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')} to="/create">创建房间</NavLink>
          <NavLink className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')} to="/join">加入房间</NavLink>
          <NavLink className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')} to="/lobby">房间大厅</NavLink>
          <NavLink className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')} to="/table">牌桌</NavLink>
        </nav>
      </div>
      <div className="tip-marquee">
        <span className="dot" />
        <div className="marquee-track">
          <span>{tipText}</span>
          <span aria-hidden="true">{tipText}</span>
        </div>
      </div>
      <main className="app-main">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/create" element={<CreateRoom />} />
          <Route path="/join" element={<JoinRoom />} />
          <Route path="/lobby" element={<Lobby />} />
          <Route path="/table" element={<Table />} />
        </Routes>
      </main>
      <div className="footer">© RED TENS 原型 · 仅供设计预览</div>
    </div>
  )
}
