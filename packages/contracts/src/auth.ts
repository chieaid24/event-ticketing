import { z } from "zod";

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(320)
  .pipe(z.email());

export const passwordSchema = z.string().min(12).max(128);

export const authTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{20,128}$/);

export const registerRequestSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
  })
  .strict();

export const loginRequestSchema = z
  .object({
    email: emailSchema,
    password: z.string().min(1).max(128),
  })
  .strict();

export const verifyEmailRequestSchema = z
  .object({
    token: authTokenSchema,
  })
  .strict();

export const forgotPasswordRequestSchema = z
  .object({
    email: emailSchema,
  })
  .strict();

export const resetPasswordRequestSchema = z
  .object({
    password: passwordSchema,
    token: authTokenSchema,
  })
  .strict();

export const changePasswordRequestSchema = z
  .object({
    currentPassword: z.string().min(1).max(128),
    newPassword: passwordSchema,
  })
  .strict();

export const authUserSchema = z
  .object({
    email: z.string(),
    emailVerifiedAt: z.iso.datetime().nullable(),
    id: z.uuid(),
    platformRole: z.enum(["customer", "admin"]),
    status: z.enum(["pending", "active", "suspended", "disabled"]),
  })
  .strict();

export const meResponseSchema = z
  .object({
    user: authUserSchema,
  })
  .strict();

export const loginResponseSchema = meResponseSchema;

export const acceptedResponseSchema = z
  .object({
    status: z.literal("accepted"),
  })
  .strict();

export const verifyEmailResponseSchema = z
  .object({
    status: z.literal("verified"),
  })
  .strict();

export const resetPasswordResponseSchema = z
  .object({
    status: z.literal("password_reset"),
  })
  .strict();

export const changePasswordResponseSchema = z
  .object({
    status: z.literal("password_changed"),
  })
  .strict();

export const sessionSummarySchema = z
  .object({
    createdAt: z.iso.datetime(),
    current: z.boolean(),
    deviceSummary: z.string(),
    id: z.uuid(),
    lastSeenAt: z.iso.datetime(),
  })
  .strict();

export const sessionListResponseSchema = z
  .object({
    sessions: z.array(sessionSummarySchema),
  })
  .strict();

export const apiErrorSchema = z
  .object({
    code: z.string(),
    message: z.string(),
  })
  .strict();

export type RegisterRequest = z.infer<typeof registerRequestSchema>;
export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type VerifyEmailRequest = z.infer<typeof verifyEmailRequestSchema>;
export type ForgotPasswordRequest = z.infer<typeof forgotPasswordRequestSchema>;
export type ResetPasswordRequest = z.infer<typeof resetPasswordRequestSchema>;
export type VerifyEmailResponse = z.infer<typeof verifyEmailResponseSchema>;
export type ResetPasswordResponse = z.infer<typeof resetPasswordResponseSchema>;
export type ChangePasswordResponse = z.infer<
  typeof changePasswordResponseSchema
>;
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;
export type AuthUser = z.infer<typeof authUserSchema>;
export type MeResponse = z.infer<typeof meResponseSchema>;
export type LoginResponse = z.infer<typeof loginResponseSchema>;
export type AcceptedResponse = z.infer<typeof acceptedResponseSchema>;
export type SessionSummary = z.infer<typeof sessionSummarySchema>;
export type SessionListResponse = z.infer<typeof sessionListResponseSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;
