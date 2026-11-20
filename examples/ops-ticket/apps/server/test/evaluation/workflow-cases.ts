const samples = [
  ['offer', ['agent','offer_handoff','agent_processing','handoff_offered']],
  ['click', ['reporter','request_human','handoff_offered','pending_assignment']],
  ['suggestion_failed',['reporter','unresolved','awaiting_feedback','pending_assignment']],
  ['assign',['department_lead','assign','pending_assignment','human_processing']],
  ['handled',['operator','handle','human_processing','handled']],
  ['review',['department_lead','approve','handled','reviewed']],
  ['rework',['reporter','unresolved','reviewed','human_processing']],
  ['finish',['reporter','resolved','reviewed','completed']],
] as const;
export const expectations = new Map<string,readonly string[]>(samples);
