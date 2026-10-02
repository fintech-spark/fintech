---
name: api-security
description: Best practices and audit checklist for securing REST API routes, endpoints, and third-party webhooks. Use when adding or reviewing API handlers, implementing rate limiting, verifying webhooks, or designing external service integrations.
---

# API Security Skill

This skill provides comprehensive patterns and verification checklists for securing Next.js API route handlers and third-party integrations.

## When to Activate

- Writing or reviewing route handlers under `app/api/`
- Adding third-party webhook receivers (e.g. Stripe, Plaid, Twilio)
- Configuring CORS, CSRF, or rate limiting
- Calling external partner APIs

## Route Handler Security Checklist

### 1. Tenant Authentication & Session Scoping
```typescript
// PASS: Verify session on server and derive tenant ID
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Tenant ID MUST come from verified session, not request payload
  const businessId = session.user.businessId as BusinessId;
  const tenantContext: TenantContext = { businessId, userId: session.user.id as UserId };
  
  // Proceed with tenantContext...
}
```

### 2. Request Body Validation with Zod
```typescript
import { z } from 'zod';

const CreateExpenseSchema = z.object({
  amount: z.number().int().positive(),
  currency: z.string().length(3),
  category: z.string().min(1).max(50),
  description: z.string().max(255).optional(),
}).strict(); // Disallow unknown keys

export async function POST(req: Request) {
  const body = await req.json();
  const parseResult = CreateExpenseSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json({ error: 'Invalid input', details: parseResult.error.format() }, { status: 400 });
  }
  // Use parseResult.data...
}
```

### 3. Webhook Signature Verification
```typescript
// PASS: Verify HMAC signature before processing webhook
export async function POST(req: Request) {
  const signature = req.headers.get('stripe-signature');
  const rawBody = await req.text();
  
  try {
    const event = stripe.webhooks.constructEvent(
      rawBody,
      signature!,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
    // Process verified event...
  } catch (err) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }
}
```

### 4. Rate Limiting Guidelines
- Public endpoints (health, login): 10 requests per minute per IP.
- Authenticated endpoints: 100 requests per minute per tenant.
- AI analysis endpoints: 20 requests per minute per tenant to protect model quota.
