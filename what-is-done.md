# AetherSpec Projects Frontend — What Is Done

> Branch: `feat/projects-frontend`  
> Last deployed build: `index-Bj1qAddH.js` / `index-BmBdnwwo.css` on `https://aetherspec.ai`

## 1. Backend Foundation (deployed on Hetzner)

- PostgreSQL schema: `projects`, `documents`, `document_steps`, `attachments`.
- MinIO bucket `aetherspec-artifacts` seeded with per-project template folders.
- Gateway (Go/Fiber) exposing TMF-compliant endpoints:
  - `GET/POST/PATCH/DELETE /api/project`
  - `GET/POST /api/document`
  - `GET/PATCH/POST /api/document/{id}/step/{step}`
  - `POST /api/document/{id}/step/{step}/approve`
- Anonymous auth mode is still enabled (`KeycloakAuth` stub), so all API calls succeed without tokens.

## 2. ProjectHub (deployed and working)

- Fetches real projects from `/api/project`.
- Active project is persisted in `localStorage` (`aetherspec.activeProjectId`) and survives navigation/reload.
- Header dropdown now shows the real project list and the selected active project.
- Studio tab in the header opens the active project at its current BRS step.
- Pipeline bars in project cards show real `currentStep / totalSteps` from the backend.
- New project creation works (calls `POST /api/project`, then reloads the page).

## 3. Aether Studio — Current (temporary) implementation

Because the original Studio was a read-only placeholder with broken step links, a minimal working Studio was added:

- Two-pane layout: left step sidebar, right editor area.
- Step sidebar is clickable and navigates to `?step=N`.
- Studio defaults to the document’s `currentStep` instead of always step 1.
- "Current" badge shown on the step matching `document.currentStep`.
- Textarea editor for step content.
- **Save** button → `PATCH /api/document/{id}/step/{step}` with `{content, status: "IN_PROGRESS"}`.
- **Approve** button → `POST /api/document/{id}/step/{step}/approve`; on success it advances to `nextStep`.
- i18n strings added for English and Turkish.

## 4. Deployment / Env

- `apps/web/.env.production` created with production API/Keycloak URLs.
- Build uses `https://api.aetherspec.ai` (no more `localhost:3000`).
- Deploy script is manual SCP to `root@157.180.57.246:/var/www/aetherspec/` followed by deleting stale hashed assets.

## 5. Known gaps / design decision needed

The current Studio design is intentionally minimal and temporary. The target design (see screenshot shared by product) is a full VS Code-style IDE:

- Left sidebar sections: Workspace File Explorer, Generated Specs, Template Flow Stepper.
- Top tabs switching between BRS / SRD-SDD / Test Cases.
- Center pane: Source/Split view with rendered markdown / Mermaid preview.
- Validation findings badge.
- "Approve Step & Advance" primary action.
- Right sidebar: AI Agent Chat Window with model selector, skill messages, Approve/Revise actions.
- Multi-persona sign-off workflow.

## 6. Data quality note

During testing, step 1 of `AEDLC` BRS (`doc-010`) was approved and then manually reset via API, leaving `approvedAt` populated while `status` is `NOT_STARTED`. This is inconsistent but does not block normal usage; the frontend now uses `document.currentStep` as the source of truth for the "current" step.

## 7. Files changed in this branch

- `apps/web/src/components/ProjectHubPage.tsx` — owns project fetching + persistence.
- `apps/web/src/components/ProjectHub.tsx` — receives projects via props, creates projects.
- `apps/web/src/components/Header.tsx` — shows real project dropdown, studio nav.
- `apps/web/src/components/AetherStudio.tsx` — current temporary Studio UI.
- `apps/web/src/routes/studio.tsx` — `step` search param is now a number.
- `apps/web/src/lib/project-storage.ts` — `localStorage` helpers for active project.
- `apps/web/src/i18n/locales/en.json`, `tr.json` — new Studio strings.
- `apps/web/.env.production` — production build config.

## 8. Suggested next steps (for designer/agent)

1. Decide whether to keep the temporary two-pane Studio or replace it with the full VS Code Studio design.
2. If replacing: provide/design the component structure, CSS classes, and iconography for the target layout.
3. Clarify the Studio workflow:
   - Should Approve auto-advance to the next step?
   - Should Save mark a step `IN_PROGRESS` or stay `NOT_STARTED`?
   - How should validation findings be displayed and triggered?
   - Which AI agent endpoints should the chat panel call?
4. Decide when to implement real Keycloak JWT validation (currently anonymous).
