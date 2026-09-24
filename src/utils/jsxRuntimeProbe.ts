import { Fragment, jsx as originalJsx, jsxs as originalJsxs } from 'react/jsx-runtime'

const checkType = (type: any) => {
  if (type == null) {
    console.error('###UNDEFINED_ELEMENT###', new Error().stack)
  }
}

export const jsx = (type: any, props: any, key?: any) => {
  checkType(type)
  return originalJsx(type, props, key)
}

export const jsxs = (type: any, props: any, key?: any) => {
  checkType(type)
  return originalJsxs(type, props, key)
}

export { Fragment }
