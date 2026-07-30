import { createTransport, type Transporter } from "nodemailer";

export interface AuthEmailMessage {
  subject: string;
  text: string;
  to: string;
}

export interface AuthEmailer {
  send(message: AuthEmailMessage): Promise<void>;
}

export interface SmtpEmailer extends AuthEmailer {
  close(): void;
}

export class PermanentEmailError extends Error {
  constructor() {
    super("The email provider permanently rejected the recipient.");
    this.name = "PermanentEmailError";
  }
}

export function createSmtpEmailer(input: {
  from: string;
  smtpUrl: string;
}): SmtpEmailer {
  const transport: Transporter = createTransport(input.smtpUrl);
  return {
    close(): void {
      transport.close();
    },
    async send(message: AuthEmailMessage): Promise<void> {
      try {
        await transport.sendMail({
          from: input.from,
          subject: message.subject,
          text: message.text,
          to: message.to,
        });
      } catch (error) {
        if (
          typeof error === "object" &&
          error !== null &&
          "responseCode" in error &&
          typeof error.responseCode === "number" &&
          error.responseCode >= 500 &&
          error.responseCode < 600
        ) {
          throw new PermanentEmailError();
        }
        throw error;
      }
    },
  };
}
