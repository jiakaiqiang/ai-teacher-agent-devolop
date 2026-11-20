import { Global, Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { DependencyProbe } from './dependency-probe.service.js';
import { HealthController } from './health.controller.js';
import { ShutdownState } from './shutdown-state.js';

@Global()
@Module({
  imports: [TerminusModule.forRoot({ logger: false })],
  controllers: [HealthController], providers: [DependencyProbe, ShutdownState], exports: [ShutdownState],
})
export class HealthModule {}
