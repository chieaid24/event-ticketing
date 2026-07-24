# UI

`@event-ticketing/ui` provides accessible React primitives shared by product
interfaces. It does not own page layout, domain state, data fetching, or API
authorization.

Import `StatusBadge` from `@event-ticketing/ui`. Consumers provide design-token
styles for the stable class names and `data-status` attribute.

## Dependencies and configuration

The package requires React 19 and has no runtime configuration.

## Test

```bash
pnpm --filter @event-ticketing/ui test
```

See the [design system](../../DESIGN.md) and
[engineering standards](../../docs/engineering/standards.md).
