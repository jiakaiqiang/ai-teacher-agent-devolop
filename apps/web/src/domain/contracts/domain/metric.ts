// 指标
export type MetricId = string & { readonly __brand: 'MetricId' }
// metric 和server 进行关联呢
export interface Metric {
    id:MetricId,
    serverId:string,
    name:string,
    value:Number,
    unit:string,
    timestamp:string

}