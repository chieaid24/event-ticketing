# Test Utilities

`@event-ticketing/test-utils` contains deterministic helpers shared by unit,
integration, and concurrency tests. It does not contain product fixtures,
application behavior, or test-runner configuration.

Import `createDeferred` from `@event-ticketing/test-utils` when a test must
control the completion order of concurrent operations.

## Dependencies and configuration

The package has no runtime dependency or configuration.

## Test

```bash
pnpm --filter @event-ticketing/test-utils test
```

See the [testing strategy](../../docs/testing/strategy.md).
