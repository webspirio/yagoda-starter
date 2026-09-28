import { IsOptional, IsUUID } from 'class-validator';

/**
 * Optional at the DTO so an operator can omit it (the server pins them from
 * their token); REQUIRED for an owner, which the service enforces — a
 * standing is one point's, and there is no network-wide allotment to answer
 * with.
 */
export class CrateStandingQueryDto {
  @IsOptional()
  @IsUUID()
  collection_point_id?: string;
}
