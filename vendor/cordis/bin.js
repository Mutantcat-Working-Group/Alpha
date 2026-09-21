#!/usr/bin/env node

import { Context } from '@mutantcat/cordis'
import { pathToFileURL } from 'node:url'
import Loader from '@mutantcat/cordis-plugin-loader'

const ctx = new Context()
ctx.baseUrl = pathToFileURL(process.cwd()).href + '/'

await ctx.plugin(Loader)
await ctx.loader.create({
  name: '@mutantcat/cordis-plugin-include',
  config: {
    path: './cordis.yml',
  },
})
