// Merchant Brain: authentication request schemas
//
// Boundary validation for the two credential endpoints. Both schemas are
// strict: an unexpected key is a rejected request, not a silently ignored one.
//
// Password length is capped as well as floored. Supabase hashes whatever it is
// given, so an unbounded password is an unbounded amount of attacker-chosen
// work per attempt — on a rate-limited endpoint, still worth a ceiling.

import { z } from 'zod';

/** 12 characters: long enough to survive an offline attack on a leaked hash. */
export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 128;
export const MAX_NAME_LENGTH = 120;

const emailSchema = z
  .string()
  .trim()
  .min(3)
  .max(200)
  .email('Enter a valid email address.')
  .transform((value) => value.toLowerCase());

const passwordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
  .max(MAX_PASSWORD_LENGTH, `Password must be at most ${MAX_PASSWORD_LENGTH} characters.`);

export const loginSchema = z
  .object({
    email: emailSchema,
    password: z.string().min(1, 'Enter your password.').max(MAX_PASSWORD_LENGTH),
  })
  .strict();

export const signupSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    name: z.string().trim().min(1, 'Enter your name.').max(MAX_NAME_LENGTH),
  })
  .strict();

export type LoginInput = z.infer<typeof loginSchema>;
export type SignupInput = z.infer<typeof signupSchema>;
