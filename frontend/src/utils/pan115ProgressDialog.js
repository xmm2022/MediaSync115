import { createVNode, reactive, render } from 'vue'

import Pan115ProgressDialog from '@/components/detail/Pan115ProgressDialog.vue'
import { getDialogAppContext } from '@/utils/dialogAppContext'

/** 打开 HDHive 解锁 / 115 转存进度弹窗控制器 */
export const openPan115ProgressDialog = ({ resourceLabel = '' } = {}) => {
  const container = document.createElement('div')
  document.body.appendChild(container)

  const state = reactive({
    visible: false,
    phase: 'unlock',
    status: 'success',
    message: '',
    resourceLabel,
  })

  let closeResolver = null
  let mounted = false

  const mount = () => {
    if (mounted) return
    mounted = true
    const vnode = createVNode(Pan115ProgressDialog, {
      state,
      onClose: () => {
        closeResolver?.()
        closeResolver = null
      },
    })
    vnode.appContext = getDialogAppContext()
    render(vnode, container)
  }

  const destroy = () => {
    render(null, container)
    container.remove()
    mounted = false
  }

  mount()

  return {
    show() {
      state.visible = true
    },
    hide() {
      state.visible = false
    },
    setPhase(phase, message) {
      state.phase = phase
      state.message = message
      state.visible = true
    },
    setResult(status, message) {
      state.phase = 'result'
      state.status = status
      state.message = message
      state.visible = true
    },
    waitClose() {
      return new Promise((resolve) => {
        closeResolver = resolve
      })
    },
    destroy,
  }
}
