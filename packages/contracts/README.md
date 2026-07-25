# Contracts

`@event-ticketing/contracts` defines public request and response schemas shared
by the web and API applications. It does not expose database records or own
domain persistence.

Import schemas and their inferred TypeScript types from
`@event-ticketing/contracts`. Exports cover the API status, authentication,
organization, and venue contracts. Venue layouts additionally export
`validateVenueLayout`, the semantic rule check both the organizer UI and the API
run so validation summaries match the enforcement point.

## Dependencies and configuration

The package uses Zod and has no runtime configuration. Applications must parse
untrusted values with the exported schema before using them.

## Test

```bash
pnpm --filter @event-ticketing/contracts test
```

See the [system architecture](../../docs/architecture/system.md) and
[engineering standards](../../docs/engineering/standards.md).
