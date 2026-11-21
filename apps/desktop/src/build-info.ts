// Filled in by build.mjs (esbuild define) from package.json and git.
declare const __GP_VERSION__: string
declare const __GP_COMMIT__: string

export const BUILD = { version: __GP_VERSION__, commit: __GP_COMMIT__ } as const
