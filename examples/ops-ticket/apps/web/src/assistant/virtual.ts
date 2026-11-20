export interface Layout { ids: string[]; offsets: number[]; total: number }
export function layoutRows(ids: string[], heights: ReadonlyMap<string, number>, estimate = 180): Layout {
  const offsets = [0]
  for (const id of ids) offsets.push(offsets[offsets.length-1]! + Math.max(1, heights.get(id) ?? estimate))
  return { ids, offsets, total: offsets[offsets.length-1]! }
}
export function rowAt(layout: Layout, position: number) {
  let low=0; let high=layout.ids.length
  while(low<high) { const mid=(low+high)>>>1; if(layout.offsets[mid+1]! <= position) low=mid+1; else high=mid }
  return Math.min(low,Math.max(0,layout.ids.length-1))
}
export function visibleRange(layout: Layout, top: number, viewport: number, overscan = 2) {
  if (!layout.ids.length) return { start:0,end:0 }
  return { start:Math.max(0,rowAt(layout,Math.max(0,top))-overscan),end:Math.min(layout.ids.length,rowAt(layout,Math.max(0,top)+viewport)+1+overscan) }
}
export function anchorAt(layout: Layout, top: number) {
  const index=rowAt(layout,top); return { id:layout.ids[index] ?? '', offset:top-layout.offsets[index]! }
}
export function restoreAnchor(layout: Layout, anchor: {id:string;offset:number}) {
  const index=layout.ids.indexOf(anchor.id)
  return index < 0 ? 0 : layout.offsets[index]! + Math.min(Math.max(0,anchor.offset),layout.offsets[index+1]!-layout.offsets[index]!-1)
}
export const nearBottom = (top:number,viewport:number,total:number) => total - top - viewport <= 48
