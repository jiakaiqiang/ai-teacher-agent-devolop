import { Injectable } from '@nestjs/common';
import type { ChatMessage } from './chat.client.js';
import { ModelGateway } from './model-gateway.js';

@Injectable()
export class ModelSource {
  constructor(private readonly gateway: ModelGateway) {}
  async open(messages: ChatMessage[], signal: AbortSignal): Promise<{ body: ReadableStream<Uint8Array>; mode: 'mock' | 'model' }> {
    return this.gateway.stream(messages, signal);
  }
}
