import { expect, it } from 'vitest'
import { feedbackActions } from './feedback-actions'
it('本人才能反馈，并根据前态选择按钮',()=>{
  expect(feedbackActions('reviewed',false)).toEqual([])
  expect(feedbackActions('handoff_offered',true)).toEqual(['request_human'])
  expect(feedbackActions('reviewed',true)).toEqual(['resolved','unresolved'])
})
