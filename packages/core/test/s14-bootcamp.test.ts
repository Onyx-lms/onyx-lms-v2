import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeDb } from './fake-db.ts';
import { BootcampService } from '../src/bootcamp/bootcamp.service.ts';
import { BootcampModuleService, unix, classStarted } from '../src/bootcamp/module.service.ts';
import { BootcampPurchaseService, bootcampPrice } from '../src/bootcamp/purchase.service.ts';
import { SettingsService } from '../src/settings/settings.service.ts';
import { HttpError } from '../src/http/errors.ts';
import { parsePageQuery } from '../src/http/pagination.ts';

const PAGE = parsePageQuery({});

function make() {
  const d = new FakeDb({
    settings: [{ id: 1, type: 'instructor_revenue', description: '40' }],
    users: [{ id: 1, name: 'Root' }, { id: 2, name: 'Ada' }, { id: 3, name: 'Sam' }],
    bootcamp_categories: [
      { id: 1, title: 'Development', slug: 'development' },
      { id: 2, title: 'Design', slug: 'design' },
    ],
    bootcamps: [],
    bootcamp_modules: [],
    bootcamp_live_classes: [],
    bootcamp_resources: [],
    bootcamp_purchases: [],
  });
  const settings = new SettingsService(d as never);
  return {
    d,
    bootcamps: new BootcampService(d as never),
    modules: new BootcampModuleService(d as never),
    purchases: new BootcampPurchaseService(d as never, settings),
  };
}

test('BC-06 discounted_price is the amount OFF for a workshop', () => {
  // The same column holds the FINAL price on a course. Both meanings are in
  // Admin/OfflinePaymentController.php, fifty lines apart.
  assert.equal(bootcampPrice({ is_paid: 1, price: 100, discount_flag: 1, discounted_price: 25 }), 75);
  assert.equal(bootcampPrice({ is_paid: 1, price: 100, discount_flag: 0, discounted_price: 25 }), 100);
  assert.equal(bootcampPrice({ is_paid: 0, price: 100, discount_flag: 1, discounted_price: 25 }), 0);
  // A discount bigger than the price must not produce a negative charge.
  assert.equal(bootcampPrice({ is_paid: 1, price: 20, discount_flag: 1, discounted_price: 50 }), 0);
  assert.equal(bootcampPrice({ is_paid: 1, price: null, discount_flag: 0, discounted_price: null }), 0);
});

test('BC-02 status and pending are separate axes', async () => {
  const { bootcamps } = make();
  const byAdmin = await bootcamps.create(1, { title: 'Admin workshop' }, true) as Record<string, unknown>;
  const byInstructor = await bootcamps.create(2, { title: 'Instructor workshop' }, false) as Record<string, unknown>;

  assert.equal(byAdmin['status'], 1);
  assert.equal(byAdmin['pending'], 0);
  assert.equal(byInstructor['status'], 0, 'not published');
  assert.equal(byInstructor['pending'], 1, 'and waiting for approval');
  assert.equal(byAdmin['slug'], 'admin-workshop-' + byAdmin['id']);

  const queue = await bootcamps.pending(PAGE, '/x');
  assert.deepEqual(queue.data.map((r) => (r as { id: number }).id), [byInstructor['id']]);

  // Approving publishes and clears pending together.
  const approved = await bootcamps.setStatus(byInstructor['id'] as number, 1) as Record<string, unknown>;
  assert.equal(approved['status'], 1);
  assert.equal(approved['pending'], 0);
});

test('BC-01 category counts only count published workshops', async () => {
  const { bootcamps } = make();
  await bootcamps.create(1, { title: 'Live one', category_id: 1 }, true);
  await bootcamps.create(2, { title: 'Pending one', category_id: 1 }, false);

  const cats = await bootcamps.categories();
  assert.equal(cats.find((c) => c.id === 1)!.bootcamp_count, 1);
  assert.equal(cats.find((c) => c.id === 2)!.bootcamp_count, 0);
});

test('BC-01 a category still holding workshops cannot be deleted', async () => {
  const { bootcamps } = make();
  await bootcamps.create(1, { title: 'Uses category one', category_id: 1 }, true);
  // Laravel deleted it and left the workshops pointing at nothing.
  await assert.rejects(() => bootcamps.removeCategory(1), (e: HttpError) => e.status === 422);
  await bootcamps.removeCategory(2);
});

test('BC-02 the public list shows published only, and an unknown category is empty', async () => {
  const { bootcamps } = make();
  await bootcamps.create(1, { title: 'Published', category_id: 1 }, true);
  await bootcamps.create(2, { title: 'Pending', category_id: 1 }, false);

  const all = await bootcamps.published({}, PAGE, '/x');
  assert.equal(all.total, 1);

  const inCat = await bootcamps.published({ categorySlug: 'development' }, PAGE, '/x');
  assert.equal(inCat.total, 1);
  const unknown = await bootcamps.published({ categorySlug: 'nope' }, PAGE, '/x');
  assert.equal(unknown.total, 0, 'not the whole catalogue');
});

test('BC-02 deleting cascades to modules, classes and resources', async () => {
  const { d, bootcamps, modules } = make();
  const b = await bootcamps.create(1, { title: 'Doomed' }, true) as Record<string, unknown>;
  const m = await modules.create(b['id'] as number, { title: 'Week 1' }) as { id: number };
  d.tables['bootcamp_live_classes']!.push({ id: 1, module_id: m.id, title: 'Session' });
  d.tables['bootcamp_resources']!.push({ id: 1, module_id: m.id, title: 'slides.pdf' });

  await bootcamps.remove(b['id'] as number);
  // Ports remove_module_data() -> remove_live_class_data() + remove_resource_data().
  assert.equal(d.tables['bootcamp_modules']!.length, 0);
  assert.equal(d.tables['bootcamp_live_classes']!.length, 0, 'no orphaned classes');
  assert.equal(d.tables['bootcamp_resources']!.length, 0, 'no orphaned resources');
});

test('BC-02 duplicate deep-copies modules and their children, unpublished', async () => {
  const { d, bootcamps, modules } = make();
  const b = await bootcamps.create(1, { title: 'Original', outcomes: ['Ship'] }, true) as Record<string, unknown>;
  const m = await modules.create(b['id'] as number, { title: 'Week 1' }) as { id: number };
  d.tables['bootcamp_resources']!.push({ id: 1, module_id: m.id, title: 'slides.pdf' });

  const copy = await bootcamps.duplicate(b['id'] as number, 1, true) as Record<string, unknown>;
  assert.equal(copy['status'], 0, 'a copy is never live until someone says so');
  assert.deepEqual(copy['outcomes'], ['Ship'], 'JSON columns survive the copy');

  // Laravel copied only the bootcamp row, leaving the clone with no programme.
  const copied = await modules.forBootcamp(copy['id'] as number);
  assert.equal(copied.length, 1);
  assert.equal(copied[0]!.resources.length, 1);
});
