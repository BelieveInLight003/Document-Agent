import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AiModule } from './ai/ai.module.js';
import { DocumentModule } from './document/document.module.js';
import { GraphModule } from './graph/graph.module.js';
import { SearchModule } from './search/search.module.js';
import { StorageModule } from './storage/storage.module.js';
import { AuthModule } from './auth/auth.module.js';
import { TeamModule } from './team/team.module.js';
import { UserModule } from './user/user.module.js';

@Module({
  imports: [
    DocumentModule,
    AiModule,
    SearchModule,
    GraphModule,
    StorageModule,
    UserModule,
    TeamModule,
    AuthModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
