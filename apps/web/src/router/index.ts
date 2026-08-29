import { createRouter, createWebHistory } from 'vue-router'


const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
   
    {
      path: '/',
      name: 'home',
      component: () => import('../views/v1.vue'),
    },
    {
      path: '/server-detail',
      name: 'serverDetail',
      component: () => import('../views/serverDetailPage.vue'),
    },
  ],
})

export default router
