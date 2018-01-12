// homebridge-zp/index.js
// Copyright © 2016-2018 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Sonos ZonePlayer.

'use strict';

const ZPPlatformModule = require('./lib/ZPPlatform');
const ZPPlatform = ZPPlatformModule.ZPPlatform;

module.exports = (homebridge) => {
  ZPPlatformModule.setHomebridge(homebridge);
  homebridge.registerPlatform('homebridge-zp', 'ZP', ZPPlatform);
};
