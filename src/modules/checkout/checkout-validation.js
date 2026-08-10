const REQUIRED_ADDRESS_FIELDS = [
  ['first-name', 'first name'],
  ['last-name', 'last name'],
  ['address-1', 'address'],
  ['city', 'town or city'],
  ['postcode', 'postcode'],
  ['country', 'country'],
];

function getOwnedField(root, addressType, fieldName) {
  return root.querySelector(`[data-${addressType}-${fieldName}]`);
}

function isFieldInvalid(field) {
  return Boolean(
    field && !field.disabled && typeof field.checkValidity === 'function' && !field.checkValidity()
  );
}

function getAddressError(root, address, addressType, label = '') {
  const prefix = label ? `${label} ` : '';
  const values = {
    'first-name': address.firstName,
    'last-name': address.lastName,
    'address-1': address.address.address_1,
    city: address.address.city,
    postcode: address.address.postcode,
    country: address.countryProvided ? address.address.country : '',
  };

  for (const [fieldName, description] of REQUIRED_ADDRESS_FIELDS) {
    if (!values[fieldName]) return `Please enter your ${prefix}${description}.`;

    if (isFieldInvalid(getOwnedField(root, addressType, fieldName))) {
      return `Please enter a valid ${prefix}${description}.`;
    }
  }

  if (address.address.country !== 'GB') {
    return 'Checkout currently supports United Kingdom delivery only.';
  }

  const countyField = getOwnedField(root, addressType, 'county');

  if (countyField?.required && isFieldInvalid(countyField)) {
    return `Please enter your ${prefix}county or region.`;
  }

  return '';
}

export function validateCheckout(root, addressData, shippingMethodName) {
  const shippingAddressError = getAddressError(root, addressData.shipping, 'shipping');

  if (shippingAddressError) return shippingAddressError;

  const phoneField = root.querySelector('[data-shipping-phone]');
  const emailField = root.querySelector('[data-shipping-email]');

  if (!addressData.shipping.phone) return 'Please enter your phone number.';
  if (isFieldInvalid(phoneField)) return 'Please enter a valid phone number.';
  if (!addressData.shipping.email) return 'Please enter your email address.';
  if (isFieldInvalid(emailField)) return 'Please enter a valid email address.';

  if (addressData.billingIsDifferent) {
    const billingAddressError = getAddressError(root, addressData.billing, 'billing', 'billing');

    if (billingAddressError) return billingAddressError;
  }

  if (!shippingMethodName) return 'Please select a shipping method.';

  return '';
}
