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
      await transport.sendMail({
        from: input.from,
        subject: message.subject,
        text: message.text,
        to: message.to,
      });
    },
  };
}
