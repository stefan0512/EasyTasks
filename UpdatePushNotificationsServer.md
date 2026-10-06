# Update the PocketBase server for push notifications

The app can save notification preferences only if the PocketBase server has the required `users` fields and the notification hooks installed.

If those are missing, the app may look like it "does not save" the checkbox values, because the server rejects the update or ignores the fields.

## What the server must have

The app writes these user fields when you save notifications in the Settings screen:

- `PushTaskNew`
- `PushTaskDone`
- `PushTaskChanged`
- `PushOverUser`

These names are case-sensitive.

The server also needs the notification hooks in `pb_hooks`:

- `notify_tasks.pb.js`
- `push_notify.js`

Those hooks send the final Pushover messages.

---

## Recommended update path

### 1) Backup the current PocketBase data

Before changing the server schema, take a backup of the PocketBase data folder.

If you use Docker:

```bash
docker compose stop
cp -r ./pb_data ./pb_data_backup
```

If you run PocketBase directly, copy the folder containing `pb_data` and `pb_hooks`.

### 2) Add the fields to the `users` collection

Open the PocketBase Admin UI and go to:

- Collections
- `users`
- Fields

Add these fields:

| Field | Type | Notes |
| --- | --- | --- |
| `PushTaskNew` | Bool | New-task notifications |
| `PushTaskDone` | Bool | Completed or deleted task notifications |
| `PushTaskChanged` | Bool | Edited-task notifications |
| `PushOnlyAssigned` | Bool | Only notify about tasks assigned to the user |
| `PushOverUser` | Plain text | Your Pushover user key |

If your server already has them, verify the names exactly match the app.

### 3) Make sure authentication rules are correct

In the Admin UI:

- Collections → `users` → Options
- Enable the password auth method if it is disabled.

Recommended auth rule:

```text
verified = true
```

This prevents unverified users from logging in.

### 4) Install the notification hooks

Copy these files into the server's `pb_hooks` directory:

- `EasyTasks/pb_hooks/notify_tasks.pb.js`
- `EasyTasks/pb_hooks/push_notify.js`
- `EasyTasks/pb_hooks/users.pb.js` (the user list for assigning tasks)

If you run PocketBase in Docker, make sure the container mounts the hook folder:

```yaml
volumes:
  - ./pb_data:/pb/pb_data
  - ./pb_hooks:/pb/pb_hooks
```

Then restart PocketBase.

For Docker:

```bash
docker compose up -d
```

If you run PocketBase directly:

```bash
./pocketbase serve --dir ./pb_data
```

### 5) Restart the server

After adding the fields and hooks, restart PocketBase so the hooks are loaded.

### 6) Verify from the app

In EasyTasks:

1. Log in to the server.
2. Open Settings.
3. Check one of the notification options.
4. Enter a valid `PushOverUser` key.
5. Click Save Preferences.

If the server is updated correctly, the preference is saved and the values remain checked after refresh.

---

## Faster setup using the repo script

The repo already includes a setup script that adds the required notification fields to the `users` collection:

```bash
cd apps/EasyTaskProdConfig
npm install pocketbase
PB_URL=https://your-server.com:xxxx node setup-collections.mjs <superuser-email> <superuser-password>
```

This is the easiest way to apply the server-side schema updates for EasyTasks.

For a full backend setup guide, see:

- [EasyTasks/README.md](README.md)

---

## Quick server-side check

If you want to verify the field exists from the API, get a token and call the user record endpoint:

```bash
curl -s \
  -H "Authorization: <token>" \
  "https://your-server.com:xxxx/api/collections/users/records/<user-id>"
```

You should see fields like:

```json
{
  "PushTaskNew": false,
  "PushTaskDone": false,
  "PushTaskChanged": false,
  "PushOverUser": ""
}
```

If those fields are missing, the app cannot persist notification preferences.
