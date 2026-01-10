// homebridge-zp/lib/ZpAccessory/Tv.js
// Copyright © 2016-2026 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Sonos ZonePlayer.

import { ZpAccessory } from './index.js'
import { ZpService } from '../ZpService/index.js'

class Tv extends ZpAccessory {
  constructor (platform, params) {
    params.id = platform.config.tvIdPrefix + params.id.slice(6)
    params.category = platform.Accessory.Categories.SPEAKER
    params.externalAccessory = true
    super(platform, params)
    this.inheritLogLevel(params.master)
    // params.master.context.tv = this._context
    this.debug('TV accessory')
    this.tvService = new ZpService.Tv(this, params)
    this.zpClient.on('lastSeenUpdated', () => {
      this.tvService.values.statusFault =
        this.Characteristics.hap.StatusFault.NO_FAULT
    })
    setImmediate(() => {
      this.emit('initialised')
    })
  }

  topologyUpdated () {
    this.tvService.updateGroupInputSource()
  }
}

ZpAccessory.Tv = Tv
