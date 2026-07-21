export const CRITICAL_DELIVERY_LIFETIME_MS = 7 * 24 * 60 * 60_000;
export const WARNING_DELIVERY_LIFETIME_MS = 24 * 60 * 60_000;

export function deliveryLifetimeMs(severity) {
  if (severity === 'critical') return CRITICAL_DELIVERY_LIFETIME_MS;
  if (severity === 'warning') return WARNING_DELIVERY_LIFETIME_MS;
  return undefined;
}
