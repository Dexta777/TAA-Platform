function constantTimeEqual(left: string, right: string) {
  const maximumLength = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;

  for (let index = 0; index < maximumLength; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }

  return difference === 0;
}

export function matchesAnyConfiguredSecret(supplied: string, configured: readonly string[]) {
  let matched = 0;

  for (const secret of configured) {
    if (!secret) continue;
    matched |= Number(constantTimeEqual(supplied, secret));
  }

  return matched === 1;
}

export function requireInternalToken(
  request: Request,
  {
    headerName,
    currentSecret,
    previousSecret = '',
  }: { headerName: string; currentSecret: string; previousSecret?: string }
) {
  const supplied = request.headers.get(headerName)?.trim() || '';

  return Boolean(supplied) && matchesAnyConfiguredSecret(supplied, [currentSecret, previousSecret]);
}

export function isBearerTokenAuthorized(
  request: Request,
  currentSecret: string,
  previousSecret = ''
) {
  const supplied = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '';

  return Boolean(supplied) && matchesAnyConfiguredSecret(supplied, [currentSecret, previousSecret]);
}
