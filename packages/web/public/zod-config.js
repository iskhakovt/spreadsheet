// Pre-bundle Zod global config. Loaded by index.html via
// `<script src="/zod-config.js">` BEFORE the main bundle so the session chunk's
// top-level schema definitions (`z.object(...)` in @spreadsheet/shared) see
// `jitless: true` and skip Zod's `new Function("")` feature probe — which
// Chrome reports as a CSP violation even though Zod catches the exception.
//
// Setting this from inside the bundle is too late: the session chunk
// initializes `globalThis.__zod_globalConfig ??= {}` and creates the schemas
// (firing the probe) before the entry chunk's body runs. The static file
// lets `script-src 'self'` cover it without an inline hash.
//
// Delete once Zod ships a fix that gates the probe at memo-resolution time
// rather than at schema-creation time.
globalThis.__zod_globalConfig = { jitless: true };
