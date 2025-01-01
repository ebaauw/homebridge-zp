// homebridge-zp/index.js
// Copyright © 2016-2025 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Sonos ZonePlayer.

import { createRequire } from 'node:module'

import { ZpPlatform } from './lib/ZpPlatform.js'

const require = createRequire(import.meta.url)
const packageJson = require('./package.json')

function main (homebridge) {
  ZpPlatform.loadPlatform(homebridge, packageJson, 'ZP', ZpPlatform)
}

export { main as default }
