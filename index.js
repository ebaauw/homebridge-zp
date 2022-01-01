// homebridge-zp/index.js
// Copyright © 2016-2022 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Sonos ZonePlayer.

'use strict'

const ZpPlatform = require('./lib/ZpPlatform')
const packageJson = require('./package.json')

module.exports = (homebridge) => {
  ZpPlatform.loadPlatform(homebridge, packageJson, 'ZP', ZpPlatform)
}
