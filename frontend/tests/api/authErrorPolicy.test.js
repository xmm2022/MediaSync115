import assert from 'node:assert/strict'
import test from 'node:test'

import { shouldRedirectToLoginForUnauthorized } from '../../src/api/authErrorPolicy.js'

test('pan115 credential 401 does not trigger app login redirect', () => {
  const error = {
    response: {
      status: 401,
      data: {
        detail: '115网盘Cookie无效或未配置，请在设置中更新Cookie',
      },
    },
    config: {
      url: '/pan115/share/extract-files',
    },
  }

  assert.equal(shouldRedirectToLoginForUnauthorized(error), false)
})

test('app session 401 still triggers login redirect', () => {
  const error = {
    response: {
      status: 401,
      data: {
        detail: '请先登录',
      },
    },
    config: {
      url: '/settings/app-info',
    },
  }

  assert.equal(shouldRedirectToLoginForUnauthorized(error), true)
})

test('object detail credential 401 keeps existing no-redirect behavior', () => {
  const error = {
    response: {
      status: 401,
      data: {
        detail: {
          code: 'cookie_invalid',
          message: 'Cookie invalid',
        },
      },
    },
    config: {
      url: '/quark/share/save-to-folder',
    },
  }

  assert.equal(shouldRedirectToLoginForUnauthorized(error), false)
})
