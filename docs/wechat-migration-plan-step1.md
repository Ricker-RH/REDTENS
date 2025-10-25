# 微信小游戏迁移 · 第一步计划梳理

## 目标
为后续引擎迁移与接入微信小游戏做准备，梳理现有前端模块与资源，确认对应的 Cocos Creator（或其他支持的小游戏引擎）场景/组件规划，并粗估工作量、风险点与人员分工需求。

## 现有前端结构概览（React）
- `src/App.tsx`：路由主框架、导航、全局提示。
- `src/pages/Home.tsx`：封面页（创建 / 加入 CTA）。
- `src/pages/CreateRoom.tsx`：房主创建房间表单。
- `src/pages/JoinRoom.tsx`：玩家加入房间表单。
- `src/pages/Lobby.tsx`：房间大厅（座位、准备状态、积分）。
- `src/pages/Table.tsx`：核心牌桌，包括：
  - 手牌排序/选择、出牌区渲染。
  - 回合倒计时、风牌流程 UI。
  - 语音/聊天面板。
  - 主机操作（开始、重启、清分）。
- `src/store/room.ts`：Zustand 状态，维护房间信息、玩家、计时、聊天、风牌状态等。
- `src/realtime.ts`：与服务器的 WebSocket 交互封装（playAction、startGame、语音分片等）。

## Cocos Creator 场景/界面映射建议
| 现有页面/组件 | 建议 Cocos 场景 / UI 层 | 说明 |
| -------------- | ---------------------- | ---- |
| `Home` | 场景 `HomeScene`，使用 UI Canvas 创建背景、Logo、两个 Button | 仅保留入口 CTA，设计为横屏布局。 |
| `CreateRoom` & `JoinRoom` | 可合并为 `AuthScene` 或使用同一场景不同节点（Tab） | 输入框可使用 Cocos Creator UI EditBox，按钮沿用现有视觉。 |
| `Lobby` | 单独场景 `LobbyScene` | 需要网格布局展示 7 个座位，支持动效/语音状态指示。 |
| `Table` | 主游戏场景 `TableScene` | 包含：牌桌节点、玩家座位节点、手牌节点、操作面板、聊天/语音层。 |
| 顶部导航 / 路由跳转 | 可通过全局 `SceneManager` 管理场景切换或在单场景内用多层 UI。 | 减少场景切换开销，可考虑 `GameRoot` + 多 UI 层。 |

## 逻辑移植划分
- **公共数据层**：将 `store/room.ts` 的状态管理重构为 Cocos `Singleton` 或脚本组件（利用 `cc.EventTarget` 分发事件）。
- **网络层**：`realtime.ts` 可基本复用，需替换浏览器 API（WebSocket、MediaRecorder）。
  - WebSocket：小游戏支持 `wx.connectSocket`，可封装成兼容接口。
  - 语音：小游戏端需改用微信提供的实时语音 API 或第三方方案，MediaRecorder 不适用。
- **手牌排序逻辑**：保留 `sortHand` 等纯函数，迁移到 `TableScene` 脚本中。
- **UI 交互**：每个按钮/节点使用 Cocos 脚本绑定现有事件（如 `onPlay`, `onPass`）。

## 资源与表现
- **现有 CSS/动画**：需转成引擎内渐变、粒子或 Spine 动画；可输出关键颜色、渐变参数，作为美术参考。
- **音效与动效**：小游戏版本建议补充出牌音效、倒计时提示（Cocos `AudioSource`）。
- **横屏布局**：在 `game.json` 配置 `