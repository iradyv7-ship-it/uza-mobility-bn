import { Injectable, NotFoundException } from '@nestjs/common';
import { DriverInterestStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import type { JwtUserPayload } from '../../users/users.types';
import { CreateDriverInterestDto } from './dto/create-driver-interest.dto';
import { UpdateDriverInterestStatusDto } from './dto/update-driver-interest-status.dto';

/**
 * A public "I'm interested" lead from /drive-with-us — deliberately lightweight, and
 * deliberately NOT the legal FundApplication (see FundApplicationController's own doc
 * comment on why that form stays staff-assisted and oral-first). This only captures
 * enough for a member of staff to call the person back and start that real process.
 */
@Injectable()
export class DriverInterestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async submit(dto: CreateDriverInterestDto) {
    const lead = await this.prisma.driverInterestLead.create({
      data: {
        fullName: dto.fullName.trim(),
        phone: dto.phone.trim(),
        district: dto.district.trim(),
        preferredVehicleType: dto.preferredVehicleType,
        message: dto.message?.trim() || null,
      },
    });

    await this.audit.record({
      action: 'driver_interest:submitted',
      entity: 'DriverInterestLead',
      entityId: lead.id,
    });

    return { id: lead.id, fullName: lead.fullName, status: lead.status };
  }

  list(status?: DriverInterestStatus) {
    return this.prisma.driverInterestLead.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateStatus(
    id: string,
    dto: UpdateDriverInterestStatusDto,
    user: JwtUserPayload | undefined,
  ) {
    const existing = await this.prisma.driverInterestLead.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException('Driver interest lead not found');
    }

    const lead = await this.prisma.driverInterestLead.update({
      where: { id },
      data: {
        status: dto.status,
        contactedAt:
          dto.status === DriverInterestStatus.CONTACTED
            ? new Date()
            : existing.contactedAt,
        contactedById:
          dto.status === DriverInterestStatus.CONTACTED
            ? (user?.sub ?? existing.contactedById)
            : existing.contactedById,
      },
    });

    await this.audit.record({
      userId: user?.sub,
      action: 'driver_interest:status_updated',
      entity: 'DriverInterestLead',
      entityId: lead.id,
      metadata: { from: existing.status, to: lead.status },
    });

    return lead;
  }
}
