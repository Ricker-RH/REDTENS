import { Link } from 'react-router-dom'

export default function Home(){
  return (
    <div className="container home-cover">
      <div className="home-cover-card">
        <div className="home-cover-top">
          <span className="home-pill">欢乐红十</span>
          <h1>好友开黑 · 秒进牌桌</h1>
          <p>快速创建或加入房间，立刻进入活力满满的红十对战。</p>
        </div>
        <div className="home-cover-actions">
          <Link className="btn" to="/create">创建房间</Link>
          <Link className="btn secondary" to="/join">加入房间</Link>
        </div>
      </div>
      <div className="home-cover-visual">
        <div className="hero-table" />
        <div className="hero-card hero-card--red">♥10</div>
        <div className="hero-card hero-card--blue">♠A</div>
        <div className="hero-chip hero-chip--gold" />
        <div className="hero-chip hero-chip--pink" />
        <div className="hero-chip hero-chip--blue" />
      </div>
    </div>
  )
}
