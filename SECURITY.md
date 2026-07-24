# Security Policy

This is a public repository. Treat every committed file, Git object, pull
request, issue, workflow log, test artifact, and release as internet-visible.

## Report a vulnerability

Do not open a public issue with exploit details, credentials, personal data, or
payment data. Use GitHub private vulnerability reporting when it is available.
If private reporting is unavailable, contact the repository owner privately
before disclosure.

## Repository rules

- Never commit secrets, credentials, tokens, private keys, webhook secrets,
  production URLs containing credentials, or real customer data.
- Use `.env.example` files with unmistakably fake values.
- Assume deleting a secret from the latest commit does not remove it from Git
  history. Revoke and rotate an exposed credential immediately.
- Keep security-fix issue titles, branches, commits, and pull requests neutral.
- Use synthetic data in tests, screenshots, fixtures, logs, and load reports.
- Redact session tokens, reset tokens, QR bearer values, authorization headers,
  cookies, payment payloads, and personal information from logs.

See [docs/security/security-model.md](docs/security/security-model.md) for the
application threat model and required controls.
