// homebridge-zp/lib/ZpService/Led.js
// Copyright © 2016-2025 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Sonos ZonePlayer.

import { ZpService } from './index.js'

class Led extends ZpService {
  constructor (zpAccessory, zpClient) {
    const params = {
      name: zpClient.zoneName + ' Sonos LED',
      Service: zpAccessory.Services.hap.Lightbulb,
      subtype: 'led' + (zpClient.channel == null ? '' : zpClient.channel)
    }
    if (zpClient.role !== 'master' && zpClient.channel != null) {
      params.name = zpClient.zoneName + ' Sonos ' + zpClient.channel + ' LED'
    }
    super(zpAccessory, params)
    this.debug('LED service')
    const paramsOn = {
      key: 'on',
      Characteristic: this.Characteristics.hap.On,
      setter: this.zpClient.setLedState.bind(this.zpClient)
    }
    const paramsLocked = {
      key: 'locked',
      Characteristic: this.Characteristics.hap.LockPhysicalControls,
      props: { adminOnlyAccess: [this.Characteristic.Access.WRITE] },
      setter: this.zpClient.setButtonLockState.bind(this.zpClient)
    }
    if (!(this.platform.config.heartrate > 0)) {
      paramsOn.getter = this.zpClient.getLedState.bind(this.zpClient)
      paramsLocked.getter = async (value) => {
        return (await this.zpClient.getButtonLockState())
          ? this.Characteristics.hap.LockPhysicalControls.CONTROL_LOCK_ENABLED
          : this.Characteristics.hap.LockPhysicalControls.CONTROL_LOCK_DISABLED
      }
    }
    this.addCharacteristicDelegate(paramsOn)
    this.addCharacteristicDelegate(paramsLocked)
    if (zpClient.role !== 'master') {
      this.addCharacteristicDelegate({
        key: 'lastSeen',
        Characteristic: this.Characteristics.my.LastSeen,
        value: 'n/a',
        silent: true
      })
      this.addCharacteristicDelegate({
        key: 'statusFault',
        Charactertistic: this.Characteristics.hap.StatusFault,
        value: this.Characteristics.hap.StatusFault.GENERAL_FAULT
      })
      this.values.statusFault =
        this.Characteristics.hap.StatusFault.GENERAL_FAULT
    }

    if (this.platform.config.heartrate > 0) {
      this.zpAccessory.on('heartbeat', async (beat) => {
        try {
          if (beat % this.platform.config.heartrate === 0) {
            if (!this.zpAccessory.blinking) {
              this.values.on = await this.zpClient.getLedState()
            }
            this.values.locked = (await this.zpClient.getButtonLockState())
              ? this.Characteristics.hap.LockPhysicalControls.CONTROL_LOCK_ENABLED
              : this.Characteristics.hap.LockPhysicalControls.CONTROL_LOCK_DISABLED
          }
        } catch (error) {
          this.error(error)
        }
      })
    }
    this.emit('initialised')
  }
}

ZpService.Led = Led
