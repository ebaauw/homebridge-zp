#!/usr/bin/env node

// homebridge-zp/cli/zp.js
// Copyright © 2019-2026 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Sonos ZonePlayer.

import { createRequire } from 'node:module'

import { ZpTool } from 'hb-zp-tools/ZpTool'

const require = createRequire(import.meta.url)
const packageJson = require('../package.json')

new ZpTool(packageJson).main()
