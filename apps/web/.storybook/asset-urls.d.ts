// Vite serves a file imported with ?url and gives its URL, so a story can fetch the raw bytes.
declare module '*?url' {
  const url: string

  export default url
}
