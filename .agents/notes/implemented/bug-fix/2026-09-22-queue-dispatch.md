# Agent Note: 排队消息在回合结束后自动派发

Status: implemented

## Problem

当前会话在 agent 还在跑时提交的消息只进渲染层 `queued`。唯一的自动派发 effect 在 `agent_settled` 把 `running` 置回 false 时执行，但此时 `sendMessage` 仍停在 `prompt` 上，`sending` 为 true。这三个守卫都是 ref，变回 false 不会再触发 effect，队首就永远发不出去。

`onStop` 和 `onError` 把 `queueHeld` 写成 true，并写进会话缓存。运行中入队不会清这个锁，切换会话还会把它读回来。停止或出错一次之后，队列不再自动派发，界面上也没有继续发送的入口。

## Decision

派发收成 `tryDispatch`，在 `sendMessage` 的 `finally`、`agent_settled`、`loading`/`running` 变化，以及 1.5 秒看门狗上各叫一次。是否可发由 `dispatchBlock` 决定，发送前再问一次主进程 `runningSessions`。

停止或出错只把当前这次结束记为中断：这次 `agent_settled` 保持暂停，下一次 `agent_start` 或一次非中断的 `agent_settled` 解除暂停。暂停时队列标题显示「队列已暂停」和「继续发送」。

队列项带稳定 id。运行中「立即发送」走 `steer`；空闲时走普通 `prompt`。`prompt` 没发出去或 `steer` 被拒绝时，用 `restoreQueued` 放回队首。队列发送失败会重新暂停，避免看门狗连续重试。

## Alternatives considered

只在 `sendMessage` 的 `finally` 里再叫一次派发。能盖住「`sending` 还是 true」这条主路径，但盖不住漏掉的 `agent_settled`，也留着永久暂停锁。

运行中提交就直接 `steer`，不再本地排队。会改变「生成中回车是排队、等这轮结束再发」的现有行为；插话保留为每一条上的显式动作。

## Consequences

当前会话回合正常结束后，队首会按顺序发出。停止或出错后队列停住，直到下一轮开始、一次正常结束，或用户点「继续发送」。看门狗每 1.5 秒扫一次，会话多了也只是空转检查；若 `finally` 和 `agent_settled` 两个调用点一直可靠，可以去掉这个定时器。

失败的队列项会回到队首并暂停，不会从队列里消失，也不会在失败后每 1.5 秒弹一次错误。
