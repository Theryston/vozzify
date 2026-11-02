import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  Inject,
  Post,
  Query,
  type RawBodyRequest,
  Req,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  checkoutResultSchema,
  createCheckoutBodySchema,
  createPortalBodySchema,
  createSubscriptionChangeBodySchema,
  currentSubscriptionSchema,
  listPlansQuerySchema,
  portalSessionSchema,
  trialEligibilitySchema,
} from '@vozzify/contracts';
import type { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { createZodDto } from '../../common/zod/create-zod-dto.js';
import { ZodSerializerDto } from '../../common/zod/zod-serializer.interceptor.js';
import { ENV, type Env } from '../../config/env.js';
import { verifyStripeEvent } from '../../integrations/stripe/stripe-webhook.js';
import type { AuthUser } from '../auth/auth.js';
import { SubscriptionsService } from './subscriptions.service.js';

class CurrentSubscriptionDto extends createZodDto(currentSubscriptionSchema) {}
class CreateCheckoutDto extends createZodDto(createCheckoutBodySchema) {}
class CreateChangeDto extends createZodDto(
  createSubscriptionChangeBodySchema,
) {}
class CreatePortalDto extends createZodDto(createPortalBodySchema) {}
class SubscriptionQueryDto extends createZodDto(listPlansQuerySchema) {}
@ApiTags('subscriptions')
@Controller('me/subscription')
export class SubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}
  @Post('checkout')
  @Header('Cache-Control', 'private, no-store')
  @ZodSerializerDto(checkoutResultSchema)
  checkout(@CurrentUser() user: AuthUser, @Body() body: CreateCheckoutDto) {
    return this.subscriptions.checkout(user.id, body);
  }
  @Post('change')
  @ApiCreatedResponse({ type: CurrentSubscriptionDto })
  @Header('Cache-Control', 'private, no-store')
  @ZodSerializerDto(currentSubscriptionSchema)
  async change(
    @CurrentUser() user: AuthUser,
    @Body() body: CreateChangeDto,
    @Query() query: SubscriptionQueryDto,
  ) {
    return this.subscriptions.change(user.id, body, query.locale);
  }
  @Post('portal')
  @Header('Cache-Control', 'private, no-store')
  @ZodSerializerDto(portalSessionSchema)
  portal(@CurrentUser() user: AuthUser, @Body() body: CreatePortalDto) {
    return this.subscriptions.portal(user.id, body.locale);
  }
  @Get('trial-eligibility')
  @Header('Cache-Control', 'private, no-store')
  @ZodSerializerDto(trialEligibilitySchema)
  trialEligibility(@CurrentUser() user: AuthUser) {
    return this.subscriptions.trialEligibility(user.id);
  }
  @Get()
  @ApiOkResponse({ type: CurrentSubscriptionDto })
  @Header('Cache-Control', 'private, no-store')
  @ZodSerializerDto(currentSubscriptionSchema)
  summary(@CurrentUser() user: AuthUser, @Query() query: SubscriptionQueryDto) {
    return this.subscriptions.summary(user.id, query.locale);
  }
}
@ApiTags('subscriptions')
@Controller('billing')
export class StripeWebhookController {
  constructor(
    private readonly subscriptions: SubscriptionsService,
    @Inject(ENV) private readonly env: Env,
  ) {}
  @Public()
  @Post('stripe-webhook')
  @HttpCode(200)
  async webhook(
    @Req() request: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature?: string,
  ) {
    const body = request.rawBody;
    const event = verifyStripeEvent({
      body: Buffer.isBuffer(body) ? body : Buffer.alloc(0),
      signature: signature ?? '',
      secret: this.env.STRIPE_WEBHOOK_SECRET,
      apiKey: this.env.STRIPE_SECRET_KEY,
    });
    await this.subscriptions.webhook(event);
    return { received: true };
  }
}
