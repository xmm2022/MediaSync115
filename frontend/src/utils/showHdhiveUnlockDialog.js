import { createVNode, render } from 'vue'

import HdhiveUnlockDialog from '@/components/detail/HdhiveUnlockDialog.vue'
import { getDialogAppContext } from '@/utils/dialogAppContext'

/** 屏幕居中展示 HDHive 积分解锁确认弹窗 */
export const showHdhiveUnlockDialog = (row, reason = '') => new Promise((resolve) => {
  const container = document.createElement('div')
  document.body.appendChild(container)

  const destroy = (confirmed) => {
    render(null, container)
    container.remove()
    resolve(confirmed)
  }

  const vnode = createVNode(HdhiveUnlockDialog, {
    row,
    reason,
    onConfirm: () => destroy(true),
    onCancel: () => destroy(false),
  })
  vnode.appContext = getDialogAppContext()
  render(vnode, container)
})
