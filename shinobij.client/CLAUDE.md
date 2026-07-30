# shinobij.client — frontend conventions

- **`shinobij.client/src/App.tsx` is the legacy frontend monolith, in active
  drain** into `src/{screens,components,lib,data,constants,types}/`. Put **new**
  screens/components/helpers in their own module under those folders — **not** in
  App.tsx. A line-budget ratchet test (`src/App.size.test.ts`) fails the build if
  App.tsx grows past its budget; when you drain code out, lower `MAX_LINES` to
  lock the win in. Extractions are behavior-preserving verbatim moves: `export`
  the symbols the moved code needs from App, import them back, and keep storage
  keys / props / CSS / balance identical.
