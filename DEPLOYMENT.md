# Hosting and recovery preparation

This is deployment preparation, not a completed public launch. The application still runs locally. The supplied single-instance Docker configuration uses an external authenticated MongoDB database, a permanent private upload volume, Caddy HTTPS and Node 24. Event email delivery stays disabled. Docker Compose configuration was validated locally; the Docker engine was inaccessible in this session, so an actual container build/start and public TLS check remain deployment-host checks.

## Production configuration

1. Use a Linux Docker host with Compose v2, private disk capacity, an authenticated MongoDB database and an explicit application database in its URI. Restrict database access to the host. Keep the database and its credentials outside the repository.
2. Copy `deploy/.env.example` to `deploy/.env`. Set `APP_DOMAIN` to the real hostname (without a protocol/path), and give the release a distinct `APP_IMAGE_TAG`.
3. Create `deploy/secrets/mongo_uri.txt` containing only the private MongoDB URI, and `deploy/secrets/session_secret.txt` containing at least 32 random characters. Restrict access to these files. They are ignored by Git and excluded from the build context. The app supports `MONGO_URI_FILE` and `JWT_SECRET_FILE`; configure either a value or its file, never both.
4. Point DNS at the host and allow inbound 80/443 for Caddy. The app and database have no published container port. Caddy uses a dedicated internal proxy subnet. If `172.30.91.0/24` conflicts with your network, change both its IPAM subnet and the app's exact `TRUST_PROXY` subnet together.
5. From the repository root:

   ```sh
   docker compose --env-file deploy/.env config --quiet
   docker compose --env-file deploy/.env build app
   docker compose --env-file deploy/.env up -d
   docker compose --env-file deploy/.env ps
   ```

6. Check `https://<your-host>/api/health/ready` and the normal login/project flow before announcing availability. Create an administrator with the existing admin CLI only when the operator authorizes the actual account. Do not seed demo accounts into production.

The app image runs as a non-root user with a read-only root filesystem. Only its private upload volume and temporary directory are writable. Named volumes preserve uploads and Caddy certificates across ordinary container replacement. **Do not use `docker compose down -v`**, which removes persistent volumes. Local volumes do not provide replication or off-site recovery. This topology supports one app instance; live event delivery is process-local, so multiple app instances need shared event delivery before scaling.

## Health and shutdown

- `/api/health/live`: HTTP process is alive. Returns 503 while draining.
- `/api/health/ready`: MongoDB ping and private storage path/access are available. Returns 503 on failure. This check does not measure free disk space or exercise a full workflow.
- `/api/health`: existing database-connectivity endpoint retained for compatibility.
- `node backend/scripts/checkHealth.js https://<your-host>` returns a nonzero exit code on failure and can be used by an external uptime monitor.
- SIGTERM/SIGINT stop accepting requests, disconnect live streams and stop the email timer, then drain HTTP and disconnect MongoDB. A 25-second deadline prevents indefinite shutdown. Compose grants 30 seconds.

Configure real alert recipients, disk monitoring, MongoDB provider backups and off-site encrypted backup storage on the actual host. No recurring automation or external alert has been silently created.

## Offline backup

`backend/scripts/recovery.js` needs no extra database-tool installation. It streams canonical Extended JSON through gzip, preserves BSON types, records collection/index options, copies private upload bytes and writes SHA-256/size manifests. It supports ordinary application collections, not views/time-series/system collections. Use managed MongoDB snapshots for unsupported database features or larger installations.

**Stop every app instance, worker, cleanup job and other database writer first.** `--offline-confirmed` is an operator acknowledgement of this requirement, not a distributed lock. The tool probes the supplied app URL and refuses a responding app. No online consistency claim is made. An unmanifested/failed backup is incomplete and must not be used.

For a direct Node installation, from `backend` with the correct private environment:

```sh
node scripts/recovery.js backup --directory /secure/backups/snapshot-2026-10-22 --uploads /private/uploads --app-url http://127.0.0.1:5000 --offline-confirmed
node scripts/recovery.js verify --directory /secure/backups/snapshot-2026-10-22
```

For Compose, stop the app first and use the same image/volume, with a private host backup directory writable by the container's node user (UID 1000):

```sh
docker compose --env-file deploy/.env stop app
docker compose --env-file deploy/.env run --rm --no-deps -v /secure/backups:/backups app node scripts/recovery.js backup --directory /backups/snapshot-2026-10-22 --app-url http://app:5000 --offline-confirmed
docker compose --env-file deploy/.env up -d app
```

Inspect the backup command's exit code before treating a snapshot as complete. A destination must be new. Missing recorded attachment bytes cause backup failure. Snapshot files contain personal/project information, are not encrypted by this tool and must stay private. Keep encrypted off-site copies and periodically rehearse recovery. Secrets and `.env` files are not part of the snapshot.

## Restore preview and apply

Restore always targets a **new, empty** database named `freelancechain_restore_<name>` and a **new** private upload directory with an existing real parent. It never drops collections, deletes uploads, overwrites a production database or changes the current app configuration. Integrity checks run before import. Session/rate-limit collections are deliberately excluded. Restore invalidates old recovery/email-change links and increments session versions; pending event emails become skipped to avoid replaying old mail.

Privately configure `RESTORE_MONGO_URI` for the fresh target (or `RESTORE_MONGO_URI_FILE`). From `backend`:

```sh
node scripts/recovery.js restore --directory /secure/backups/snapshot-2026-10-22 --uploads /private/restored-uploads
node scripts/recovery.js restore --directory /secure/backups/snapshot-2026-10-22 --uploads /private/restored-uploads --app-url http://127.0.0.1:5000 --offline-confirmed --apply
```

The first command is a preview. The second imports only after the app is stopped. A failed import leaves its partial target for investigation; retry using a different fresh database/directory. Check record counts, index constraints and attachment downloads on an isolated instance before switching production to the restored URI and upload directory. Rotate the session secret at the actual cutover. Keep the old database, image and upload volume until the operator verifies recovery.

## Release rollback

Retain the previous image tag and a verified pre-release snapshot. If code rollback is compatible with the current schema, change `APP_IMAGE_TAG` to the retained tag and recreate the app **without rebuilding that tag**. Check readiness and login/delivery flows. For incompatible data changes, use a fresh-target restore and review the cutover. Never reset the database or remove volumes as a rollback shortcut.

## Evidence and remaining work

Focused local recovery checks verify BSON round-trip, indexes, file hashes, refused overwrites, running-app refusal, old-session/recovery invalidation, readiness failure and drain status using disposable test data. This is not an off-site backup or a production disaster recovery rehearsal. Hosting credentials, actual DNS/HTTPS, host/container startup, alert destinations, production policy review, capacity testing and email provider verification remain operator deployment work.

References: [Node release policy](https://nodejs.org/en/about/previous-releases), [Compose dependency health checks](https://docs.docker.com/compose/how-tos/startup-order/), [Compose services](https://docs.docker.com/reference/compose-file/services/), [Caddy automatic HTTPS](https://caddyserver.com/docs/automatic-https), [MongoDB Extended JSON](https://www.mongodb.com/docs/manual/reference/mongodb-extended-json/).
