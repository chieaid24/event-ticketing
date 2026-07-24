# SeatFlow Design System

Every agent changing frontend behavior reads and follows this file. Change the
system through a pull request instead of inventing feature-specific styles.

## Register

SeatFlow is a product interface. Design serves fast, legible decisions across
event discovery, checkout, venue operations, and dense organizer workflows.
Marketing surfaces may be expressive, but they use the same tokens.

## Voice and tone

- Personality: composed, direct, and alert.
- Avoid stadium-neon spectacle, marketplace clutter, generic purple SaaS
  dashboards, and finance-style luxury.
- State inventory, payment, and scanner outcomes plainly. Do not create urgency
  with manipulative copy.

## Color

- Strategy: restrained. Tinted neutrals carry the interface; copper is used on
  less than 10 percent of a screen.
- Space: OKLCH with warm-tinted neutrals and reduced chroma near lightness
  extremes.
- Light background: `oklch(0.975 0.008 65)`.
- Light surface: `oklch(0.995 0.004 65)`.
- Dark background: `oklch(0.17 0.012 45)`.
- Dark surface: `oklch(0.22 0.014 45)`.
- Text: `oklch(0.22 0.015 45)` light and `oklch(0.94 0.008 65)` dark.
- Muted text: `oklch(0.48 0.018 45)` light and `oklch(0.72 0.014 65)` dark.
- Border: `oklch(0.86 0.014 60)` light and `oklch(0.34 0.018 45)` dark.
- Accent: `oklch(0.62 0.16 42)` for primary actions, selected seats, and focus.
- Success: `oklch(0.62 0.14 150)`.
- Warning: `oklch(0.72 0.14 80)`.
- Danger: `oklch(0.58 0.19 25)`.
- Theme: light and dark. A customer selects seats on a phone in daylight, an
  organizer works for hours in an office, and scanner staff validate tickets in
  a dim venue while moving quickly.

Never use color as the only status signal.

## Typography

- Heading font: Source Serif 4 from Google Fonts or a self-hosted package.
- Body font: Source Sans 3 from Google Fonts or a self-hosted package.
- Scale: 0.8, 1, 1.25, 1.563, 1.953, and 2.441 rem.
- Maximum body measure: 70ch.
- Use tabular numbers for money, inventory, times, and operational metrics.
- Create hierarchy with size and weight before adding color.

## Layout and spacing

- Spacing scale: 4, 8, 12, 16, 24, 32, 48, and 64 px.
- Use dense spacing for tables and scanner controls, moderate spacing for forms,
  and generous spacing between page sections.
- Constrain prose and checkout forms. Let maps, tables, timelines, and
  dashboards use the available viewport.
- Use a card only when an object needs a selectable or movable boundary. Do not
  nest cards.
- Start responsive decisions at content needs near 480, 768, 1024, and 1280 px.
- Keep checkout and scanner primary actions reachable with one hand.

## Elevation

Use borders and background tints. Do not mix this approach with decorative
shadow stacks.

## Motion

- Use ease-out quint curves.
- Use about 120 ms for feedback and 240 ms for view transitions.
- Animate opacity and transforms, not layout properties.
- Do not use bounce or elastic motion.
- Honor reduced-motion preferences.

## Components

Document canonical buttons, inputs, tables, tabs, toasts, seat states, scanner
results, countdowns, and empty states as implementation stabilizes.

## Absolute bans

- Side-stripe accent borders
- Gradient text
- Default glassmorphism
- Hero metric templates
- Repeated identical card grids
- Modal-first interaction design
- Nested cards
- Em dashes in UI copy

Ship no interface that looks predictable from the event-ticketing category
alone. Rework obvious neon, confetti, or stadium-light themes before review.
