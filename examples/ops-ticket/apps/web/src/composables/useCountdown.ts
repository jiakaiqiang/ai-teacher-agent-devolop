import { computed, getCurrentScope, onScopeDispose, ref } from 'vue'

// 倒计时（D27）：收到 429 后按 Retry-After 倒数，到 0 之前不让再提交
// 记的是截止时间而不是“还剩几秒”：浏览器把后台标签页的定时器放慢时，切回来显示的仍然是准确的剩余时间
export function useCountdown() {
  const remaining = ref(0)
  let deadline = 0
  let timer: ReturnType<typeof setInterval> | null = null

  function tick() {
    remaining.value = Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
    if (remaining.value === 0) stop()
  }

  function stop() {
    if (timer) clearInterval(timer)
    timer = null
    remaining.value = 0
  }

  function start(seconds: number) {
    if (timer) clearInterval(timer)
    deadline = Date.now() + seconds * 1000
    timer = setInterval(tick, 1000)
    tick()
  }

  // 在组件里使用时，组件卸载就清掉定时器
  if (getCurrentScope()) onScopeDispose(stop)

  const active = computed(() => remaining.value > 0)
  return { remaining, active, start, stop }
}
