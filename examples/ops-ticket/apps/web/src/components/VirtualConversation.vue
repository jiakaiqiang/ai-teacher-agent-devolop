<script setup lang="ts" generic="T extends { id: string }">
import { computed, nextTick, onMounted, onScopeDispose, onUpdated, ref, watch } from 'vue'
import { anchorAt, layoutRows, nearBottom, restoreAnchor, visibleRange } from '../assistant/virtual'
const props=defineProps<{items:T[]}>()
const viewport=ref<HTMLElement>(); const top=ref(0); const height=ref(480); const following=ref(true); const all=ref(false)
const revision=ref(0); const focused=ref(''); const heights=new Map<string,number>()
const layout=computed(()=>{ void revision.value; return layoutRows(props.items.map(item=>item.id),heights) })
const range=computed(()=>visibleRange(layout.value,top.value,height.value))
const mounted=computed(()=>props.items.map((item,index)=>({item,index})).filter(row=>all.value || row.item.id===focused.value || row.index>=range.value.start && row.index<range.value.end))
let rowObserver:ResizeObserver|undefined;let viewportObserver:ResizeObserver|undefined
let pending:number|undefined;let disposed=false;let expected:number|undefined;let userRevision=0;let width=0;let resetHeights=false
const measurements=new Map<string,number>();const observed=new Set<Element>()
function scrollTo(position:number) {
  const el=viewport.value;if(!el)return
  expected=Math.max(0,Math.min(position,layout.value.total-el.clientHeight));el.scrollTop=expected;top.value=el.scrollTop
}
function onScroll() {
  const el=viewport.value;if(!el)return;top.value=el.scrollTop
  if(expected!==undefined && Math.abs(el.scrollTop-expected)<2) {expected=undefined;return}
  expected=undefined;userRevision++;following.value=nearBottom(el.scrollTop,el.clientHeight,el.scrollHeight)
}
function queueLayout() {
  if(pending!==undefined || disposed)return
  pending=requestAnimationFrame(async()=>{
    pending=undefined;if(disposed)return
    const anchor=anchorAt(layout.value,viewport.value?.scrollTop ?? top.value);const userAtStart=userRevision
    if(resetHeights){heights.clear();resetHeights=false}
    for(const [id,value] of measurements) heights.set(id,value)
    measurements.clear();revision.value++;await nextTick();if(disposed)return
    if(following.value)scrollTo(layout.value.total)
    else if(userAtStart===userRevision)scrollTo(restoreAnchor(layout.value,anchor))
  })
}
function observeRows() {
  const rows=viewport.value?.querySelectorAll('[data-virtual-row]') ?? []
  const current=new Set<Element>(rows)
  for(const row of observed) if(!current.has(row)){rowObserver?.unobserve(row);observed.delete(row)}
  for(const row of current) if(!observed.has(row)){rowObserver?.observe(row,{box:'border-box'});observed.add(row)}
}
async function latest() {following.value=true;await nextTick();scrollTo(layout.value.total)}
function onFocus(event:FocusEvent) {focused.value=(event.target as HTMLElement).closest<HTMLElement>('[data-virtual-row]')?.dataset.virtualRow ?? ''}
function onFocusOut() {queueMicrotask(()=>{if(disposed)return;focused.value=viewport.value?.contains(document.activeElement)?(document.activeElement as HTMLElement).closest<HTMLElement>('[data-virtual-row]')?.dataset.virtualRow ?? '':''})}
watch(()=>props.items.map(item=>item.id).join(','),(next,previous)=>{
  if(previous && !next.startsWith(previous+','))following.value=true
  const ids=new Set(props.items.map(item=>item.id));for(const id of heights.keys())if(!ids.has(id))heights.delete(id)
  queueLayout()
},{flush:'post'})
watch(all,queueLayout,{flush:'post'})
onMounted(()=>{
  rowObserver=new ResizeObserver(entries=>{
    for(const entry of entries){const id=(entry.target as HTMLElement).dataset.virtualRow!;const value=entry.borderBoxSize[0]?.blockSize ?? (entry.target as HTMLElement).getBoundingClientRect().height;if(Math.abs((heights.get(id)??180)-value)>.5)measurements.set(id,value)}
    if(measurements.size)queueLayout()
  })
  viewportObserver=new ResizeObserver(entries=>{
    const el=viewport.value;if(!el)return;height.value=el.clientHeight
    const next=entries[0]?.contentRect.width ?? el.clientWidth;if(width && Math.abs(next-width)>.5)resetHeights=true;width=next;queueLayout()
  })
  if(viewport.value)viewportObserver.observe(viewport.value);observeRows();queueLayout()
})
onUpdated(observeRows)
onScopeDispose(()=>{disposed=true;if(pending!==undefined)cancelAnimationFrame(pending);rowObserver?.disconnect();viewportObserver?.disconnect();observed.clear()})
</script>

<template>
  <div class="conversation-list-controls">
    <label><input v-model="all" type="checkbox">显示全部消息（便于查找和辅助阅读）</label>
    <button v-if="!following" type="button" @click="latest">回到最新消息</button>
  </div>
  <div ref="viewport" class="conversation-viewport" role="region" aria-label="会话消息" tabindex="0" @scroll="onScroll" @wheel.passive="event=>{if(event.deltaY<0){following=false;userRevision++}}" @focusin="onFocus" @focusout="onFocusOut">
    <div role="list" :style="{height:layout.total+'px',position:'relative'}">
      <div v-for="row in mounted" :key="row.item.id" :data-virtual-row="row.item.id" role="listitem" :aria-posinset="row.index+1" :aria-setsize="items.length" class="conversation-row" :style="{position:'absolute',top:layout.offsets[row.index]+'px',width:'100%'}">
        <slot :item="row.item" :index="row.index" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.conversation-list-controls { display:flex;align-items:center;justify-content:space-between;gap:.5rem;flex-wrap:wrap;margin:.5rem 0;font-size:.875rem; }
.conversation-viewport { height: min(60vh, 540px); min-height:240px;overflow:auto;overflow-anchor:none; border:1px solid #d1d5db;border-radius:8px; }
.conversation-viewport:focus-visible { outline:2px solid #2563eb;outline-offset:2px; }
.conversation-row { box-sizing:border-box;padding:.75rem; }
</style>
