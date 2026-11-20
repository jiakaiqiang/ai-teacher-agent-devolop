<script setup lang="ts">
import { defineComponent, h, onScopeDispose, shallowRef, watch } from 'vue'
import { displayMarkdown, markdownVNodes } from '../assistant/markdown'
import { createFrameBuffer } from '../assistant/frameBuffer'
const props = defineProps<{ text: string; streaming?: boolean }>()
const display = shallowRef(displayMarkdown(props.text))
const buffer = createFrameBuffer(text => { display.value = displayMarkdown(text) }, fn => requestAnimationFrame(fn), id => cancelAnimationFrame(id))
watch(() => props.text, text => buffer.push(text, !props.streaming), { flush:'sync' })
watch(() => props.streaming, value => { if (!value) buffer.push(props.text, true) }, { flush:'sync' })
onScopeDispose(buffer.dispose)
const Content = defineComponent(() => () => h('div', { class:'safe-markdown' }, markdownVNodes(display.value.nodes)))
</script>

<template><p v-if="display.limited" role="status">内容较复杂，已按纯文本显示（最多32768个文本单元）</p><Content /></template>

<style>
.safe-markdown { overflow-wrap: anywhere; line-height: 1.65; }
.safe-markdown pre { white-space: pre-wrap; overflow-wrap: anywhere; padding: .75rem; background: #f3f4f6; border-radius: 6px; }
.safe-markdown p { margin: .5rem 0; }
.safe-markdown table { display: block; overflow-x: auto; border-collapse: collapse; }
.safe-markdown th, .safe-markdown td { border: 1px solid #cbd5e1; padding: .3rem; }
.safe-markdown a { color: #155eab; text-decoration: underline; }
</style>
