/// <reference types="vite/client" />

// Damit TypeScript den ?raw Import versteht
declare module '*?raw' {
    const content: string
    export default content
}