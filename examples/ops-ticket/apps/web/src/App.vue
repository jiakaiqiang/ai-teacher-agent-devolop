<script setup lang="ts">
// 页面外壳：标题、当前登录用户和路由出口
import { useRouter } from 'vue-router'
import { logout } from './api/auth'
import { session } from './api/session'

const router = useRouter()

async function onLogout() {
  logout()
  await router.replace('/login')
}
</script>

<template>
  <main>
    <header class="top">
      <h1>智能运维工单系统</h1>
      <p v-if="session" class="user">
        {{ session.user.displayName }}
        <button type="button" @click="onLogout">退出登录</button>
      </p>
    </header>
    <RouterView />
  </main>
</template>

<style scoped>
.top { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.user { display: flex; align-items: center; gap: 8px; }
</style>
