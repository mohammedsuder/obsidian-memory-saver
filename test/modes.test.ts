import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialLiteSet, moveToFront, sameSession, startupPlan, targetSet } from '../src/modes';

const SELF = 'plugin-monitor';
const LITE = ['tasks', 'dataview', 'was-off'];
const LIST = [SELF, 'tasks', 'smart', 'dataview', 'omni'];

test('Lite keeps only Lite plugins that are on the saved list', () => {
	assert.deepEqual(targetSet('lite', LIST, LITE, SELF), ['tasks', 'dataview']);
});

test('a Lite plugin that is not on the saved list is never loaded', () => {
	assert.ok(!targetSet('lite', LIST, LITE, SELF).includes('was-off'));
});

test('Extreme loads nothing but the monitor; Standard loads the whole saved list', () => {
	assert.deepEqual(targetSet('extreme', LIST, LITE, SELF), []);
	assert.deepEqual(targetSet('full', LIST, LITE, SELF), ['tasks', 'smart', 'dataview', 'omni']);
});

test('starting in Lite skips every non-Lite plugin listed after the monitor', () => {
	assert.deepEqual(startupPlan(LIST, SELF, 'lite', LITE).skip, ['smart', 'omni']);
});

test('starting in Extreme skips everything after the monitor', () => {
	assert.deepEqual(startupPlan(LIST, SELF, 'extreme', LITE).skip, ['tasks', 'smart', 'dataview', 'omni']);
});

test('starting in Standard skips nothing', () => {
	assert.deepEqual(startupPlan(LIST, SELF, 'full', LITE).skip, []);
});

test('plugins listed before the monitor cannot be skipped (they already loaded)', () => {
	assert.deepEqual(startupPlan(['smart', 'tasks', SELF, 'omni'], SELF, 'extreme', LITE).skip, ['omni']);
});

test('monitor not on the saved list: nothing can be skipped', () => {
	assert.deepEqual(startupPlan(['tasks', 'smart'], SELF, 'extreme', LITE).skip, []);
});

test('the monitor itself is never skipped', () => {
	assert.ok(!startupPlan(LIST, SELF, 'extreme', LITE).skip.includes(SELF));
});

test('moving the monitor to the front keeps everything else in order', () => {
	assert.deepEqual(moveToFront(['tasks', 'smart', SELF, 'omni'], SELF), [SELF, 'tasks', 'smart', 'omni']);
	assert.deepEqual(moveToFront(LIST, SELF), LIST);
});

test('same session only when the session id matches', () => {
	assert.equal(sameSession({ sessionId: 1234.5 }, 1234.5), true);
	assert.equal(sameSession({ sessionId: 1234.5 }, 9999.1), false);
	assert.equal(sameSession({}, 1234.5), false);
});

test('a saved Lite set is kept as it is, even when empty', () => {
	assert.deepEqual(initialLiteSet(['tasks'], ['dataview'], LIST, SELF), { liteSet: ['tasks'], needsSave: false });
	assert.deepEqual(initialLiteSet([], ['dataview'], LIST, SELF), { liteSet: [], needsSave: false });
});

test('without a saved set, an earlier version\'s cached set is kept and saved', () => {
	assert.deepEqual(initialLiteSet(undefined, ['dataview'], LIST, SELF), { liteSet: ['dataview'], needsSave: true });
});

test('a first install starts Lite as every switched-on plugin except the monitor', () => {
	assert.deepEqual(initialLiteSet(undefined, null, LIST, SELF), { liteSet: ['tasks', 'smart', 'dataview', 'omni'], needsSave: true });
});

test('malformed saved or cached sets are ignored', () => {
	assert.deepEqual(initialLiteSet('tasks', [1, 2], LIST, SELF).liteSet, ['tasks', 'smart', 'dataview', 'omni']);
});
