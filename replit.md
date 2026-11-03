# Replit setup

## Run the app

Use the **Start application** workflow. It runs:

```bash
python -m uvicorn backend.main:app --host 0.0.0.0 --port 5000
```

Check `GET /healthz` to confirm the selected storage. The app uses PostgreSQL when Replit provides `DATABASE_URL`; otherwise, it falls back to a local SQLite file. PostgreSQL was confirmed for the current development run.

## Deployment

The existing `.replit` deployment configuration starts the app on port 8000, turns off the local terminal, and enables private workspaces. Confirm the deployment uses PostgreSQL before publishing if saved work must survive republishing; local SQLite data is not durable across publishes.
