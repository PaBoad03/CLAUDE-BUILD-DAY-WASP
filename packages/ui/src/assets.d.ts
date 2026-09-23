// Vite serves static assets imported with `?url` as a URL string.
declare module '*.glb?url' {
  const src: string;
  export default src;
}
