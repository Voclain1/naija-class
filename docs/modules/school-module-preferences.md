# School module preferences

Shipped in UX simplification sprint 1. The purpose is progressive disclosure:
a small school should not have to understand every SchoolKit product area
before it can take attendance, collect fees or produce results.

## Behaviour

- New schools start with Students, Fees & payments, Attendance, Results &
  report cards, and Parent communication.
- Owners can open **Settings → School modules** (or **Explore modules** in the
  menu) and turn optional areas on when needed.
- A module choice filters the admin menu, command search and dashboard daily
  tasks. It does not delete records, change permissions or disable API routes.
- At least one area must remain selected.
- Existing schools have `module_preferences = NULL`. That deliberately means
  “show everything” until the school makes its first explicit choice, avoiding
  a surprise menu regression during rollout.

The persisted shape is `{ "selected": SchoolModuleKey[] }`. It is parsed at
the API boundary; invalid legacy JSON falls back to the compatibility state.

## Scope boundaries

This is a presentation preference, not licensing, authorization or data
retention. Permission checks remain authoritative. Hidden areas can be shown
again with their records intact. Plan entitlement must not be implemented by
changing this field.
