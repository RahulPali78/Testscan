import assert from 'node:assert/strict';
import { readFile, readdir, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (path) => readFile(join(root, path), 'utf8');
const config = JSON.parse(await read('package.json'));
assert.equal(config.name, 'veriqo');
assert.equal(config.private, true);
const names = new Set();
let count = 0;
for (const group of ['apps', 'workers', 'packages']) {
  for (const item of await readdir(join(root, group), { withFileTypes: true })) {
    if (!item.isDirectory()) continue;
    const path = `${group}/${item.name}`;
    const manifest = JSON.parse(await read(`${path}/package.json`));
    assert.ok(manifest.name.startsWith('@veriqo/'), `${path}: unexpected name`);
    assert.ok(!names.has(manifest.name), `Duplicate package: ${manifest.name}`);
    assert.equal(manifest.private, true, `${path}: must remain private`);
    await access(join(root, path, 'README.md'));
    names.add(manifest.name);
    count++;
  }
}
assert.equal(count, 17);

const plan = JSON.parse(await read('docs/product/veriqo-backlog.json'));
assert.equal(plan.version, '2.0');
assert.equal(plan.tasks.length, 72);
assert.equal(plan.milestones.length, 9);
assert.equal(plan.assumptions.calendar_deadline, null);
const tasks = new Map(plan.tasks.map((task) => [task.id, task]));
assert.equal(tasks.size, plan.tasks.length, 'Duplicate task identifiers');
const active = new Set();
const visited = new Set();
function visit(id) {
  const task = tasks.get(id);
  assert.ok(task, `Missing task dependency: ${id}`);
  assert.ok(!active.has(id), `Dependency cycle: ${id}`);
  if (visited.has(id)) return;
  active.add(id);
  assert.equal(task.status, 'Planned', `${id}: update implementation status and checks before claiming completion`);
  assert.ok(plan.roles[task.owner], `${id}: unknown owner`);
  assert.ok(plan.milestones.some((m) => m.n === task.milestone), `${id}: missing milestone`);
  assert.ok(task.acceptance_criteria.length >= 3, `${id}: missing acceptance evidence`);
  assert.ok(task.effort_engineering_days.min > 0 && task.effort_engineering_days.max >= task.effort_engineering_days.min);
  task.dependencies.forEach(visit);
  active.delete(id);
  visited.add(id);
}
visit('E2E-908');
assert.equal(visited.size, tasks.size, 'Every committed task must feed the final product gate');
for (const bound of ['min', 'max']) {
  const total = plan.tasks.reduce((sum, task) => sum + task.effort_engineering_days[bound], 0);
  assert.equal(total, plan.assumptions.engineering_days_range[bound], `Incorrect ${bound} effort total`);
}

for (const file of ['veriqo-build-plan.html', 'veriqo-blueprint.html']) {
  const source = await read(`docs/product/${file}`);
  const ids = [...source.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  const idSet = new Set(ids);
  assert.equal(idSet.size, ids.length, `${file}: duplicate HTML IDs`);
  for (const match of source.matchAll(/\bhref="#([^"]+)"/g)) {
    assert.ok(idSet.has(match[1]), `${file}: broken anchor ${match[1]}`);
  }
  assert.ok(!/<script\b[^>]*\bsrc=|<link\b[^>]*rel="stylesheet"/i.test(source), `${file}: not self-contained`);
  for (const task of tasks.values()) assert.ok(source.includes(task.id), `${file}: missing ${task.id}`);
  if (file.includes('build-plan')) {
    const tag = source.match(/<script[^>]*id="plan-data"[^>]*>/);
    assert.ok(tag, 'Missing embedded export data');
    const start = tag.index + tag[0].length;
    const end = source.indexOf('</script>', start);
    assert.ok(end > start, 'Missing export data closing tag');
    assert.deepEqual(JSON.parse(source.slice(start, end)), plan, 'HTML export and JSON backlog diverged');
    assert.equal([...source.matchAll(/class="ticket"/g)].length, tasks.size);
    for (const task of tasks.values()) {
      assert.ok(source.includes(`id="${task.id}" data-milestone="${task.milestone}" data-owner="${task.owner}"`), `Incorrect rendered metadata: ${task.id}`);
    }
  } else {
    const checklist = [...source.matchAll(/data-task="([^"]+)"/g)].map((match) => match[1]);
    assert.deepEqual([...checklist].sort(), [...tasks.keys()].sort(), 'Blueprint checklist differs from backlog');
  }
}
console.log(`Validated ${count} private workspace modules, 72 planned tasks, nine milestones, dependency closure and both self-contained product documents.`);
