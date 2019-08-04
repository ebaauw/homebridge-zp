// homebridge-zp/lib/ZpAccessory.js
// Copyright © 2016-2019 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Sonos ZonePlayer.

'use strict'

const events = require('events')
const homebridgeLib = require('homebridge-lib')

const ZpService = require('./ZpService')

class ZpAccessory extends homebridgeLib.AccessoryDelegate {
  constructor (platform, params) {
    super(platform, params)
    this.context.name = params.name
    this.context.id = params.id
    this.context.address = params.address
    this.setAlive()

    this.on('identify', async () => {
      try {
        if (this.blinking) {
          return
        }
        this.blinking = true
        const on = await this.zpClient.getLedState()
        for (let n = 0; n < 10; n++) {
          this.zpClient.setLedState(n % 2 === 0)
          await events.once(this, 'heartbeat')
        }
        await this.zpClient.setLedState(on)
        this.blinking = false
      } catch (error) {
        this.error(error)
      }
    })
    this.zpClient = params.zpClient
    this.zpClient.on('event', (device, service, payload) => {
      try {
        const f = `handle${device}${service}Event`
        if (this[f] != null) {
          this[f](payload)
        }
      } catch (error) {
        this.error(error)
      }
    })
  }

  static get Master () { return Master }

  static get Slave () { return Slave }

  static get Tv () { return Tv }
}

class Master extends ZpAccessory {
  constructor (platform, params) {
    params.category = platform.Accessory.Categories.SPEAKER
    super(platform, params)
    this.debug('Sonos accessory')
    this.alarmServices = {}
    this.sonosService = new ZpService.Sonos(this)
    if (this.platform.config.speakers) {
      this.speakerService = new ZpService.Speaker(this)
    }
    if (this.platform.config.leds) {
      this.ledService = new ZpService.Led(this, this.zpClient)
    }
    this.zpClient.subscribe('/GroupManagement/Event')
      .catch((error) => {
        this.error(error)
      })
    if (this.platform.config.alarms) {
      this.notYetInitialised = true
      this.zpClient.subscribe('/AlarmClock/Event')
        .catch((error) => {
          this.error(error)
        })
      return // initialised will be emitted by handleZonePlayerAlarmClockEvent
    }
    this.emit('initialised')
  }

  handleZonePlayerGroupManagementEvent (event) {
    this.isCoordinator = event.groupCoordinatorIsLocal === 1
    this.groupId = event.localGroupUuid
    if (this.isCoordinator) {
      this.coordinator = this
      this.sonosService.values.sonosGroup = this.zpClient.zoneName
      for (const member of this.members()) {
        member.coordinator = this
        member.copyCoordinator()
      }
      if (this.speakerService != null) {
        this.speakerService.values.on = false
      }
    } else {
      this.coordinator = this.platform.groupCoordinator(this.groupId)
      if (this.coordinator) {
        this.copyCoordinator()
      }
      if (this.speakerService != null) {
        this.speakerService.values.on = true
      }
    }
    this.emit('groupInitialised')
  }

  async handleZonePlayerAlarmClockEvent (event) {
    const alarms = (await this.zpClient.listAlarms()).currentAlarmList
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
    return this.platform.groupMembers(this.groupId)
  }
}

class Slave extends ZpAccessory {
  constructor (platform, params) {
    params.category = platform.Accessory.Categories.SPEAKER
    super(platform, params)
    this.debug('LED accessory')
    this.ledService = new ZpService.Led(this, this.zpClient)
    this.emit('initialised')
  }
}

class Tv extends ZpAccessory {
  constructor (platform, params) {
    params.id = platform.config.tvIdPrefix + params.id.substr(6)
    params.category = platform.Accessory.Categories.TELEVISION
    params.externalAccessory = true
    super(platform, params)
    this.debug('TV accessory')
    this.tvService = new ZpService.Tv(this, params)
    this.emit('initialised')
  }
}

module.exports = ZpAccessory
