const MAXIMUM_RATE_LIMIT_RETRY_DELAY_MS = 12000;

export async function loadConfirmationWithRetry(
  checkoutSessionId,
  confirmationToken,
  { requestConfirmation, wait, maximumAttempts, normalRetryDelayMs }
) {
  for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
    let result;

    try {
      result = await requestConfirmation(checkoutSessionId, confirmationToken);
    } catch (error) {
      if (error?.status !== 429 || !error?.retryable || attempt === maximumAttempts - 1) {
        throw error;
      }

      await wait(
        Math.min(MAXIMUM_RATE_LIMIT_RETRY_DELAY_MS, error.retryAfterMs || normalRetryDelayMs)
      );
      continue;
    }

    if (result.order) return result;
    if (!result.pending) break;

    await wait(normalRetryDelayMs);
  }

  throw new Error('Your order is still being prepared. Please refresh this page.');
}
