# KKU ParkFlow ER Diagram

`supabase.sql` is the canonical production schema for the deployed frontend. The older `db/schema.sql` is retained only for the legacy Express/PostgreSQL demo and is not the schema used by the Supabase client.

```mermaid
erDiagram
    AUTH_USERS ||--|| PROFILES : "has profile"
    PROFILES ||--o{ REPORTS : submits
    PROFILES ||--o{ REPORTS : reviews
    PROFILES ||--o{ VEHICLE_REGISTRY : owns
    VEHICLE_REGISTRY ||--o{ PENALTIES : receives
    REPORTS ||--o{ PENALTIES : results_in
    REPORTS ||--o{ APPEALS : challenged_by
    PROFILES ||--o{ APPEALS : submits
    PROFILES ||--o{ APPEALS : decides
    PROFILES ||--o{ AUDIT_LOGS : creates
    PENALTY_RULES ||--o{ PENALTIES : guides

    AUTH_USERS {
        uuid id PK
        text email
    }
    PROFILES {
        uuid id PK,FK
        text email
        text name
        text role
    }
    REPORTS {
        uuid id PK
        uuid reporter_id FK
        uuid reviewed_by FK
        text plate_number
        text location
        numeric latitude
        numeric longitude
        text evidence_path
        text status
        numeric ai_confidence
    }
    VEHICLE_REGISTRY {
        uuid id PK
        text plate_number UK
        text owner_name
        text owner_email
        uuid owner_user_id FK
        boolean active
    }
    PENALTY_RULES {
        uuid id PK
        text violation_type UK
        integer points
        numeric fine_amount
        integer threshold_points
    }
    PENALTIES {
        uuid id PK
        uuid vehicle_id FK
        uuid report_id FK
        uuid rule_id FK
        integer points
        numeric fine_amount
    }
    APPEALS {
        uuid id PK
        uuid report_id FK
        uuid appellant_id FK
        uuid decided_by FK
        text status
    }
    AUDIT_LOGS {
        bigint id PK
        uuid actor_id FK
        text action
        uuid entity_id
        jsonb metadata
    }
```

## Notes

- `auth.users` is managed by Supabase Auth; `profiles.id` must equal `auth.users.id`.
- Reporter identity is not exposed through the public report list; RLS restricts normal users to their own reports.
- Admin access is determined by `profiles.role` (`admin` or `super_admin`).
- `tester` is a restricted role and does not receive admin access.
- Evidence files belong in the private `evidence` Storage bucket and should never be made public.
