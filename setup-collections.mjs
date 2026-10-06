/**
 * Creates the `task_lists` and `tasks` collections used by EasyTasks, and adds the
 * push notification fields to the built-in `users` collection.
 *
 * Usage (needs `npm install pocketbase`):
 *   PB_URL=https://your-server.com:xxxx node setup-collections.mjs <superuser-email> <superuser-password>
 *
 * Re-running is safe: existing collections only get missing fields and the API
 * rules declared below; no fields are removed.
 *
 * `user` and `taskListId` are relations, and a task list is either public or private.
 * The API rules below let everyone read public lists while private lists stay visible
 * to their owner only; tasks inherit that from the list they belong to.
 *
 * `PushTaskNew`, `PushTaskDone`, `PushTaskChanged`, `PushOnlyAssigned` and `PushOverUser` on `users`
 * are read by the hooks in `pb_hooks/`, which have to be copied to the server separately.
 */
import PocketBase from 'pocketbase';

const PB_URL = process.env.PB_URL;
const [email, password] = process.argv.slice(2);

if (!PB_URL || !email || !password) {
  console.error(
    'Usage: PB_URL=https://your-server.com:xxxx node setup-collections.mjs <superuser-email> <superuser-password>'
  );
  process.exit(1);
}

const text = (name) => ({ name, type: 'text' });

const relation = (name, collectionId, required = true) => ({
  name,
  type: 'relation',
  required,
  collectionId,
  maxSelect: 1,
  cascadeDelete: false,
});

const pb = new PocketBase(PB_URL);

try {
  await pb.collection('_superusers').authWithPassword(email, password);
} catch (err) {
  console.error(`Superuser login at ${PB_URL} failed: ${err.message}`);
  process.exit(1);
}

const usersId = (await pb.collections.getOne('users')).id;

// Fields added to the built-in `users` collection: which task events the user wants a
// push notification for (new; completed or deleted; changed), and their Pushover key.
const users = {
  name: 'users',
  fields: [
    { name: 'PushTaskNew', type: 'bool' },
    { name: 'PushTaskDone', type: 'bool' },
    { name: 'PushTaskChanged', type: 'bool' },
    { name: 'PushOnlyAssigned', type: 'bool' },
    text('PushOverUser'),
  ],
};

const taskLists = {
  name: 'task_lists',
  type: 'base',
  fields: [
    relation('user', usersId),
    text('title'),
    text('imagePath'),
    text('status'),
    {
      name: 'visibility',
      type: 'select',
      required: true,
      maxSelect: 1,
      values: ['public', 'private'],
    },
  ],
  // Public lists are readable by anyone, private ones only by their owner.
  listRule: 'visibility = "public" || user = @request.auth.id',
  viewRule: 'visibility = "public" || user = @request.auth.id',
  // Stops a logged-in user creating a list owned by somebody else.
  createRule: '@request.auth.id != "" && user = @request.auth.id',
  updateRule: 'user = @request.auth.id',
  deleteRule: 'user = @request.auth.id',
};

const tasks = (taskListsId) => ({
  name: 'tasks',
  type: 'base',
  fields: [
    relation('user', usersId),
    relation('taskListId', taskListsId),
    // Who the task is assigned to; optional.
    relation('assignee', usersId, false),
    text('title'),
    text('summary'),
    text('status'),
    { name: 'dueDate', type: 'date' },
    text('imagePath'),
    // When and by whom (e-mail) a task was created and last edited.
    text('creationDate'),
    text('lastEditDate'),
    text('createdBy'),
    text('editedBy'),
  ],
  // Public lists are collaborative. The original task creator stays immutable,
  // so only that user can delete the task.
  listRule: 'taskListId.visibility = "public" || taskListId.user = @request.auth.id',
  viewRule: 'taskListId.visibility = "public" || taskListId.user = @request.auth.id',
  createRule: '@request.auth.id != "" && (taskListId.visibility = "public" || taskListId.user = @request.auth.id) && user = @request.auth.id',
  updateRule: '@request.auth.id != "" && (taskListId.visibility = "public" || taskListId.user = @request.auth.id) && @request.body.user:changed = false',
  deleteRule: 'user = @request.auth.id',
});

/**
 * Creates the collection, or adds missing fields and synchronizes declared API rules.
 * Existing fields are never removed. Returns the collection id.
 */
async function create(collection) {
  try {
    const created = await pb.collections.create(collection);
    console.log(`created  ${collection.name}`);
    return created.id;
  } catch (err) {
    if (err.status === 400 && err.response?.data?.name) {
      return addMissingFields(collection);
    }
    console.error(`failed   ${collection.name}: ${err.message}`);
    process.exit(1);
  }
}

async function addMissingFields(collection) {
  const existing = await pb.collections.getOne(collection.name);
  const names = new Set(existing.fields.map((field) => field.name));
  const missing = collection.fields.filter((field) => !names.has(field.name));
  const ruleNames = ['listRule', 'viewRule', 'createRule', 'updateRule', 'deleteRule'];
  const changedRules = Object.fromEntries(
    ruleNames
      .filter((rule) => rule in collection && existing[rule] !== collection[rule])
      .map((rule) => [rule, collection[rule]])
  );
  if (missing.length === 0 && Object.keys(changedRules).length === 0) {
    console.log(`skipped  ${collection.name} (already up to date)`);
    return existing.id;
  }
  try {
    await pb.collections.update(existing.id, {
      ...(missing.length ? { fields: [...existing.fields, ...missing] } : {}),
      ...changedRules,
    });
  } catch (err) {
    console.error(`failed   ${collection.name}: ${err.message}`);
    process.exit(1);
  }
  const changes = [
    ...(missing.length ? [`added ${missing.map((field) => field.name).join(', ')}`] : []),
    ...(Object.keys(changedRules).length ? ['updated API rules'] : []),
  ];
  console.log(`updated  ${collection.name} (${changes.join('; ')})`);
  return existing.id;
}

// `users` already exists, so it only gets the fields it is missing.
await addMissingFields(users);

// `task_lists` first: `tasks.taskListId` needs its id for the relation.
const taskListsId = await create(taskLists);
await create(tasks(taskListsId));
