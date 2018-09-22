// homebridge-zp/index.js
// Copyright © 2016-2018 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Sonos ZonePlayer.

'use strict'

const ZpPlatformModule = require('./lib/ZpPlatform')
const ZpPlatform = ZpPlatformModule.ZpPlatform

module.exports = (homebridge) => {
  ZpPlatformModule.setHomebridge(homebridge)
  homebridge.registerPlatform('homebridge-zp', 'ZP', ZpPlatform)
}
