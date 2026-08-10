const ADDRESS_FIELD_NAMES = [
  'first-name',
  'last-name',
  'company',
  'address-1',
  'address-2',
  'city',
  'county',
  'postcode',
  'country',
];

function getField(root, addressType, fieldName) {
  return root.querySelector(`[data-${addressType}-${fieldName}]`);
}

function getFieldValue(root, addressType, fieldName) {
  return getField(root, addressType, fieldName)?.value?.trim() || '';
}

function normalizeCountry(value) {
  const country = String(value ?? '')
    .trim()
    .toUpperCase();

  if (country === 'GB' || country === 'UK' || country === 'UNITED KINGDOM') return 'GB';

  return country;
}

function getAddress(root, addressType) {
  const firstName = getFieldValue(root, addressType, 'first-name');
  const lastName = getFieldValue(root, addressType, 'last-name');
  const country = getFieldValue(root, addressType, 'country');

  return {
    firstName,
    lastName,
    name: `${firstName} ${lastName}`.trim(),
    address: {
      first_name: firstName,
      last_name: lastName,
      company: getFieldValue(root, addressType, 'company'),
      address_1: getFieldValue(root, addressType, 'address-1'),
      address_2: getFieldValue(root, addressType, 'address-2'),
      city: getFieldValue(root, addressType, 'city'),
      county: getFieldValue(root, addressType, 'county'),
      postcode: getFieldValue(root, addressType, 'postcode'),
      country: normalizeCountry(country),
    },
    countryProvided: Boolean(country),
  };
}

function copyShippingToBilling(root) {
  ADDRESS_FIELD_NAMES.forEach((fieldName) => {
    const shippingField = getField(root, 'shipping', fieldName);
    const billingField = getField(root, 'billing', fieldName);

    if (shippingField && billingField) {
      billingField.value = shippingField.value || '';
    }
  });
}

function clearBillingFields(root) {
  ADDRESS_FIELD_NAMES.forEach((fieldName) => {
    const billingField = getField(root, 'billing', fieldName);

    if (billingField) billingField.value = '';
  });
}

export function getCheckoutAddressData(root) {
  const billingDifferent = root.querySelector('[data-billing-different]');
  const billingIsDifferent = Boolean(billingDifferent?.checked);
  const shipping = getAddress(root, 'shipping');
  const billing = billingIsDifferent ? getAddress(root, 'billing') : { ...shipping };

  shipping.email = root.querySelector('[data-shipping-email]')?.value?.trim() || '';
  shipping.phone = root.querySelector('[data-shipping-phone]')?.value?.trim() || '';

  return {
    shipping,
    billing,
    billingIsDifferent,
  };
}

export function toStripeContact(addressData) {
  return {
    name: addressData.name || undefined,
    address: {
      line1: addressData.address.address_1 || null,
      line2: addressData.address.address_2 || null,
      city: addressData.address.city || null,
      state: addressData.address.county || null,
      postal_code: addressData.address.postcode || null,
      country: addressData.address.country || 'GB',
    },
  };
}

export function initialiseCheckoutAddress(root) {
  const billingDifferent = root.querySelector('[data-billing-different]');

  root
    .querySelectorAll(
      '[data-shipping-first-name], [data-shipping-last-name], [data-shipping-company], [data-shipping-address-1], [data-shipping-address-2], [data-shipping-city], [data-shipping-county], [data-shipping-postcode], [data-shipping-country]'
    )
    .forEach((field) => {
      field.addEventListener('input', () => {
        if (!billingDifferent?.checked) copyShippingToBilling(root);
      });
    });

  billingDifferent?.addEventListener('change', () => {
    if (billingDifferent.checked) {
      clearBillingFields(root);
      return;
    }

    copyShippingToBilling(root);
  });

  copyShippingToBilling(root);
}
