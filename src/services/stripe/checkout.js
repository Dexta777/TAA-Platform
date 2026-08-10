import { loadStripe } from '@stripe/stripe-js';

const stripePublishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY?.trim();

if (!stripePublishableKey) {
  throw new Error(
    'Stripe browser configuration is missing. Set VITE_STRIPE_PUBLISHABLE_KEY before starting the application.'
  );
}

const stripePromise = loadStripe(stripePublishableKey);

export async function createCheckoutElementsSdk(clientSecret, defaultValues = {}) {
  const normalizedClientSecret = String(clientSecret ?? '').trim();

  if (!normalizedClientSecret) {
    throw new Error('A Stripe Checkout client secret is required.');
  }

  const stripe = await stripePromise;

  if (!stripe) {
    throw new Error('Stripe.js could not be loaded.');
  }

  return stripe.initCheckoutElementsSdk({
    clientSecret: normalizedClientSecret,
    defaultValues,
    elementsOptions: {
      appearance: {
        theme: 'stripe',
        variables: {
          colorPrimary: '#000000',
          colorBackground: '#ffffff',
          colorText: '#000000',
          colorDanger: '#8b0000',
          fontFamily: 'Arial, sans-serif',
          borderRadius: '0px',
        },
      },
    },
  });
}
