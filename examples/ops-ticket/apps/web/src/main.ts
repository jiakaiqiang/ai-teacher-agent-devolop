import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import { setUnauthorizedHandler } from './api/session'
import { router } from './router'

// 任何请求发现令牌失效时回到登录页，登录后回到当前页面（D15）
setUnauthorizedHandler(() => {
  const current = router.currentRoute.value
  if (current.path !== '/login') {
    void router.replace({ path: '/login', query: { redirect: current.fullPath } })
  }
})

createApp(App).use(router).mount('#app')
