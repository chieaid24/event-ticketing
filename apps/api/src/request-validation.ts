import { HttpException } from "@nestjs/common";
import type { output, ZodType } from "zod";

export const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function apiError(status: number, code: string, message: string): never {
  throw new HttpException({ code, message }, status);
}

export function parseRequest<S extends ZodType>(
  schema: S,
  input: unknown
): output<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.join(".") ?? "";
    apiError(
      400,
      "invalid_request",
      path ? `The field "${path}" is invalid.` : "The request body is invalid."
    );
  }
  return parsed.data;
}
