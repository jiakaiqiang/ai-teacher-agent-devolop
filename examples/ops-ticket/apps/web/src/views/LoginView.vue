<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { login } from '../api/auth'
import { ApiError } from '../api/http'

const route = useRoute()
const router = useRouter()
const username = ref('')
const password = ref('')
const error = ref<string | null>(null)
const submitting = ref(false)

// 只接受站内路径，防止 ?redirect=https://别的网站 或 //别的网站 把用户带走（开放重定向）
function safeRedirect(value: unknown): string {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : '/'
}

async function submit() {
  if (submitting.value) return
  submitting.value = true
  error.value = null
  try {
    await login(username.value.trim(), password.value)
    await router.replace(safeRedirect(route.query.redirect))
  } catch (e) {
    error.value = e instanceof ApiError && e.code === 'INVALID_CREDENTIALS' ? '用户名或密码错误' : '登录失败，请稍后重试'
  } finally {
    submitting.value = false
    password.value = ''
  }
}
</script>

<template>
  <form class="card" @submit.prevent="submit">
    <h2>登录</h2>
    <label>用户名 <input v-model="username" autocomplete="username" required maxlength="64" /></label>
    <label>密码 <input v-model="password" type="password" autocomplete="current-password" required maxlength="128" /></label>
    <button type="submit" :disabled="submitting">{{ submitting ? '登录中…' : '登录' }}</button>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
  </form>
</template>

<style scoped>
.card { display: grid; gap: 12px; max-width: 320px; padding: 16px 20px; background: #fff; border: 1px solid #d0d7de; border-radius: 8px; }
label { display: grid; gap: 4px; }
.error { color: #cf222e; margin: 0; }
</style>
