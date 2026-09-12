import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AdminWalletsController } from './admin-wallets.controller';
import { CovenantService } from './covenant.service';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';

@Module({
  imports: [AuthModule, NotificationsModule],
  controllers: [WalletController, AdminWalletsController],
  providers: [WalletService, CovenantService],
  exports: [WalletService, CovenantService],
})
export class WalletModule {}
