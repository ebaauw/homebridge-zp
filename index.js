// homebridge-zp/index.js
// (C) 2016, Erik Baauw
//
// Homebridge plug-in for Sonos ZonePlayer.

"use strict";

const dynamic = false;

const ZPPlatformModule = require("./lib/ZPPlatform");
const ZPPlatform = ZPPlatformModule.ZPPlatform;

module.exports = function(homebridge) {
  ZPPlatformModule.setHomebridge(homebridge);
  homebridge.registerPlatform("homebridge-zp", "ZP", ZPPlatform, dynamic);
};
