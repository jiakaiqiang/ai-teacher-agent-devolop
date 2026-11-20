import type { Permission } from '@ops-ticket/shared';
import { catalog, type Name } from './tool-catalog.js';

export type ToolScene = 'diagnosis' | 'workbench' | 'closure';
export function decideTool(permissions: readonly Permission[], scene: ToolScene, name: Name) {
  if (!permissions.includes('ticket:read')) return 'deny';
  const tool = catalog[name];
  if (name === 'publish_solution') {
    return scene === 'closure' && permissions.includes('knowledge:approve') ? 'approval' : 'deny';
  }
  if (scene === 'workbench') return 'allow';
  // 自动诊断只读取工单证据，私人笔记限用户自己在工作台操作。
  if (scene === 'diagnosis' && tool.effect === 'read' && tool.topic !== 'notes') return 'allow';
  return 'deny';
}
