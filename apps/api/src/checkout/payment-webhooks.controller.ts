import {
  Controller,
  Headers,
  HttpCode,
  Inject,
  Post,
  Req,
} from "@nestjs/common";
import type { RawBodyRequest } from "@nestjs/common";
import type { Request } from "express";

import type { WebhookAck } from "@event-ticketing/contracts";

import { PAYMENT_WEBHOOKS_SERVICE } from "../runtime.tokens.js";
import type { PaymentWebhooksService } from "./payment-webhooks.service.js";

/**
 * Provider-facing endpoint. Authentication is the raw-body signature; there is
 * no session, no CSRF, and no rate limit beyond the bounded body size, because
 * the provider retries aggressively and rejected retries would drop payments.
 */
@Controller("webhooks")
export class PaymentWebhooksController {
  constructor(
    @Inject(PAYMENT_WEBHOOKS_SERVICE)
    private readonly service: PaymentWebhooksService
  ) {}

  @Post("payments")
  @HttpCode(200)
  async receive(
    @Req() request: RawBodyRequest<Request>,
    @Headers("stripe-signature") signature: string | undefined
  ): Promise<WebhookAck> {
    return this.service.ingest(request.rawBody, signature);
  }
}
