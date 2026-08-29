// undici 运行时由 Node 内置 / dsh 宿主提供,编译期不装类型——声明 any 脱钩。
declare module 'undici' {
  const any: any
  export = any
}
declare module 'undici/lib/handler/decorator-handler.js' {
  const any: any
  export = any
}
declare module 'undici/lib/handler/decorator-handler' {
  const any: any
  export = any
}
