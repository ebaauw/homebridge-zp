// homebridge-zp/lib/ZpService/Alarm.js
// Copyright © 2016-2026 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Sonos ZonePlayer.

import { ZpService } from './index.js'

class Alarm extends ZpService {
  constructor (zpAccessory, alarm) {
    const params = {
      id: alarm.id,
      name: zpAccessory.zpClient.zoneName + ' Sonos Alarm ' + alarm.id,
      Service: zpAccessory.Services.hap.Switch,
      subtype: 'alarm' + alarm.id
    }
    super(zpAccessory, params)
    this.debug('Alarm service')
    this.addCharacteristicDelegate({
      key: 'on',
      Characteristic: this.Characteristics.hap.On,
      setter: async (value) => {
        const alarm = Object.assign({}, this._alarm)
        alarm.enabled = value ? 1 : 0
        return this.zpClient.updateAlarm(alarm)
      }
    })
    this.addCharacteristicDelegate({
      key: 'currentTrack',
      Characteristic: this.Characteristics.my.CurrentTrack
    })
    this.addCharacteristicDelegate({
      key: 'time',
      Characteristic: this.Characteristics.my.Time
    })
    this.emit('initialised')
    this._alarm = alarm
  }

  get alarm () { return this._alarm }

  set alarm (alarm) {
    this._alarm = alarm
    this.values.on = alarm.enabled === 1
    this.values.currentTrack = alarm.programUri === 'x-rincon-buzzer:0'
      ? 'Sonos Chime'
      : alarm.programMetaData != null && alarm.programMetaData.title != null
        ? alarm.programMetaData.title.slice(0, 64)
        : 'unknown'
    this.values.time = alarm.startTime
  }
}

ZpService.Alarm = Alarm
