import { describe, expect, it } from 'vitest';
import { decideTool } from './agent-permission.js';

describe('当前用户的工具权限', () => {
  it('诊断和工作台对私人笔记的决定不同', () => {
    expect(decideTool(['ticket:read'], 'diagnosis', 'ticket_summary')).toBe('allow');
    expect(decideTool(['ticket:read'], 'diagnosis', 'list_private_notes')).toBe('deny');
    expect(decideTool(['ticket:read'], 'workbench', 'save_private_note')).toBe('allow');
    expect(decideTool([], 'workbench', 'ticket_summary')).toBe('deny');
  });
  it('具备流转权限才能进入关单审批', () => {
    expect(decideTool(['ticket:read'], 'closure', 'publish_solution')).toBe('deny');
    expect(decideTool(['ticket:read', 'knowledge:approve'], 'closure', 'publish_solution')).toBe('approval');
    expect(decideTool(['ticket:read', 'knowledge:approve'], 'diagnosis', 'publish_solution')).toBe('deny');
  });
});
