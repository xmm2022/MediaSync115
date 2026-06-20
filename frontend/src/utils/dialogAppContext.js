/** 供程序化挂载弹窗时复用主应用的 Element Plus 上下文 */
let appContext = null

export const setDialogAppContext = (context) => {
  appContext = context
}

export const getDialogAppContext = () => appContext
