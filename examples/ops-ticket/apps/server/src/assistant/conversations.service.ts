import { parseStoredTranscript } from './conversation-context.js';
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { PrismaService, type TransactionClient } from '../prisma/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { ReadToolsService } from './read-tools.service.js';
import { ToolFailure, type ToolMessage } from './tool-protocol.js';

const startSchema = z.object({ conversationId: z.uuid(), requestKey: z.uuid(), version: z.number().int().min(0), question: z.string().trim().min(1).max(2000) }).strict();
export interface TurnOutcome { status: 'completed' | 'failed'; mode: 'mock' | 'model'; answer: string; transcript: ToolMessage[]; errorCode: string | null; }

@Injectable()
export class ConversationsService {
  constructor(private readonly db: PrismaService, private readonly tools: ReadToolsService) {}
  private async owned(tx: Pick<TransactionClient, 'aiConversation'>, id: string, userId: string, scopeHash: string) {
    const row = await tx.aiConversation.findFirst({ where: { id, userId } });
    if (!row) throw new ToolFailure('CONVERSATION_NOT_FOUND');
    if (row.scopeHash !== scopeHash) throw new ToolFailure('CONVERSATION_SCOPE_CHANGED');
    return row;
  }
  async create(userId: string, title: string) {
    const parsed = z.string().trim().min(1).max(200).safeParse(title);
    if (!parsed.success) throw new ToolFailure('CONVERSATION_INVALID');
    const { fingerprint } = await this.tools.access(userId);
    return this.db.serializable(async tx => {
      if (await tx.aiConversation.count({ where: { userId } }) >= 30) throw new ToolFailure('CONVERSATION_LIMIT');
      return tx.aiConversation.create({ data: { userId, scopeHash: fingerprint, title: parsed.data } });
    });
  }
  async list(userId: string) {
    const { fingerprint } = await this.tools.access(userId);
    return this.db.aiConversation.findMany({ where: { userId, scopeHash: fingerprint }, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], take: 30 });
  }
  async get(userId: string, id: string) {
    if (!z.uuid().safeParse(id).success) throw new ToolFailure('CONVERSATION_INVALID');
    const { fingerprint } = await this.tools.access(userId);
    const result = await this.db.$transaction(async tx => {
      const conversation = await this.owned(tx, id, userId, fingerprint);
      const turns = await tx.aiChatTurn.findMany({ where: { conversationId: id }, orderBy: { ordinal: 'asc' }, take: 40 });
      return { conversation, turns };
    });
    const messages: ToolMessage[] = [];
    for (const turn of result.turns) {
      if (turn.status === 'completed') {
        const parsed = parseStoredTranscript(turn.transcript);
        if (parsed.at(-1)?.content !== turn.answer) throw new ToolFailure('CONVERSATION_HISTORY_INVALID');
        messages.push(...parsed);
      } else if (turn.answer || !Array.isArray(turn.transcript) || turn.transcript.length) throw new ToolFailure('CONVERSATION_HISTORY_INVALID');
    }
    await this.tools.assertReferences(userId, messages, fingerprint);
    return result;
  }
  async begin(userId: string, input: unknown) {
    const parsed = startSchema.safeParse(input);
    if (!parsed.success) throw new ToolFailure('CONVERSATION_INVALID');
    const { conversationId, requestKey, question, version } = parsed.data;
    await this.get(userId, conversationId);
    const { fingerprint } = await this.tools.access(userId);
    return this.db.serializable(async tx => {
      const conversation = await this.owned(tx, conversationId, userId, fingerprint);
      const existing = await tx.aiChatTurn.findUnique({ where: { conversationId_requestKey: { conversationId, requestKey } } });
      if (existing) {
        if (existing.question !== question) throw new ToolFailure('CONVERSATION_KEY_CONFLICT');
        if (existing.status === 'running') throw new ToolFailure('CONVERSATION_BUSY');
        return { turn: existing, replay: true };
      }
      if (conversation.activeTurnId) throw new ToolFailure('CONVERSATION_BUSY');
      if (conversation.version !== version) throw new ToolFailure('CONVERSATION_VERSION_CONFLICT');
      const count = await tx.aiChatTurn.count({ where: { conversationId } });
      if (count >= 40) throw new ToolFailure('CONVERSATION_TURN_LIMIT');
      const id = randomUUID();
      // 条件更新和创建轮次在同一事务；外部模型调用绝不能放在重试回调内。
      const changed = await tx.aiConversation.updateMany({ where: { id: conversationId, version, activeTurnId: null }, data: { activeTurnId: id, version: { increment: 1 } } });
      if (changed.count !== 1) throw new ToolFailure('CONVERSATION_VERSION_CONFLICT');
      const turn = await tx.aiChatTurn.create({ data: { id, conversationId, requestKey, question, ordinal: count + 1 } });
      return { turn, replay: false };
    });
  }
  async finish(userId: string, turnId: string, outcome: TurnOutcome) {
    if (outcome.answer.length > 8192 || Buffer.byteLength(JSON.stringify(outcome.transcript)) > 32768 ||
        (outcome.status === 'completed' ? (!outcome.answer.trim() || outcome.errorCode !== null) : !outcome.errorCode)) throw new ToolFailure('CONVERSATION_OUTCOME_INVALID');
    // 已认领任务可以收尾，即使生成期间权限变动；回显仍须重新授权。
    return this.db.serializable(async tx => {
      const turn = await tx.aiChatTurn.findFirst({ where: { id: turnId, conversation: { userId } } });
      if (!turn) throw new ToolFailure('CONVERSATION_NOT_FOUND');
      if (turn.status !== 'running') {
        if (turn.status !== outcome.status || turn.mode !== outcome.mode || turn.answer !== outcome.answer || turn.errorCode !== outcome.errorCode || !isDeepStrictEqual(turn.transcript, outcome.transcript)) throw new ToolFailure('CONVERSATION_FINISH_CONFLICT');
        return turn;
      }
      if (outcome.status === 'completed') {
        if (parseStoredTranscript(outcome.transcript).at(-1)?.content !== outcome.answer) throw new ToolFailure('CONVERSATION_HISTORY_INVALID');
      } else if (outcome.answer || outcome.transcript.length) throw new ToolFailure('CONVERSATION_HISTORY_INVALID');
      const changed = await tx.aiConversation.updateMany({ where: { id: turn.conversationId, activeTurnId: turn.id }, data: { activeTurnId: null, version: { increment: 1 } } });
      if (changed.count !== 1) throw new ToolFailure('CONVERSATION_FINISH_CONFLICT');
      return tx.aiChatTurn.update({ where: { id: turn.id }, data: { ...outcome, transcript: outcome.transcript as Prisma.InputJsonValue, endedAt: new Date() } });
    });
  }
}
