import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

test('subscriptionApi exposes fixed source methods', () => {
  const source = readFileSync(new URL('../../src/api/index.js', import.meta.url), 'utf8')
  assert.match(source, /listSources:\s*\(id\)/)
  assert.match(source, /createSource:\s*\(id,\s*data\)/)
  assert.match(source, /updateSource:\s*\(id,\s*sourceId,\s*data\)/)
  assert.match(source, /deleteSource:\s*\(id,\s*sourceId\)/)
  assert.match(source, /scanSource:\s*\(id,\s*sourceId\)/)
})
