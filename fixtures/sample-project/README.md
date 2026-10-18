# sample-project

Repograph's built-in sample. Known answers, used by tests:

- 4 languages: TypeScript + JavaScript (`web/`), Python (`backend/`), Java (`jobs/`).
- One import cycle: `web/src/state/store.ts` → `web/src/ui/render.ts` → `web/src/ui/format.js` → back to `store.ts`.
- ORM entities: SQLAlchemy `Customer` (`backend/models.py`), JPA `Order` (`jobs/.../model/Order.java`).
- `BaseJob` is subclassed by `CleanupJob` in its own package (no import) — it must not be reported as "possibly unused".
- Test files: `web/src/api/client.test.ts`, `backend/tests/test_routes.py`, `jobs/src/test/java/com/example/jobs/ReportJobTest.java`.
