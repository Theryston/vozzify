type Recovery = {
  recoveryInvoiceId: string | null;
  recoveryStartedAt: Date | null;
};
type Invoice = {
  id?: string;
  status: string | null;
  billing_reason?: string | null;
  due_date?: number | null;
};

export function renewalRecovery(
  input: Recovery & {
    hasPaidInvoice: boolean;
    providerStatus: string;
    paidConfirmed: boolean;
    invoice: Invoice | null;
    failure: { invoiceId: string; occurredAt: number } | null;
  },
): Recovery {
  if (input.paidConfirmed)
    return { recoveryInvoiceId: null, recoveryStartedAt: null };
  if (['canceled', 'incomplete_expired'].includes(input.providerStatus))
    return { recoveryInvoiceId: null, recoveryStartedAt: null };
  const invoice = input.invoice;
  const failure = input.failure;
  const eligible =
    input.hasPaidInvoice &&
    ['past_due', 'unpaid'].includes(input.providerStatus) &&
    invoice?.id &&
    invoice.billing_reason === 'subscription_cycle' &&
    invoice.status === 'open';
  const failedAt =
    eligible && failure && failure.invoiceId === invoice.id
      ? new Date((invoice.due_date ?? failure.occurredAt) * 1000)
      : null;
  if (input.recoveryStartedAt) {
    const sameInvoice = input.recoveryInvoiceId === failure?.invoiceId;
    return {
      recoveryInvoiceId: input.recoveryInvoiceId,
      recoveryStartedAt:
        sameInvoice && failedAt && failedAt < input.recoveryStartedAt
          ? failedAt
          : input.recoveryStartedAt,
    };
  }
  return failedAt && invoice?.id
    ? { recoveryInvoiceId: invoice.id, recoveryStartedAt: failedAt }
    : { recoveryInvoiceId: null, recoveryStartedAt: null };
}

export function recoveryDeadline(start: Date | null): Date | null {
  return start ? new Date(start.getTime() + 3 * 24 * 60 * 60 * 1000) : null;
}

export function isPaidMembershipActive(input: {
  recoveryStartedAt: Date | null;
  paidMembership: boolean;
  currentPeriodEnd: Date | null;
}): boolean {
  const deadline = recoveryDeadline(input.recoveryStartedAt);
  return deadline
    ? deadline.getTime() > Date.now()
    : input.paidMembership &&
        (input.currentPeriodEnd?.getTime() ?? 0) > Date.now();
}
