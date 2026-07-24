# Contracts

`@event-ticketing/contracts` defines public request and response schemas shared
by the web and API applications. It does not expose database records or own
domain persistence.

Import schemas and their inferred TypeScript types from
`@event-ticketing/contracts`. The foundation slice exports the API status
response contract.

## Dependencies and configuration

The package uses Zod and has no runtime configuration. Applications must parse
untrusted values with the exported schema before using them.

## Test

```bash
pnpm --filter @event-ticketing/contracts test
```

See the [system architecture](../../docs/architecture/system.md) and
[engineering standards](../../docs/engineering/standards.md).
