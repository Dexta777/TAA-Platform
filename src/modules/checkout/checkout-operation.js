const SAFE_RESET_ERRORS = new Set(['request_not_materialized', 'checkout_attempt_terminal']);
const MAXIMUM_AUTOMATIC_RETRY_DELAY_MS = 12000;

export function getCheckoutOperationMethodName(envelope) {
  return (
    envelope?.currentOperation?.selectedShippingMethodName ||
    envelope?.activeCheckout?.selectedShippingMethodName ||
    ''
  );
}

export async function invokeCheckoutOperationWithRetry(
  request,
  { persistPhase, wait, maximumAttempts = 4 }
) {
  for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
    try {
      persistPhase('submitted');
      return await request();
    } catch (error) {
      if (error?.status === 429 && error?.checkoutRequestAdmitted === false) {
        persistPhase('prepared-locally');
      }

      if (error?.orchestrationError === 'reconciliation_required') {
        persistPhase('reconciliation-pending');
        throw error;
      }

      if (!error?.retryable || attempt === maximumAttempts - 1) throw error;

      const retryDelay = error.retryAfterMs || Math.min(12000, 1500 * 2 ** attempt);

      if (retryDelay > MAXIMUM_AUTOMATIC_RETRY_DELAY_MS) throw error;

      if (error?.checkoutRequestAdmitted !== false) persistPhase('processing');
      await wait(retryDelay);
    }
  }

  throw new Error('Payment preparation could not be completed.');
}

export async function requestCurrentCheckoutOperation({
  envelope,
  currentCommand,
  invokeWithRetry,
  createCheckoutSession,
  resumeCheckoutSession,
}) {
  const operation = envelope?.currentOperation;
  const attempt = envelope?.attempt;

  if (!operation || !attempt) {
    throw new Error('Checkout operation recovery state is unavailable.');
  }

  if (currentCommand) {
    return invokeWithRetry(() =>
      createCheckoutSession({
        ...currentCommand,
        checkoutAttemptId: attempt.checkoutAttemptId,
        checkoutAttemptToken: attempt.checkoutAttemptToken,
        checkoutRequestId: operation.checkoutRequestId,
      })
    );
  }

  return invokeWithRetry(() =>
    resumeCheckoutSession({
      checkoutAttemptId: attempt.checkoutAttemptId,
      checkoutAttemptToken: attempt.checkoutAttemptToken,
      checkoutRequestId: operation.checkoutRequestId,
    })
  );
}

export function getCheckoutRecoveryFailureAction(error, operation) {
  const orchestrationError = error?.orchestrationError;

  if (
    orchestrationError === 'checkout_request_not_found' &&
    operation?.phase === 'prepared-locally'
  ) {
    return 'discard-local';
  }

  if (
    orchestrationError === 'checkout_request_not_found' ||
    SAFE_RESET_ERRORS.has(orchestrationError)
  ) {
    return 'reset-terminal';
  }

  return 'fail-closed';
}

export async function recoverCheckoutOperationBeforeFreshState({
  operation,
  requestOperation,
  installPreparedCheckout,
  navigateToConfirmation,
  discardLocalOperation,
  resetTerminalOperation,
  loadFreshShippingOptions,
  exposeManualRetry,
}) {
  try {
    const result = await requestOperation();

    if (['paid', 'payment_pending'].includes(result.checkout_state)) {
      navigateToConfirmation(result.checkout_session_id);
      return 'confirmation';
    }

    await installPreparedCheckout(result);
    return 'installed';
  } catch (error) {
    const action = getCheckoutRecoveryFailureAction(error, operation);

    if (action === 'discard-local') {
      await discardLocalOperation();
      await loadFreshShippingOptions();
      return 'fresh';
    }

    if (action === 'reset-terminal') {
      const resetCompleted = await resetTerminalOperation();

      if (resetCompleted) await loadFreshShippingOptions();

      return resetCompleted ? 'fresh' : 'confirmation';
    }

    if (error?.retryable && error?.orchestrationError !== 'reconciliation_required') {
      await exposeManualRetry(error);
      return 'retry';
    }

    throw error;
  }
}
