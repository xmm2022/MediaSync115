import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

test('tv detail manual 115 dialog supports fixed source mode', () => {
  const source = readFileSync(new URL('../../src/views/TvDetail.vue', import.meta.url), 'utf8')
  assert.match(source, /manualPanForm\.value\s*=\s*\{[\s\S]*mode:\s*'transfer'/)
  assert.match(source, /<el-radio-button label="transfer">立即转存<\/el-radio-button>/)
  assert.match(source, /<el-radio-button label="source">固定追新<\/el-radio-button>/)
  assert.match(source, /<el-radio-button label="transfer_and_source">转存并追新<\/el-radio-button>/)
  assert.match(source, /ensureTvSubscriptionForManualSource/)
  assert.match(source, /subscriptionApi\.createSource/)
})
