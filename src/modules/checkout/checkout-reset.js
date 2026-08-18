import { abandonCheckoutAttempt } from '../../services/supabase/checkout.js';
import { clearCheckoutAttempt, loadCheckoutAttempt } from './checkout-attempt.js';

const SUCCESSFUL_ABANDONMENT_RESULTS = new Set([
  'abandoned',
  'already_terminal',
  'attempt_not_found',
]);

function result(status) {
  return Object.freeze({ status });
}

export async function resetCheckoutAttemptEnvelope(checkoutEnvelope, { dependencies = {} } = {}) {
  const {
    abandonCheckoutAttempt: abandonCheckoutAttemptDependency = abandonCheckoutAttempt,
    clearCheckoutAttempt: clearCheckoutAttemptDependency = clearCheckoutAttempt,
  } = dependencies;

  if (!checkoutEnvelope) return result('no_attempt');

  if (!checkoutEnvelope.activeCheckout && !checkoutEnvelope.currentOperation) {
    clearCheckoutAttemptDependency();
    return result('local_only');
  }

  const abandonment = await abandonCheckoutAttemptDependency({
    checkoutAttemptId: checkoutEnvelope.attempt.checkoutAttemptId,
    checkoutAttemptToken: checkoutEnvelope.attempt.checkoutAttemptToken,
  });

  if (abandonment.result === 'already_paid') return result('already_paid');

  if (!SUCCESSFUL_ABANDONMENT_RESULTS.has(abandonment.result)) {
    throw new Error('Checkout is still being reconciled. Please try again shortly.');
  }

  clearCheckoutAttemptDependency();
  return result(abandonment.result);
}

export function resetStoredCheckoutAttempt({ dependencies = {} } = {}) {
  const { loadCheckoutAttempt: loadCheckoutAttemptDependency = loadCheckoutAttempt } = dependencies;

  return resetCheckoutAttemptEnvelope(loadCheckoutAttemptDependency(), { dependencies });
}
