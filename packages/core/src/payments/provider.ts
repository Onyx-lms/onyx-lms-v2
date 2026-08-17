/**
 * PAY-01 -- the payment provider contract.
 *
 * Laravel dispatched on `payment_gateways.model_name`, but that column DOES NOT
 * EXIST in the schema -- the table has id, identifier, title, keys, description,
 * status, test_mode, is_addon. So `$payment_gateway->model_name` is always null
 * and the dynamic class lookup resolves to nothing. The registry here keys on
 * `identifier`, which is present and is the natural key.
 *
 * Credentials come from payment_gateways.keys (JSON-as-text) with test_mode
 * choosing between the test and live pair, exactly as the Laravel models did.
 */

export interface GatewayConfig {
  identifier: string;
  title: string;
  testMode: boolean;
  keys: Record<string, string>;
  currency: string;
}

export interface CheckoutItem {
  course_id: number;
  title: string;
  /** Unit price after any course-level discount, before coupon and tax. */
  price: number;
}

export interface CheckoutOrder {
  /** Our reference, carried through the provider and back. */
  reference: string;
  userId: number;
  userEmail: string;
  items: CheckoutItem[];
  subtotal: number;
  discount: number;
  tax: number;
  /** What the customer actually pays. */
  total: number;
  currency: string;
  successUrl: string;
  cancelUrl: string;
}

export interface CheckoutSession {
  /** Where to send the browser. */
  redirectUrl: string;
  /** Provider-side id, stored on the pending order for reconciliation. */
  providerRef: string;
  /** Anything the client needs (Razorpay renders its own widget). */
  clientPayload?: Record<string, unknown>;
}

export type PaymentOutcome =
  | { status: 'paid'; providerRef: string; transaction: Record<string, unknown> }
  | { status: 'pending'; providerRef: string }
  | { status: 'failed'; reason: string };

export interface WebhookRequest {
  rawBody: string;
  headers: Record<string, string | string[] | undefined>;
}

export interface PaymentProvider {
  readonly identifier: string;
  /** Creates the provider-side session and returns where to send the user. */
  createCheckout(order: CheckoutOrder, config: GatewayConfig): Promise<CheckoutSession>;
  /** Confirms an order after the redirect back. Must be safe to call twice. */
  verify(reference: string, providerRef: string, config: GatewayConfig,
         query?: Record<string, string>): Promise<PaymentOutcome>;
  /** Verifies the signature and extracts the outcome. Returns null if not ours. */
  parseWebhook?(req: WebhookRequest, config: GatewayConfig):
    Promise<{ reference: string; outcome: PaymentOutcome } | null>;
}

const registry = new Map<string, PaymentProvider>();

export function registerProvider(provider: PaymentProvider): void {
  registry.set(provider.identifier, provider);
}

export function getProvider(identifier: string): PaymentProvider {
  const provider = registry.get(identifier);
  if (!provider) throw new Error(`No payment provider registered for "${identifier}"`);
  return provider;
}

export function hasProvider(identifier: string): boolean {
  return registry.has(identifier);
}

export function registeredProviders(): string[] {
  return [...registry.keys()];
}

/**
 * Picks the right credential from the keys blob.
 * Providers store pairs like stripe_test_key / stripe_live_key; this resolves
 * whichever the gateway's test_mode flag selects, with a plain-name fallback.
 */
export function pickKey(config: GatewayConfig, base: string): string {
  const mode = config.testMode ? 'test' : 'live';
  return config.keys[`${base}_${mode}`]
    ?? config.keys[`${mode}_${base}`]
    ?? config.keys[base]
    ?? '';
}
