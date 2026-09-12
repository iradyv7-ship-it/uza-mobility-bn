import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AcademyController } from './academy.controller';
import { AcademyService } from './academy.service';

@Module({
  imports: [AuthModule],
  controllers: [AcademyController],
  providers: [AcademyService],
  exports: [AcademyService],
})
export class AcademyModule {}
