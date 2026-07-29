// 异常事件
export type AnomalyId =  string & {readonly __brand:"AnomalyId"}


export type Serverity =  'low' | 'medium' | 'high' | 'critical' 

export interface Anomaly {
  id:AnomalyId,
  serverId:string,
  metricName:string,
  serverity:Serverity,
  detectedAt:string,
  message:string
}