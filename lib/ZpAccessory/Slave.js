// homebridge-zp/lib/ZpAccessory/Slave.js
// Copyright © 2016-2025 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Sonos ZonePlayer.

import { ZpAccessory } from './index.js'
import { ZpService } from '../ZpService/index.js'

class Slave extends ZpAccessory {
  constructor (platform, params) {
    params.category = platform.Accessory.Categories.SPEAKER
    super(platform, params)
    this.inheritLogLevel(params.master)
    this.debug('LED accessory')
    this.context.master = params.master.id
    this.ledService = new ZpService.Led(this, this.zpClient)
    this.attachZpClient()
    setImmediate(() => {
      this.emit('initialised')
    })
  }

  updateLastSeen () {
    this.ledService.values.lastSeen = this.zpClient.lastSeen
    this.ledService.values.statusFault =
      this.Characteristics.hap.StatusFault.NO_FAULT
  }

  topologyUpdated () {
    if (this.zpClient.battery != null) {
      this.checkBattery(this.zpClient.battery)
    }
  }
}

ZpAccessory.Slave = Slave
