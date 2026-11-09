import { homeRowItemsQuerySchema } from '@vozzify/contracts';
import { createZodDto } from '../../common/zod/create-zod-dto.js';

export class HomeRowItemsQueryDto extends createZodDto(
  homeRowItemsQuerySchema,
) {}
