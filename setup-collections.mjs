/**
 * Creates the `task_lists` and `tasks` collections used by EasyTasks.
 *
 * Usage (needs `npm install pocketbase`):
 *   PB_URL=https://your-server.com:xxxx node setup-collections.mjs <superuser-email> <superuser-password>
 *
 * Re-running is safe: existing collections only get the fields they are missing;
 * nothing is removed or changed.
 *
 * `user` and `taskListId` are relations, and a task list is either public or private.
 * The API rules below let everyone read public lists while private lists stay visible
 * to their owner only; tasks inherit that from the list they belong to.
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

const relation = (name, collectionId) => ({
  name,
  type: 'relation',
  required: true,
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
  // Tasks inherit the visibility of the list they belong to; only the owner of
  // that list may change them.
  listRule: 'taskListId.visibility = "public" || taskListId.user = @request.auth.id',
  viewRule: 'taskListId.visibility = "public" || taskListId.user = @request.auth.id',
  createRule: '@request.auth.id != "" && taskListId.user = @request.auth.id',
  updateRule: 'taskListId.user = @request.auth.id',
  deleteRule: 'taskListId.user = @request.auth.id',
});

/**
 * Creates the collection, or adds the fields an existing one is missing.
 * Existing fields and rules are left as they are. Returns its id.
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
  if (missing.length === 0) {
    console.log(`skipped  ${collection.name} (already up to date)`);
    return existing.id;
  }
  try {
    await pb.collections.update(existing.id, {
      fields: [...existing.fields, ...missing],
    });
  } catch (err) {
    console.error(`failed   ${collection.name}: ${err.message}`);
    process.exit(1);
  }
  console.log(
    `updated  ${collection.name} (added ${missing.map((f) => f.name).join(', ')})`
  );
  return existing.id;
}

// `task_lists` first: `tasks.taskListId` needs its id for the relation.
const taskListsId = await create(taskLists);
await create(tasks(taskListsId));
