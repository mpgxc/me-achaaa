# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

`sls-find.me` is a **Face Search Engine** built on AWS Rekognition and a Serverless (AWS Lambda + API Gateway) architecture. Users upload photos into per-album Rekognition "collections"; the system indexes faces, crops individual face images, generates watermarked thumbnails, and exposes REST endpoints to search for similar faces. Code comments and user-facing API messages are written in **Portuguese (pt-BR)** — keep new strings consistent with that.

## Commands

- **Build:** `npm run build` — cleans `build/`, runs `tsc --build`, and copies `assets/*.png` into `build/`. Serverless function handlers point at the compiled output under `build/handlers/...`, so a build is required before local run or deploy.
- **Local dev:** `npm run dev` (alias `npm run start:dev`) — `nodemon` + `serverless offline` on `0.0.0.0:4000`.
- **Test (watch):** `npm test` — Vitest, verbose reporter.
- **Single test file:** `npx vitest run app/handlers/image-extract-face.test.ts`
- **Single test by name:** `npx vitest run -t "parses collectionId"`
- **Coverage:** `npm run coverage`
- **Lint/format:** `npm run lint` — `biome check --write` (auto-fixes). Biome config uses **tabs** and **double quotes**; match it.
- **Deploy:** `npm run deploy:dev` / `deploy:hml` / `deploy:prd` — `sls deploy --stage <dev|hml|prd>`.

**Package manager:** both `package-lock.json` and `pnpm-lock.yaml` exist, but CI (`.github/workflows/deploy.yml`) uses `npm ci` — treat **npm** as canonical. Node is pinned to `v22.11.0` (`.nvmrc`) locally, but Lambdas run on the `nodejs20.x` runtime.

## Architecture

This is an **event-driven pipeline**, not a monolithic API. An upload triggers a fan-out chain of SQS-decoupled Lambdas. Understanding the flow requires tracing S3 → SQS → Lambda → DynamoDB, which spans `serverless.yml` and `app/handlers/`.

### Ingestion & processing flow

