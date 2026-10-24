/// <reference types="vite/client" />

/** `vite.config.ts`'s `ukLocaleSplit`: the two halves of `uk.json`. */
declare module 'virtual:uk-core' {
  const strings: Record<string, unknown>;
  export default strings;
}
declare module 'virtual:uk-owner' {
  const strings: Record<string, unknown>;
  export default strings;
}
