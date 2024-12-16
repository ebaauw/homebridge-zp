// homebridge-zp/lib/ZpAccessory/Master.js
// Copyright © 2016-2024 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Sonos ZonePlayer.

import { ZpAccessory } from './index.js'
import { ZpService } from '../ZpService/index.js'

class Master extends ZpAccessory {
  constructor (platform, params) {
    params.category = platform.Accessory.Categories.SPEAKER
    super(platform, params)
    this.debug('Sonos accessory')
    this.alarmServices = {}
    this.sonosService = new ZpService.Sonos(this)
    this.manageLogLevel(this.sonosService.characteristicDelegate('logLevel'))
    if (this.platform.config.speakers) {
      this.speakerService = new ZpService.Speaker(this)
    }
    if (this.platform.config.leds) {
      this.ledService = new ZpService.Led(this, this.zpClient)
    }
    this.attachZpClient()
    this.topologyUpdated()
    if (this.platform.config.alarms) {
      this.notYetInitialised = true
      this.zpHousehold.on('alarmListUpdated', this.alarmListUpdated.bind(this))
      this.alarmListUpdated()
      return // 'initialised' will be emitted by alarmListUpdated()
    }
    setImmediate(() => {
      this.emit('initialised')
    })
  }

  updateLastSeen () {
    this.sonosService.values.lastSeen = this.zpClient.lastSeen
    this.sonosService.values.statusFault =
      this.Characteristics.hap.StatusFault.NO_FAULT
  }

  topologyUpdated () {
    this.sonosService.values.sonosGroup = this.zpClient.zoneGroupShortName
    this.isCoordinator = this.zpClient.zoneGroup === this.zpClient.id
    if (this.isCoordinator) {
      this.coordinator = this
      if (this.speakerService != null) {
        this.speakerService.values.on = false
      }
      this.leaving = false
    } else {
      if (this.speakerService != null) {
        this.speakerService.values.on = true
      }
      this.coordinator = this.platform.groupCoordinator(this.zpClient.zoneGroup)
      this.copyCoordinator()
    }
    if (this.zpClient.battery != null) {
      this.checkBattery(this.zpClient.battery)
    }
  }

  alarmListUpdated () {
    const alarms = this.zpHousehold.alarmList
    if (alarms == null) {
      return
    }
    const keys = {}
    for (const alarm of alarms) {
      if (alarm.roomUuid === this.zpClient.id) {
        keys[alarm.id] = true
        const service = this.alarmServices[alarm.id]
        if (service == null) {
          this.alarmServices[alarm.id] = new ZpService.Alarm(this, alarm)
        } else {
          service.alarm = alarm
        }
      }
    }
    for (const key in this.alarmServices) {
      if (!keys[key]) {
        this.log('remove Alarm %s', key)
        this.alarmServices[key].destroy()
        delete this.alarmServices[key]
      }
    }
    if (this.notYetInitialised) {
      delete this.notYetInitialised
      this.emit('initialised')
    }
  }

  // Copy group characteristic values from group coordinator.
  copyCoordinator () {
    const coordinator = this.coordinator
    if (coordinator && coordinator !== this && !this.leaving) {
      this.debug(
        'copy coordinator %s [%s]', this.coordinator.zpClient.id,
        this.coordinator.zpClient.zoneGroupName
      )
      const src = coordinator.sonosService.values
      const dst = this.sonosService.values
      dst.sonosGroup = src.sonosGroup
      dst.on = src.on
      dst.volume = src.volume
      dst.mute = src.mute
      dst.currentTrack = src.currentTrack
      dst.currentTransportActions = src.currentTransportActions
      dst.uri = src.uri
    }
  }

  // Return array of members.
  members () {
    if (!this.isCoordinator) {
      return []
    }
    return this.platform.groupMembers(this.zpClient.id)
  }
}

ZpAccessory.Master = Master
