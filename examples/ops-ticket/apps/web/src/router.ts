import { createRouter, createWebHistory } from 'vue-router'
import { session } from './api/session'

// 页面组件按路由懒加载，打开列表页时不会下载详情页的代码
export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {path:'/report',component:()=>import('./views/ReportView.vue')},
    {path:'/agent/runs',component:()=>import('./views/RunEventsView.vue')},
    {path:'/assistant/:id?',component:()=>import('./views/AssistantConversationsView.vue')},
    { path: '/login', component: () => import('./views/LoginView.vue'), meta: { public: true } },
    { path: '/', component: () => import('./views/TicketListView.vue') },
    { path: '/tickets/:ticketNo', component: () => import('./views/TicketDetailView.vue') },
  ],
})

// 没登录时先去登录页，登录后回到原来要去的页面（D15）
// 这只是体验：真正挡住未登录请求的是后端的全局守卫
router.beforeEach((to) => {
  if (!to.meta.public && !session.value) {
    return { path: '/login', query: { redirect: to.fullPath } }
  }
  return true
})
