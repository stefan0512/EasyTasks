# PocketBase Setup for EasyTasks

EasyTasks keeps its data in the browser by default. To share task lists between devices
and people, it can use a [PocketBase](https://pocketbase.io) server as its backend. This
guide sets up that server: the collections EasyTasks needs, their API rules, and the
user accounts.

In the examples, `https://your-server.com:xxxx` stands for the address of your
PocketBase server. Replace it with your own; leave out `:xxxx` if the server runs on the
default port (443 for HTTPS). The Admin UI is at `https://your-server.com:xxxx/_/`.

Task lists are **public** or **private**: a private list, and its tasks, are visible only
to the user who created it. This is enforced by PocketBase's API rules, not by the app,
so a private list is genuinely unreachable for other users — it is missing from list
results and returns 404 when requested directly.

## Requirements

- **PocketBase 0.23 or newer**, running and reachable from the devices that use
  EasyTasks. See the [PocketBase documentation](https://pocketbase.io/docs/) for
  installation. Create a **superuser** in the Admin UI when you open it for the first
  time.
- **HTTPS**, if EasyTasks itself is opened over HTTPS (a hosted web app, or the Android
  app). Browsers block requests from an HTTPS page to an HTTP server, so in that case put
  PocketBase behind a reverse proxy with a certificate. See
  [Going to production](https://pocketbase.io/docs/going-to-production/).
- **Node.js 18 or newer**, only to run the setup scripts in this folder.

## Quick start: create both collections with a script

Instead of clicking the collections together in the Admin UI, run
[`setup-collections.mjs`](setup-collections.mjs) with your **superuser** credentials.
The scripts use the official PocketBase JavaScript SDK, so install it first, in this
folder:

```bash
npm install pocketbase
```

Then run the script, with the server address in `PB_URL`:

```bash
# Linux / macOS
PB_URL=https://your-server.com:xxxx node setup-collections.mjs <superuser-email> <superuser-password>
```

```powershell
# Windows PowerShell
$env:PB_URL = "https://your-server.com:xxxx"
node setup-collections.mjs <superuser-email> <superuser-password>
```

It creates `task_lists` and `tasks` with the fields and API rules described below, and
adds the push notification fields to `users` (see
[Push notifications about tasks](#4-push-notifications-about-tasks)).
Running it again is safe: an existing collection gets any missing fields and its
configured API rules are synchronized; existing fields and records are never removed.
To change or remove a field, use the Admin UI or start over with the delete script.

The same thing with plain HTTP calls, if you'd rather not run the script — first get a
token, then post each collection. Relation fields need the **id** of the collection they
point at (`GET /api/collections/users` gives you that id), which is the main reason the
script is easier:

```bash
PB_URL=https://your-server.com:xxxx

TOKEN=$(curl -s -X POST $PB_URL/api/collections/_superusers/auth-with-password \
  -H 'Content-Type: application/json' \
  -d '{"identity":"<superuser-email>","password":"<superuser-password>"}' | jq -r .token)

USERS_ID=$(curl -s $PB_URL/api/collections/users \
  -H "Authorization: $TOKEN" | jq -r .id)

curl -X POST $PB_URL/api/collections \
  -H "Authorization: $TOKEN" -H 'Content-Type: application/json' \
  -d '{
    "name": "task_lists",
    "type": "base",
    "fields": [
      {"name": "user", "type": "relation", "required": true, "collectionId": "'"$USERS_ID"'", "maxSelect": 1},
      {"name": "title", "type": "text"},
      {"name": "imagePath", "type": "text"},
      {"name": "status", "type": "text"},
      {"name": "visibility", "type": "select", "required": true, "maxSelect": 1, "values": ["public", "private"]}
    ],
    "listRule": "visibility = \"public\" || user = @request.auth.id",
    "viewRule": "visibility = \"public\" || user = @request.auth.id",
    "createRule": "@request.auth.id != \"\" && user = @request.auth.id",
    "updateRule": "user = @request.auth.id",
    "deleteRule": "user = @request.auth.id"
  }'
```

`tasks` is posted the same way, with the fields and rules from section 3. Its
`taskListId` relation needs the id of the `task_lists` collection you just created.

### Starting over

[`delete-collections.mjs`](delete-collections.mjs) removes both collections again,
which is the quickest way to rebuild them after a field change:

```bash
PB_URL=https://your-server.com:xxxx node delete-collections.mjs <superuser-email> <superuser-password> --yes
```

This deletes the collections **and every record in them**, with no undo — hence the
required `--yes`. It deletes `tasks` before `task_lists`, which is the order the
relation between them requires, and skips whatever is already gone. The equivalent
HTTP call is `DELETE /api/collections/<name>` with the superuser token in the
`Authorization` header.

## 1. `users` — already there

PocketBase ships with an auth collection named `users`. EasyTasks logs in against it with
**e-mail and password** (*Settings* page in the app). Make sure the identity/password
auth method is enabled under *Collections → users → Options*.

For push notifications, `users` gets four extra fields. The setup script adds them; in
the Admin UI, add them under *Collections → users → Fields*:

| Field               | Type       | Notes                                                              |
| ------------------- | ---------- | ------------------------------------------------------------------ |
| `PushTaskNew` | Bool       | Ticked: the user is notified about new tasks.                      |
| `PushTaskDone`      | Bool       | Ticked: … about completed tasks, and open tasks that were deleted. |
| `PushTaskChanged`   | Bool       | Ticked: … about edited tasks.                                      |
| `PushOnlyAssigned`  | Bool       | Ticked: … only about tasks assigned to this user (all tasks otherwise). |
| `PushOverUser`      | Plain text | The user's Pushover user key. Empty: no notifications.             |

The names are case-sensitive; the notification hooks look them up exactly like this.
Users set them themselves on the app's *Settings* page.

Both other collections point at it: EasyTasks stores the id of the logged-in user as the
owner of every list and task it creates. Without a login, EasyTasks stores its data in
the browser only.

### Creating accounts

EasyTasks has no sign-up page. Create the accounts in the Admin UI: *Collections →
users → New record*, with e-mail and password, and tick **Verified**.

**EasyTasks only accepts verified accounts.** A login with an unverified account is
refused with "… is not verified yet". Ticking *Verified* is enough; no e-mail has to be
sent.

### Recommended: close public sign-up

By default, anyone who can reach your server may create an account through the API.
Since EasyTasks does not need that, set *Collections → users → API Rules → Create* to
**superusers only** (the locked setting). Accounts can then only be created in the
Admin UI.

To make "verified" a server-side condition as well, set the collection's **auth rule**
(*Collections → users → Options → Authentication rule*) to:

```
verified = true
```

An unverified account then fails authentication on the server, whatever the client does.

## 2. `task_lists`

A **Base** collection named `task_lists`. Leave the text fields *not required*, so
records with an empty image path are accepted.

| Field        | Type                    | Sent by the app        | Notes                                                        |
| ------------ | ----------------------- | ---------------------- | ------------------------------------------------------------ |
| `user`       | Relation → `users`      | id of the logged-in user | Required, single, no cascade delete. The owner of the list. |
| `title`      | Plain text              | required in the form   | Shown as the entry title in the app.                          |
| `imagePath`  | Plain text              | icon file name         | File name only, e.g. `tasklist_generic.png`.                  |
| `status`     | Plain text              | `active`               | Free text.                                                    |
| `visibility` | Select (`public`, `private`) | `public` (default) | Required, single value. Drives the rules below.          |

`id` is created by PocketBase; the app never sends one.

**API rules:**

| Rule          | Expression                                          |
| ------------- | --------------------------------------------------- |
| List / View   | `visibility = "public" \|\| user = @request.auth.id` |
| Create        | `@request.auth.id != "" && user = @request.auth.id`  |
| Update/Delete | `user = @request.auth.id`                            |

The Create rule is what stops a logged-in user from creating a list owned by somebody
else. As written, visitors without a login can still read public lists; prefix the List
and View rules with `@request.auth.id != "" && (...)` to require a login everywhere.

## 3. `tasks`

A **Base** collection named `tasks`. Again, leave the text fields *not required* so
tasks without a summary, icon or due date can be saved.

| Field          | Type                    | Sent by the app             | Notes                                               |
| -------------- | ----------------------- | --------------------------- | --------------------------------------------------- |
| `user`         | Relation → `users`      | id of the logged-in user    | Required, single. Who created the task.             |
| `taskListId`   | Relation → `task_lists` | id of the selected list     | Required, single. The list the task belongs to.     |
| `title`        | Plain text              | required in the form        |                                                     |
| `summary`      | Plain text              | may be empty                | Multi-line text from the form.                      |
| `status`       | Plain text              | `open` or `complete`        |                                                     |
| `dueDate`      | Date                    | `YYYY-MM-DD`, may be empty  | Set with the date picker.                           |
| `imagePath`    | Plain text              | may be empty                | Icon file name only.                                |
| `creationDate` | Plain text              | ISO timestamp               | When the task was created.                          |
| `lastEditDate` | Plain text              | ISO timestamp, may be empty | When the task was last edited.                      |
| `createdBy`    | Plain text              | e-mail, may be empty        | Who created the task.                               |
| `editedBy`     | Plain text              | e-mail, may be empty        | Who last edited the task.                           |

**API rules** — tasks inherit the visibility of the list they belong to, which is
possible because `taskListId` is a relation: rules can follow it with a dot.

| Rule          | Expression                                                                   |
| ------------- | ---------------------------------------------------------------------------- |
| List / View   | `taskListId.visibility = "public" \|\| taskListId.user = @request.auth.id`    |
| Create        | `@request.auth.id != "" && (taskListId.visibility = "public" || taskListId.user = @request.auth.id) && user = @request.auth.id` |
| Update        | `@request.auth.id != "" && (taskListId.visibility = "public" || taskListId.user = @request.auth.id) && @request.body.user:changed = false` |
| Delete        | `user = @request.auth.id`                                                    |

Any logged-in user can add or change tasks in a public list. The update rule requires
the task's creator relation to remain unchanged, so collaborators cannot take
ownership; only the user who created a task may delete it. Private-list tasks remain
visible and editable only by their list owner.

## 4. Push notifications about tasks

Optional. When a task is created, completed, deleted or edited, PocketBase itself sends
a push notification through `https://push.your-server.com:xxxx/notify`, using server-side hooks —
so the Pushover keys never reach the app.

Each user picks the events on the app's *Settings* page:

| Event                       | Field               | Example message                                         |
| --------------------------- | ------------------- | ------------------------------------------------------- |
| New task                    | `PushTaskNew` | `New task in "Shopping": Milk (by anna@example.com)`     |
| Task completed              | `PushTaskDone`      | `Task completed in "Shopping": Milk (by anna@example.com)` |
| Open task deleted           | `PushTaskDone`      | `Task deleted in "Shopping": Milk (by anna@example.com)` |
| Task edited                 | `PushTaskChanged`   | `Task changed in "Shopping": Milk (by anna@example.com)` |

Who is notified: every user with the event's field ticked and a **`PushOverUser`** key
set, except the user who caused the event. A task on a **private** list only goes to
the list's owner — and since only the owner may change tasks on their lists, tasks on
private lists notify nobody. Users sharing a key get one message, not several.

A few details:

- **Deleting a completed task** sends nothing: it was announced when it was completed.
  This also keeps deleting a finished task list quiet, which removes its (all
  completed) tasks first.
- **An edit** only counts if the title, summary, status, due date, icon or list
  changed. Saving the form unchanged sends nothing.
- New tasks are noticed however they are created (app, Admin UI, API). Completions,
  deletions and edits are noticed when made through the API — which includes the app
  and the Admin UI — because only the API request tells who made them.

**Setup:**

1. Add the fields to `users` (the setup script does this, see
   [`users`](#1-users--already-there)).
2. Copy [`pb_hooks/notify_tasks.pb.js`](pb_hooks/notify_tasks.pb.js) **and**
   [`pb_hooks/push_notify.js`](pb_hooks/push_notify.js) into the `pb_hooks` folder next
   to PocketBase's `pb_data` folder. The first holds the hooks, the second the code they
   share. Also copy [`pb_hooks/users.pb.js`](pb_hooks/users.pb.js): it provides the user
   list the app needs to assign tasks (`GET /api/easytasks/users`). With Docker, mount
   the folder:

   ```yaml
   volumes:
     - ./pb_data:/pb/pb_data
     - ./pb_hooks:/pb/pb_hooks
   ```

   PocketBase looks for hooks in `pb_hooks` next to the data folder (`--dir`), so no
   extra option is needed.
3. Restart PocketBase; with Docker, `docker compose up -d` (a plain `restart` does not
   pick up a new volume). Later changes to the files are reloaded automatically.

A failed notification never stops the task from being saved. Failures are logged under
*Logs* in the Admin UI (`push notify failed` / `push notify error`).

**Keep the keys private.** The default API rules on `users` only let a user read their
own record, so nobody sees another user's `PushOverUser` key. If you loosened those
rules, mark `PushOverUser` as *Hidden* in the field options.

## 5. Things to watch

- **Superusers see everything.** Rules don't apply in the Admin UI, so "private" means
  private from other app users, not from the server's administrator.
- **E-mail addresses on public tasks.** `createdBy` and `editedBy` hold e-mail addresses,
  and everyone who can read a public list can read them.
- **Per-user tasks within a shared list** are not modelled. Everyone who can see a list
  sees all of its tasks; the `user` field on a task only records who created it.
- **Cross-origin requests.** EasyTasks usually runs on a different address than
  PocketBase. PocketBase allows requests from any origin by default; if you restricted
  that with the `--origins` option, add the address EasyTasks is served from. The
  Android app sends its requests from `https://localhost`, so add that as well.

## 6. Check it

1. In EasyTasks, open **Settings** from the menu.
2. Enter `https://your-server.com:xxxx` as the server URL, plus the e-mail and password
   of a verified account, and press **Login**. EasyTasks logs in and checks that both
   collections can be read; only then are the settings stored. Your e-mail now appears
   in the header of the app, instead of "local".
3. On the overview, create a task list with **New Tasklist** and choose *Public* or
   *Private*. It appears in `task_lists` in the Admin UI, with your user as `user`.
4. Open the list, add a task, edit it and complete it.
5. To see the privacy rules at work, log in with a second account: the first account's
   public list is there, the private one is not.

If the login fails, the dialog shows why — for example, an unreachable server, a wrong
password, an unverified account, or a missing collection.
