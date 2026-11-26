import { submitPrivatePracticeAttemptBodySchema } from '@vozzify/contracts';
import { createZodDto } from '../../common/zod/create-zod-dto.js';

export class SubmitPrivateAttemptBodyDto extends createZodDto(
  submitPrivatePracticeAttemptBodySchema,
) {}
