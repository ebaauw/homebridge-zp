// homebridge-zp/lib/ZpService/index.js
// Copyright © 2016-2026 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Sonos ZonePlayer.

import { ServiceDelegate } from 'homebridge-lib/ServiceDelegate'

class ZpService extends ServiceDelegate {
  constructor (zpAccessory, params) {
    super(zpAccessory, params)
    this.zpAccessory = zpAccessory
    this.zpClient = this.zpAccessory.zpClient
    this.zpHousehold = this.zpAccessory.zpHousehold
  }
}

export { ZpService }
