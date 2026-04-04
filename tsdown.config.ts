import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    'lib/errors/index': 'src/lib/errors/index.ts',
    'lib/cache/index': 'src/lib/cache/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  unbundle: true,
  root: 'src',
})
