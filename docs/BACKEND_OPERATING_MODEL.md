# Backend Operating Model

Primary purpose:
Detect Korea-port hull-cleaning candidates as early as possible.

Principles:
- Public/MOF/port data first.
- Paid AIS optional.
- Optional source failure must not break the whole update.
- Empty outputs should not replace the last valid snapshot.
- Install can be slow; update must stay bounded.