1. **Upload** — client gets a presigned S3 PUT URL (via `PictureAlbumManager`'s `/albums/{id}/upload-url` route) and uploads to `uploads/incoming/{collectionId}/{imageId}.jpg`.
2. **S3 event → SQS** — `s3:ObjectCreated` on `uploads/incoming/*.jp(e)g` pushes to `FaceRecognitionQueue`.
3. **`DetectAndIndexFaces`** (`picture-index-processing.ts`) — consumes the queue in batches, calls Rekognition `IndexFaces`, writes `IMAGE#` metadata to DynamoDB, then **fans out** to two more queues: `ImageExtractFaceQueue` and `ImageGenerateThumbnailQueue`.
4. **`ImageExtractFace`** (`image-extract-face.ts`) — crops each indexed face with `sharp` (subject to `extractFacePicturePolicy`: confidence ≥ 99, sharpness & brightness ≥ 60), saves to `uploads/faces/{collectionId}/{faceId}.jpg`, writes `FACE#` records to DynamoDB, and emits an `image.processed` event to `NotificationQueue`.
5. **`ImageThumbnailGenerator`** (`image-thumbnail-generator.ts`) — resizes + tiles a watermark (`assets/watermark.png`), saves to `uploads/thumbnails/...`.
6. **`NotificationDispatcher`** (`notification-dispatcher.ts`) — consumes `NotificationQueue`, resolves the tenant's `webhookUrl` (collection → album → `TenantId` → tenant), and POSTs the completion event to it (SQS retry + DLQ for reliable delivery). The webhook URL is set on the tenant at provisioning (`POST /tenants` `webhookUrl`).
7. **`FailureNotification`** (`failure-notification.ts`) — subscribes to all DLQs (including `NotificationQueueDLQ`) and posts the failed message to a Discord webhook (`DISCORD_WEBHOOK_URL`).

### Synchronous HTTP surfaces

- **`PictureAlbumManager`** (`picture-album-manager/`) — a single **Hono `OpenAPIHono` app** wrapped with `hono/aws-lambda`'s `handle()`, serving the whole synchronous surface: `/tenants` (provisioning), `/albums*` (album CRUD, upload URLs, and per-face erasure — `DELETE /albums/{id}/faces/{faceId}` removes the face from Rekognition + S3 + DynamoDB for LGPD right-to-erasure), and `/search` + `/search/by-face-id` (face search). This is the only handler using a framework/router; routes are declared in `*.openapi.ts` (Zod schemas), wired in `*.routes.ts`, and logic lives in `*.service.ts`. Face search now runs **inside** this authenticated app (`search/`, requires the `x-collection-id` header and tenant ownership) — the old standalone `picture-search.ts` Lambdas were removed. It self-serves Swagger UI (`/api/docs`) and Scalar (`/api/docs/scalar`) and starts a local `serve()` when not running inside Lambda (`!process.env.LAMBDA_TASK_ROOT`).

### Key conventions & shared code

- **Identity mapping:** `externalClientAlbumId` == Rekognition `CollectionId` == the album partition — all the same UUID. Album creation/deletion keeps the Rekognition collection, the DynamoDB metadata item, and an S3 placeholder folder in sync, with best-effort rollback on failure.
- **AWS client singletons** (`app/providers.ts`) — `RekognitionSingleton`, `DynamoSingleton`, `S3Singleton`, `SqsSingleton` are instantiated at module load so Lambda warm-starts reuse connections. The Dynamo/S3/SQS singletons **extend** their client and expose env-backed getters (`tableName`, `bucketName`, `queueUrl`) that throw if the env var is missing. Always go through these rather than `new`-ing clients directly.
- **DynamoDB single-table design** (table `...-rekognition-bucket-assets-controll`, `PK`/`SK`, plus a `SK-Index` GSI):
  - Album metadata → `PK=ALBUM#{id}`, `SK=METADATA` (carries `TenantId` for multi-tenant scoping)
  - Image → `PK=ALBUM#{id}`, `SK=IMAGE#{externalImageId}`
  - Face → `PK=ALBUM#{id}`, `SK=FACE#{faceId}`
  - Tenant → `PK=TENANT#{tenantId}`, `SK=METADATA`
  - API key → `PK=APIKEY#{sha256(key)}`, `SK=METADATA` (stores only the key **hash** → `TenantId`)
  - Search cache → `PK=SEARCHCACHE#{collectionId}`, `SK=HASH#{sha256(image)}` (cached `/search` result; auto-expired by DynamoDB TTL on the `ExpiresAt` attribute — avoids re-paying Rekognition for an identical selfie search)
  - Person cluster → `PK=ALBUM#{id}`, `SK=PERSON#{personId}` (materialized "browse by person": a cluster of faces of the same person; `personId` is the smallest `faceId` of the cluster; carries `FaceIds`, `Faces` (a `{faceId,imageId}` map used to prune one face without a full rebuild), `Images`, `CoverKey`, `FaceCount`, `PhotoCount`)
  - Rebuild status → `PK=ALBUM#{id}`, `SK=PERSONREBUILD#STATUS` (one row tracking the album's async cluster rebuild: `status` queued→running→done/failed, timestamps, `people`/`faces` counts, `error`)
  - Rebuild pending marker → `PK=ALBUM#{id}`, `SK=PERSONREBUILD#PENDING` (debounce token for the auto-rebuild: only the queued message whose `token` still matches this marker actually runs — coalesces a burst of uploads into one rebuild)
- **Browse by person** (`picture-album-manager/people/`): `PersonClusteringService.rebuild(collectionId)` groups the album's faces into people via union-find over Rekognition `SearchFaces` (`clusterFaces` is a pure, unit-tested function) and materializes `PERSON#` records. This is the **expensive** path (one `SearchFaces` per face), so it runs **asynchronously**: `POST /albums/{id}/people/rebuild` only enqueues to `PersonRebuildQueue` and returns `202` — the `PersonClusterRebuild` Lambda (`person-cluster-rebuild.ts`) consumes it and runs `processRebuild` (which flips the `PERSONREBUILD#STATUS` row running→done/failed); poll `GET /albums/{id}/people/rebuild/status`. Running it inline would blow the API Gateway's ~29s cap on large albums. It also runs **automatically after ingestion**: `ImageExtractFace` calls `scheduleAutoRebuild` for each affected collection, which **debounces** via a `PERSONREBUILD#PENDING` token + an SQS `DelaySeconds` message — a burst of uploads coalesces into a single rebuild once the album goes quiet (`runAutoRebuild` runs only the message whose token is still current). The worker (`processRebuild`) uses `rebuildIncremental`, which reads the existing `PERSON#` clusters as union-find seed edges and pays `SearchFaces` **only for faces not yet in any cluster** — O(new faces) instead of O(all) — falling back to the full `rebuild` when nothing was clustered yet, and no-op when there are no new faces. Incremental never *splits* an existing cluster, so use the full `rebuild` to correct drift. The rewrite (`materialize`) is a **diff + `TransactWriteItems`** (`splitBatches`, ≤100/tx): it deletes only the people that vanished and upserts the survivors in atomic batches — never a "delete-all then re-write" window that could expose partial clusters to a concurrent browse read. The **cheap, cacheable** read path — `GET /albums/{id}/people` and `GET /albums/{id}/people/{personId}/photos` — only reads the materialized records (no Rekognition), and sets `Cache-Control: public, max-age=300` + `Vary: Authorization`. A CloudFront distribution (`PeopleBrowseDistribution` in `serverless.yml`) fronts the whole API but caches **origin-driven** (`MinTTL/DefaultTTL = 0`), so only these `public` GET responses are cached at the edge — every other route (`private`/no-header, and all POST/DELETE) passes through. The cache key includes `Authorization`/`x-api-key`, so tenants get separate entries. Both reads are **paginated** (`limit` + opaque `cursor` query params; `nextCursor` in the response) — `/people` pages a DynamoDB Query, `/photos` slices the in-memory `Images` by offset; an undecodable cursor is a typed `InvalidCursorError` → `400`. These reads also enrich the records with **presigned S3 GET URLs** (`coverUrl` for the face crop, `photos[].url` for each watermarked thumbnail at `uploads/thumbnails/...`) so the frontend renders without direct bucket access — signed for 1h (> the 300s cache TTL, so a cached response never carries a near-expired URL). Selfie `/search` is the fallback that pays Rekognition.
- **Cache & cluster freshness (LGPD):** the `SEARCHCACHE#` and `PERSON#` records are **derived** data that must not outlive the faces they describe. Deleting a face (`DELETE /albums/{id}/faces/{faceId}`) best-effort invalidates the whole `SEARCHCACHE#{collectionId}` (`SearchCacheService.invalidate`) and prunes the face from its `PERSON#` cluster (`PersonClusteringService.removeFace` — reassigns the cover or drops the cluster). Indexing new faces (`ImageExtractFace`) also invalidates the collection's search cache (new photos would otherwise be missing from a cached search until TTL). These cleanups are best-effort (the erasure/index itself already succeeded; the cache TTL is the backstop) — a failure logs but does not fail the request/message.
- **Auth & multi-tenancy** (`picture-album-manager/auth/`): all `/albums*` routes require an API key (`Authorization: Bearer <key>` or `x-api-key`) resolved to a tenant by `apiKeyAuth`; each album operation is scoped to the caller's tenant via `service.getAlbum(...).tenantId`. Tenant provisioning (`POST /tenants`) is guarded by the `ADMIN_API_KEY` env secret (`adminAuth`, timing-safe compare). Keys are generated with a `sls_` prefix and persisted only as a SHA-256 hash.
- **S3 key layout:** `uploads/incoming/`, `uploads/faces/`, `uploads/thumbnails/`, each namespaced by `{collectionId}`.
- **SQS batch handlers** return `{ batchItemFailures }` (`ReportBatchItemFailures`) so only failed messages are retried; per-message errors are caught and pushed to that array rather than thrown.
- **Batched writes:** DynamoDB writes use `TransactWriteItemsCommand` chunked via `splitBatches` (`app/helpers/commons.ts`); the per-transaction cap is 50 items.
- **Structured logging:** use `app/logger.ts` (`logger.info/warn/error(msg, meta)`) — a zero-dependency JSON logger to stdout (CloudWatch Logs Insights queryable). `pino` is a dependency but is **not** packaged (`package.yml` only bundles `zod`/`sharp` from `node_modules`), so do **not** `import pino` in a handler — it would fail at runtime with "module not found".
- **SQS reliability:** processing queues use `maxReceiveCount: 3` (retry before DLQ). Never swallow an error into a "no-op" result inside an SQS handler — let it throw so the per-message `catch` pushes to `batchItemFailures` and the message is retried (see `picture-index-processing.ts`: a swallowed `IndexFaces` error used to ACK as "no faces" → silent data loss).
- **`sharp` Lambda layer:** `sharp` is deployed as a native layer (`layers/sharp/`), attached only to `ImageExtractFace` and `ImageThumbnailGenerator`. If you add another Lambda that needs `sharp`, attach the layer in `serverless.yml`.

## Testing

Tests are **colocated** as `*.test.ts` beside each handler (Vitest, no separate config file — defaults). They import the pure/exported functions directly (e.g. `extractFacePicturePolicy`, `extractExternalImageId`), so keep such testable logic exported from the handler module. There are no live AWS integration tests.

## Gotchas

- `scripts/development.ts` is an ad-hoc local experimentation script (has a top-level IIFE that hits real S3) — **not** a deployed handler; don't wire it into `serverless.yml`.
- `app/handlers/generate-upload-url.ts` is a standalone handler that is **not referenced** in `serverless.yml`; the live upload-URL logic is the `PictureAlbumManager` route. Prefer the album-manager route.
- `package.yml` (serverless `package.patterns`) references a `dist/app/handlers/**` path while the build actually emits to `build/` — verify packaging paths if a deploy ships empty/missing handlers.
