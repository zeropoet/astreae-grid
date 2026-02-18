# Axis Grid

A generative lattice animation built with `p5.js`, served through a minimal `Next.js` App Router shell.

## What It Does

- Renders a full-viewport animated grid on `/`
- Uses click/touch as a localized pulling force on the cloth-like lattice
- Persists pulled deformations as new resting folds until reload
- Uses friction and distance constraints to avoid point entanglement
- Scales lattice density and cell ratio with viewport size/aspect
- Exports as a static site (`out/`) for GitHub Pages

Core implementation lives in `/Users/zeropoet/WebstormProjects/axis-grid/components/GridEngine.tsx`.

## Tech Stack

- `Next.js` 15
- `React` 19
- `TypeScript`
- `p5.js`
- `Vitest` (test runner)

## Project Structure

```text
app/
  layout.tsx
  page.tsx
components/
  GridEngine.tsx
next.config.mjs
package.json
```

## Getting Started

### 1) Install dependencies

```bash
npm install
```

### 2) Run locally

```bash
npm run dev
```

Open `http://localhost:3000`.

## Scripts

- `npm run dev` - start local dev server
- `npm run build` - production build + static export
- `npm run start` - run production server
- `npm run serve:pages` - serve exported `out/` directory
- `npm run typecheck` - generate Next types and run TypeScript checks
- `npm test` - run tests with Vitest

## Static Export and GitHub Pages

Static export is enabled in `/Users/zeropoet/WebstormProjects/axis-grid/next.config.mjs` via `output: "export"`.

During GitHub Actions runs (`GITHUB_ACTIONS=true`), `basePath` and `assetPrefix` are set to `/<repo>/` so the site works correctly on GitHub Pages.

If you rename the repository, update the `repo` value in `/Users/zeropoet/WebstormProjects/axis-grid/next.config.mjs`.

## Development Notes

- The canvas is created client-side using dynamic import of `p5`
- Canvas is fixed to viewport and rebuilt on resize
- Animation uses a spring-mass cloth simulation with plastic deformation and edge-length constraints
