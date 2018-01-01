// homebridge-zp/index.js
// Copyright © 2016-2018 Erik Baauw. All rights reserved.
//
// Homebridge plug-in for Sonos ZonePlayer.

'use strict';

const dynamic = false;

const ZPPlatformModule = require('./lib/ZPPlatform');
const ZPPlatform = ZPPlatformModule.ZPPlatform;

module.exports = function(homebridge) {
  ZPPlatformModule.setHomebridge(homebridge);
  homebridge.registerPlatform('homebridge-zp', 'ZP', ZPPlatform, dynamic);
};
