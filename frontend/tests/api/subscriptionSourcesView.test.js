import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

test('subscriptions view renders fixed source controls', () => {
  const source = readFileSync(new URL('../../src/views/Subscriptions.vue', import.meta.url), 'utf8')
  assert.match(source, /固定来源/)
  assert.match(source, /formatSourceLink/)
  assert.match(source, /handleScanSource/)
  assert.match(source, /handleToggleSource/)
  assert.match(source, /handleDeleteSource/)
  assert.match(source, /subscriptionApi\.scanSource/)
})
