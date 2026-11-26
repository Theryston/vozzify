import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { EmailModule } from '../../integrations/email/email.module.js';
import { StripeBillingService } from '../../integrations/stripe/stripe-billing.service.js';
import { StripeCatalogService } from '../../integrations/stripe/stripe-catalog.service.js';
import { WebRevalidationModule } from '../../integrations/web-revalidation/web-revalidation.module.js';
import { UsersModule } from '../users/users.module.js';
import {
  AdminBenefitsController,
  AdminPlanBenefitsController,
} from './admin-benefits.controller.js';
import { AdminBenefitsRepository } from './admin-benefits.repository.js';
import { AdminBenefitsService } from './admin-benefits.service.js';
import { AdminPlansController } from './admin-plans.controller.js';
import { AdminPlansService } from './admin-plans.service.js';
import { PlansController } from './plans.controller.js';
import { PlansRepository } from './plans.repository.js';
import { PlansService } from './plans.service.js';
import { PRICE_CHANGE_QUEUE } from './price-change.job.js';
import { PriceChangeProcessor } from './price-change.processor.js';
import { PriceChangeNoticeService } from './price-change-notice.service.js';
import { PriceChangeReconcileService } from './price-change-reconcile.service.js';
import { PriceChangeRetryService } from './price-change-retry.service.js';
import { PriceChangeScheduleService } from './price-change-schedule.service.js';
import { PriceChangesRepository } from './price-changes.repository.js';
import { PriceChangesService } from './price-changes.service.js';
import { SubscriptionChangesService } from './subscription-changes.service.js';
import { SubscriptionMembershipModule } from './subscription-membership.module.js';
import { SubscriptionWebhookService } from './subscription-webhook.service.js';
import {
  StripeWebhookController,
  SubscriptionsController,
} from './subscriptions.controller.js';
import { SubscriptionsService } from './subscriptions.service.js';

@Module({
  imports: [
    WebRevalidationModule,
    UsersModule,
    SubscriptionMembershipModule,
    EmailModule,
    BullModule.registerQueue({ name: PRICE_CHANGE_QUEUE }),
  ],
  controllers: [
    PlansController,
    SubscriptionsController,
    StripeWebhookController,
    AdminPlansController,
    AdminBenefitsController,
    AdminPlanBenefitsController,
  ],
  providers: [
    PlansRepository,
    PriceChangesRepository,
    PriceChangesService,
    PriceChangeNoticeService,
    PriceChangeScheduleService,
    PriceChangeProcessor,
    PriceChangeReconcileService,
    PriceChangeRetryService,
    SubscriptionsService,
    SubscriptionWebhookService,
    SubscriptionChangesService,
    StripeBillingService,
    PlansService,
    AdminPlansService,
    StripeCatalogService,
    AdminBenefitsRepository,
    AdminBenefitsService,
  ],
  exports: [SubscriptionsService, SubscriptionMembershipModule],
})
export class PlansModule {}
