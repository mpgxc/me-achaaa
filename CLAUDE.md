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
4. **`ImageExtractFace`** (`image-extract-face.ts`) — crops each indexed face with `sharp` (subject to `extractFacePicturePolicy`: confidence ≥ 99, sharpness & brightness ≥ 60), saves to `uploads/faces/{collectionId}/{faceId}.jpg`, and writes `FACE#` records to DynamoDB.
5. **`ImageThumbnailGenerator`** (`image-thumbnail-generator.ts`) — resizes + tiles a watermark (`assets/watermark.png`), saves to `uploads/thumbnails/...`.
6. **`FailureNotification`** (`failure-notification.ts`) — subscribes to all three DLQs and posts the failed message to a Discord webhook (`DISCORD_WEBHOOK_URL`).

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
- **Auth & multi-tenancy** (`picture-album-manager/auth/`): all `/albums*` routes require an API key (`Authorization: Bearer <key>` or `x-api-key`) resolved to a tenant by `apiKeyAuth`; each album operation is scoped to the caller's tenant via `service.getAlbum(...).tenantId`. Tenant provisioning (`POST /tenants`) is guarded by the `ADMIN_API_KEY` env secret (`adminAuth`, timing-safe compare). Keys are generated with a `sls_` prefix and persisted only as a SHA-256 hash.
- **S3 key layout:** `uploads/incoming/`, `uploads/faces/`, `uploads/thumbnails/`, each namespaced by `{collectionId}`.
- **SQS batch handlers** return `{ batchItemFailures }` (`ReportBatchItemFailures`) so only failed messages are retried; per-message errors are caught and pushed to that array rather than thrown.
- **Batched writes:** DynamoDB writes use `TransactWriteItemsCommand` chunked via `splitBatches` (`app/helpers/commons.ts`); the per-transaction cap is 50 items.
- **`sharp` Lambda layer:** `sharp` is deployed as a native layer (`layers/sharp/`), attached only to `ImageExtractFace` and `ImageThumbnailGenerator`. If you add another Lambda that needs `sharp`, attach the layer in `serverless.yml`.

## Testing

Tests are **colocated** as `*.test.ts` beside each handler (Vitest, no separate config file — defaults). They import the pure/exported functions directly (e.g. `extractFacePicturePolicy`, `extractExternalImageId`), so keep such testable logic exported from the handler module. There are no live AWS integration tests.

## Gotchas

- `scripts/development.ts` is an ad-hoc local experimentation script (has a top-level IIFE that hits real S3) — **not** a deployed handler; don't wire it into `serverless.yml`.
- `app/handlers/generate-upload-url.ts` is a standalone handler that is **not referenced** in `serverless.yml`; the live upload-URL logic is the `PictureAlbumManager` route. Prefer the album-manager route.
- `package.yml` (serverless `package.patterns`) references a `dist/app/handlers/**` path while the build actually emits to `build/` — verify packaging paths if a deploy ships empty/missing handlers.
