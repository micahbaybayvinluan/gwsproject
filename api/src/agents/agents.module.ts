import { Global, Module } from '@nestjs/common';
import { TargetsModule } from '../targets/targets.module';
import { AgentsController } from './agents.controller';
import { OutletsService } from './outlets.service';
import { ItinerariesService } from './itineraries.service';
import { AgentConsignmentsService } from './agent-consignments.service';
import { MonitorService } from './monitor.service';

@Global()
@Module({ imports: [TargetsModule], providers: [OutletsService, ItinerariesService, AgentConsignmentsService, MonitorService], controllers: [AgentsController], exports: [OutletsService, AgentConsignmentsService, MonitorService] })
export class AgentsModule {}
