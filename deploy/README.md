# Production

Site: https://businesscup.toilap.com/app

SSH: `ssh 35.228.54.76` (user `amanzholov`). The existing Nginx virtual host and TLS certificate proxy to `127.0.0.1:8000`.

- Service: `business-cup.service`, enabled at boot.
- Active release: `/home/amanzholov/storyfork/current`.
- Release directory: `/home/amanzholov/storyfork/releases/20261115-webapp`.
- Persistent database/media: `/home/amanzholov/storyfork/shared/data`.
- Private environment: `/home/amanzholov/storyfork/shared/production.env`.
- Private Vertex credentials: `/home/amanzholov/storyfork/shared/vertex-credentials.json`.
- Browser: headless-only Chromium under `/home/amanzholov/storyfork/shared/browsers`.
- Node: `/home/amanzholov/.local/share/storyfork/node24` with launchers in `~/.local/bin`.

Credentials and generated data are outside the release's public directories. Keep environment and credential files mode0600. A release includes prebuilt frontend files; frontend dependencies are not installed on the server. Only one app process uses the database. Generation concurrency is1 and the anonymous/IP limit is12 jobs per hour.

Useful commands:

```sh
sudo systemctl status business-cup --no-pager
sudo journalctl -u business-cup -n 100 --no-pager
sudo systemctl restart business-cup
```

The previous deployment at `/home/amanzholov/business-cup` is retained. Its original systemd configuration is backed up at `/home/amanzholov/storyfork/shared/business-cup.service.before-20261115-webapp`.

Rollback to the previous deployment:

```sh
sudo cp /home/amanzholov/storyfork/shared/business-cup.service.before-20261115-webapp /etc/systemd/system/business-cup.service
sudo systemctl daemon-reload
sudo systemctl restart business-cup
```

For subsequent releases, upload a separate directory, create its Python environment, install the locked generator dependencies, verify it on a private port, stop that preview to release the database lock, then switch `current` and restart the service. Preserve `shared` and existing releases. Do not start a second server against the same database.
